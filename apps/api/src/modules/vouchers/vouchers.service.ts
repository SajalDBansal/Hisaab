import {
  canSeeCosts,
  canVoucher,
  draftSaleMargin,
  withoutCosts,
  type SaleMargin,
  type SaleMarginInput,
  describeAccount,
  calcInvoice,
  cancelBlocker,
  cancelVoucher,
  cursorOffset,
  pageCursor,
  restoreBlocker,
  restoreVoucher,
  CONVERTS_TO,
  counterYear,
  createContra,
  createExpense,
  createJournal,
  createNote,
  createOrder,
  createPayment,
  createPurchase,
  createReceipt,
  createSale,
  createSales,
  createRetailSale,
  WALK_IN_PARTY_NAME,
  editBlocker,
  financialYear,
  formatVoucherNumber,
  invoiceStatus,
  isOrderType,
  newestFirst,
  nextSequence,
  numberingRule,
  orderStatus,
  openingBillId,
  partyBills,
  postingTotals,
  returnAmountBasis,
  roleFlag,
  seriesPrefix,
  setCleared,
  settledAmounts,
  today,
  updateInvoice,
  voucherPostings,
  type InvoiceSettings as InvoiceSettingsCore,
  type Permission,
  type Role,
  type VoucherAction,
  type Voucher as CoreVoucher,
  type VoucherType,
} from "@repo/core";
import type {
  CancelledEntry,
  InvoiceRow,
  NewContraInput,
  NewExpenseInput,
  NewInvoiceInput,
  NewJournalInput,
  NewMoneyInput,
  NewNoteInput,
  NewOrderInput,
  NewRetailSaleInput,
  OrderRow,
  ReturnableBill,
  Voucher,
  VoucherDetail,
} from "@repo/contracts";
import { and, asc, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import {
  rememberAnswer,
  replayOf,
  type Idem,
} from "@repo/backend/modules/vouchers/idempotency";
import { saveChanges } from "@repo/backend/modules/vouchers/persist";
import {
  loadBooks,
  type Actor,
  type Scope,
  type Snapshot,
} from "@repo/backend/modules/vouchers/snapshot";
import { vouchersRepo } from "./vouchers.repo";
import {
  editedElsewhere,
  invalidFields,
  notFound,
} from "@repo/backend/modules/masters/shared";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import {
  prepareInvoiceAssociates,
  syncAssociateVouchers,
} from "../associates/associates.hooks";
import { assertAssociateJournalEditable } from "../associates/associates.journals";
import {
  assertOrderChangeAllowed,
  afterOrderVoucherChange,
} from "@repo/backend/modules/order-fulfillment/orderFulfillment.repo";
import { enforceSaleCredit } from "../settlements/credit.service";
import { billAllocations } from "@repo/core/src/accounting/settlements";
import { printVoucher } from "@repo/backend/modules/vouchers/print";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ChangeDb = Db | Tx;

/** The caller: who they are and their role in the firm. */
export interface Ctx extends Actor {
  firmId: string;
  role: Role;
  /** Set on creates that carried an Idempotency-Key. */
  idem?: Idem;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Series = "bos" | "nongst" | "retail" | "nongst-retail";

/** Which right a voucher type needs (the same split as the app's roles). */
export const NEEDS: Record<VoucherType, Permission> = {
  sale: "sales",
  "credit-note": "sales",
  receipt: "sales",
  estimate: "sales",
  proforma: "sales",
  "sales-order": "sales",
  "delivery-note": "sales",
  purchase: "purchase",
  "debit-note": "purchase",
  payment: "purchase",
  expense: "purchase",
  "purchase-order": "purchase",
  contra: "payments",
  journal: "accounts",
};

/**
 * The role must allow this action on this voucher type (doc 37, T57). Built-in
 * roles allow create/edit/cancel exactly where they could change entries before.
 */
export function requireRight(
  role: Role,
  type: VoucherType,
  action: VoucherAction = "create",
) {
  if (!canVoucher(role, type, action))
    throw new AppError(
      "FORBIDDEN",
      "Your role can't change this kind of entry. Ask the owner of the firm.",
      403,
    );
}

/** The core explains problems in plain words; pass them on as a normal error. */
function core<T>(work: () => T, code = "INVALID_VOUCHER", status = 400): T {
  try {
    return work();
  } catch (err) {
    if (err instanceof Error && !(err instanceof AppError))
      throw new AppError(code, err.message, status);
    throw err;
  }
}

/**
 * Runs one change to the books in a transaction.
 * The firm is locked first, so bill numbers are handed out one at a time and two people
 * can't settle the same bill twice. Reads happen inside the lock, so they are never stale.
 */
export async function change(
  db: ChangeDb,
  ctx: Ctx,
  scope: Scope,
  work: (snap: Snapshot, tx: Tx) => CoreVoucher | Promise<CoreVoucher>,
  afterSave?: (tx: Tx, result: Voucher) => Promise<void>,
): Promise<Voucher>;
export async function change(
  db: ChangeDb,
  ctx: Ctx,
  scope: Scope,
  work: (snap: Snapshot, tx: Tx) => CoreVoucher[] | Promise<CoreVoucher[]>,
  afterSave?: (tx: Tx, result: Voucher[]) => Promise<void>,
): Promise<Voucher[]>;
export async function change(
  db: ChangeDb,
  ctx: Ctx,
  scope: Scope,
  work: (
    snap: Snapshot,
    tx: Tx,
  ) => CoreVoucher | CoreVoucher[] | Promise<CoreVoucher | CoreVoucher[]>,
  afterSave?:
    | ((tx: Tx, result: Voucher) => Promise<void>)
    | ((tx: Tx, result: Voucher[]) => Promise<void>),
): Promise<Voucher | Voucher[]> {
  const run = async (tx: Tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${ctx.firmId}, 0))`,
    );
    const [member] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, ctx.firmId),
          eq(schema.member.userId, ctx.id),
        ),
      );
    if (!member)
      throw new AppError(
        "FORBIDDEN",
        "You no longer have access to this firm.",
        403,
      );
    if (member.role !== ctx.role)
      throw new AppError(
        "ROLE_CHANGED",
        "Your role changed. Reload the firm before saving.",
        403,
      );
    // A create that was already done: give back the same answer, save nothing
    if (ctx.idem) {
      const seen = await replayOf<Voucher | Voucher[]>(tx, ctx.id, ctx.idem);
      if (seen) {
        for (const voucher of [seen].flat())
          requireRight(ctx.role, voucher.type, "create");
        return seen;
      }
    }
    const snap = await loadBooks(tx, ctx.firmId, ctx, scope);
    const result = await work(snap, tx);
    // New entries need "create", newly cancelled ones "cancel", the rest "edit".
    for (const v of [result].flat()) {
      const before = snap.before.get(v.id);
      const was = before ? (JSON.parse(before) as CoreVoucher) : undefined;
      const action: VoucherAction = !was
        ? "create"
        : v.status === "cancelled" && was.status !== "cancelled"
          ? "cancel"
          : "edit";
      requireRight(member.role as Role, v.type, action);
      if (was) requireOwnRecord(member.role as Role, ctx, was);
    }
    const saved = await saveChanges(tx, ctx.firmId, ctx, snap);
    await syncAssociateVouchers(tx, ctx, snap, saved);
    for (const v of [result].flat()) {
      if (
        v.type === "credit-note" ||
        v.type === "debit-note" ||
        v.status === "cancelled"
      )
        await afterOrderVoucherChange(tx, ctx.firmId, saved.idOf(v.id));
    }
    const voucher = Array.isArray(result)
      ? result.map((v) => out(v, saved.versions, saved.idOf))
      : out(result, saved.versions, saved.idOf);
    if (afterSave)
      await (
        afterSave as (tx: Tx, result: Voucher | Voucher[]) => Promise<void>
      )(tx, voucher);
    if (ctx.idem) await rememberAnswer(tx, ctx.id, ctx.idem, 201, voucher);
    return voucher;
  };
  return "transaction" in db ? db.transaction(run) : run(db);
}

// ---------------------------------------------------------------------------
// Checks shared by the create functions
// ---------------------------------------------------------------------------

const lineItems = (lines: { itemId: string }[]) => [
  ...new Set(lines.map((l) => l.itemId)),
];

function findParty(snap: Snapshot, id: string, want?: "customer" | "supplier") {
  const party = snap.books.parties.find((p) => p.id === id);
  if (!party || snap.deleted.has(id))
    throw (
      invalidFields({ partyId: "Pick the customer or supplier." }) ??
      notFound("party")
    );
  if (want && party.type !== want) {
    const message =
      want === "customer" ? "Pick a customer." : "Pick a supplier.";
    throw invalidFields({ partyId: message }) ?? notFound("party");
  }
  return party;
}

function checkItems(snap: Snapshot, lines: { itemId: string }[]) {
  for (const id of lineItems(lines))
    if (!snap.books.items.some((i) => i.id === id) || snap.deleted.has(id))
      throw (
        invalidFields({ lines: "One of the items is no longer available." }) ??
        notFound("item")
      );
}

function checkLedger(snap: Snapshot, id: string, field: string) {
  if (!snap.books.ledgers.some((l) => l.id === id) || snap.deleted.has(id))
    throw (
      invalidFields({ [field]: "Pick a cash or bank account." }) ??
      notFound("account")
    );
}

/** Ids of the bills a receipt or payment settles (the opening balance is not a voucher). */
function billIds(input: Pick<NewMoneyInput, "allocations">) {
  return input.allocations
    .map((a) => a.voucherId)
    .filter(
      (id) => !id.startsWith("opening:") && !id.startsWith("opening-bill:"),
    );
}

/** Each bill named must belong to the party, still be open, and not be settled for more than is pending. */
function checkAllocations(
  snap: Snapshot,
  partyId: string,
  type: "receipt" | "payment",
  input: Pick<NewMoneyInput, "allocations" | "date">,
) {
  const party = findParty(snap, partyId);
  const bills = partyBills(party, snap.books.vouchers, today());
  const datedBills = new Set(
    partyBills(party, snap.books.vouchers, input.date).map((b) => b.id),
  );
  const billType = type === "receipt" ? "sale" : "purchase";
  const asked = new Map<string, number>();
  for (const a of input.allocations)
    asked.set(a.voucherId, (asked.get(a.voucherId) ?? 0) + a.amount);
  for (const [id, amount] of asked) {
    const bill = bills.find((b) => b.id === id);
    const known = snap.books.vouchers.find((v) => v.id === id);
    const wrongKind = known && known.type !== billType;
    if (
      !bill ||
      !datedBills.has(id) ||
      wrongKind ||
      (id.startsWith("opening:") && id !== openingBillId(party.id))
    )
      throw (
        invalidFields({
          allocations: "One of the bills isn't open for this party.",
        }) ?? notFound("bill")
      );
    if (amount > bill.pending)
      throw (
        invalidFields({
          allocations: `${bill.number} has only ${bill.pending / 100} left to settle.`,
        }) ?? notFound("bill")
      );
  }
}

/** Journal lines may name a party or an account of this firm; make sure they exist. */
function checkJournal(snap: Snapshot, input: NewJournalInput) {
  for (const line of input.lines) {
    const [kind, id] = line.account.split(":");
    if (kind === "party" || kind === "ledger" || kind === "account") {
      const found =
        kind === "party"
          ? snap.books.parties.some((p) => p.id === id)
          : kind === "ledger"
            ? snap.books.ledgers.some((l) => l.id === id)
            : snap.books.accounts?.some((a) => a.id === id);
      if (
        !id ||
        line.account !== `${kind}:${id}` ||
        !UUID.test(id) ||
        !found ||
        snap.deleted.has(id)
      )
        throw (
          invalidFields({
            lines: `${line.name} isn't one of your accounts.`,
          }) ?? notFound("account")
        );
    } else if (!validBuiltInAccount(line.account)) {
      throw new AppError(
        "INVALID_ACCOUNT",
        "Pick an existing account or create a ledger first.",
        400,
      );
    }
    // Names come from the firm's masters, never from an untrusted journal label.
    line.name = describeAccount(line.account, snap.books).name;
  }
}

function validBuiltInAccount(key: string) {
  if (
    [
      "capital",
      "drawings",
      "sales",
      "purchase",
      "sales-return",
      "purchase-return",
      "round-off",
    ].includes(key)
  )
    return true;
  return (
    /^(expense|income|asset|provision):\S.{0,149}$/.test(key) ||
    /^(input|output):(cgst|sgst|igst)$/.test(key) ||
    /^tds:[A-Z0-9]{1,10}$/.test(key)
  );
}

const journalParties = (input: NewJournalInput) =>
  input.lines
    .map((l) => l.account.split(":"))
    .filter(([kind, id]) => kind === "party" && id && UUID.test(id))
    .map(([, id]) => id as string);

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export const vouchersService = {
  async sales(db: Db, ctx: Ctx, input: NewInvoiceInput) {
    requireRight(ctx.role, "sale");
    return change(
      db,
      ctx,
      {
        parties: [input.partyId],
        items: lineItems(input.lines),
        vouchers: input.sourceId ? [input.sourceId] : [],
      },
      async (snap, tx) => {
        findParty(snap, input.partyId);
        checkItems(snap, input.lines);
        if (input.paidNow) checkLedger(snap, input.paidNow.ledgerId, "paidNow");
        const associates = await prepareInvoiceAssociates(
          tx,
          ctx,
          input,
          input.date,
        );
        const created = core(() => createSales(snap.books, input));
        for (const voucher of created) Object.assign(voucher, associates);
        return created;
      },
      (tx, saved) => enforceSaleCredit(tx, ctx, input, saved),
    );
  },
  async sale(db: Db, ctx: Ctx, input: NewInvoiceInput) {
    return invoice(db, ctx, "sale", input);
  },

  /**
   * Retail (walk-in) bill (doc 37, T02): a sale in the retail series, received in
   * full into `paidBy`. Without a party it goes to the firm's "Cash customer",
   * made on first use. Credit control runs as for any sale (nothing stays due).
   */
  async retailSale(db: Db, ctx: Ctx, input: NewRetailSaleInput) {
    requireRight(ctx.role, "sale");
    const partyId = input.partyId ?? (await walkInPartyId(db, ctx.firmId));
    const sale = { ...input, partyId };
    return change(
      db,
      ctx,
      { parties: [partyId], items: lineItems(input.lines), vouchers: [] },
      (snap) => {
        findParty(snap, partyId, "customer");
        checkItems(snap, input.lines);
        checkLedger(snap, input.paidBy.ledgerId, "paidBy");
        return core(() => createRetailSale(snap.books, sale));
      },
      (tx, saved) =>
        enforceSaleCredit(
          tx,
          ctx,
          { ...sale, charges: [], paidNow: undefined },
          saved,
        ),
    );
  },

  /**
   * Profit margin of a sale being made (doc 37, T12), from the stock saving it
   * would take. Read only; the cost itself only for roles that may see costs.
   */
  async saleMargin(
    db: Db,
    firmId: string,
    role: Role,
    input: SaleMarginInput,
  ): Promise<SaleMargin> {
    const books = await db.transaction((tx) => loadReportBooks(tx, firmId), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
    const result = core(() => draftSaleMargin(books, input));
    return canSeeCosts(role) ? result : withoutCosts(result);
  },
  async purchase(db: Db, ctx: Ctx, input: NewInvoiceInput) {
    return invoice(db, ctx, "purchase", input);
  },

  async receipt(db: Db, ctx: Ctx, input: NewMoneyInput) {
    return money(db, ctx, "receipt", input);
  },
  async payment(db: Db, ctx: Ctx, input: NewMoneyInput) {
    return money(db, ctx, "payment", input);
  },

  async expense(db: Db, ctx: Ctx, input: NewExpenseInput) {
    const supplierId = input.gst?.partyId;
    const scope = supplierId ? { parties: [supplierId] } : {};
    const voucher = await change(db, ctx, scope, (snap) => {
      checkLedger(snap, input.ledgerId, "ledgerId");
      if (supplierId) findParty(snap, supplierId, "supplier");
      return core(() => createExpense(snap.books, input));
    });
    return voucher;
  },

  async journal(db: Db, ctx: Ctx, input: NewJournalInput) {
    const voucher = await change(
      db,
      ctx,
      { parties: journalParties(input) },
      (snap) => {
        checkJournal(snap, input);
        return core(() => createJournal(snap.books, input));
      },
    );
    return voucher;
  },

  async contra(db: Db, ctx: Ctx, input: NewContraInput) {
    const voucher = await change(db, ctx, {}, (snap) => {
      checkLedger(snap, input.fromLedgerId, "fromLedgerId");
      checkLedger(snap, input.toLedgerId, "toLedgerId");
      return core(() => createContra(snap.books, input));
    });
    return voucher;
  },

  async order(db: Db, ctx: Ctx, type: OrderKind, input: NewOrderInput) {
    const voucher = await change(
      db,
      ctx,
      {
        parties: [input.partyId],
        items: lineItems(input.lines),
        vouchers: input.sourceId ? [input.sourceId] : [],
      },
      async (snap, tx) => {
        findParty(snap, input.partyId);
        checkItems(snap, input.lines);
        const associates = await prepareInvoiceAssociates(
          tx,
          ctx,
          input,
          input.date,
        );
        return Object.assign(
          core(() => createOrder(snap.books, type, input)),
          associates,
        );
      },
    );
    // Historical order keys hashed /orders/:type, so also verify the saved order kind.
    if (voucher.type !== type)
      throw new AppError(
        "KEY_REUSED",
        "This request key belongs to another order type.",
        422,
      );
    return voucher;
  },

  /** Sales return (credit note) or purchase return (debit note). */
  async note(
    db: Db,
    ctx: Ctx,
    type: "credit-note" | "debit-note",
    input: NewNoteInput,
  ) {
    const voucher = await change(
      db,
      ctx,
      { vouchers: [input.againstId] },
      (snap) => core(() => createNote(snap.books, type, input)),
    );
    return voucher;
  },

  /** Change a saved sale, purchase, estimate or order. */
  async edit(
    db: Db,
    ctx: Ctx,
    id: string,
    version: number,
    input: NewInvoiceInput,
  ) {
    const voucher = await change(
      db,
      ctx,
      {
        vouchers: [id],
        parties: [input.partyId],
        items: lineItems(input.lines),
      },
      async (snap, tx) => {
        const v = existing(snap, ctx, id, version);
        await assertOrderChangeAllowed(tx, ctx.firmId, id, "edit");
        await assertAssociateJournalEditable(tx, ctx.firmId, id);
        findParty(
          snap,
          input.partyId,
          v.type === "purchase" || v.type === "purchase-order"
            ? "supplier"
            : "customer",
        );
        checkItems(snap, input.lines);
        const blocked = editBlocker(snap.books, v);
        if (blocked) throw new AppError("CANNOT_EDIT", blocked, 409);
        const associates = await prepareInvoiceAssociates(
          tx,
          ctx,
          input,
          input.date,
          v,
        );
        return Object.assign(
          core(() =>
            updateInvoice(snap.books, id, input, new Date().toISOString()),
          ),
          associates,
        );
      },
      (tx, saved) =>
        enforceSaleCredit(tx, ctx, input, [saved], {
          editVoucherId: id,
          editVersion: version,
        }),
    );
    return voucher;
  },

  /** Cancel a voucher. It keeps its number but stops counting everywhere. */
  async cancel(db: Db, ctx: Ctx, id: string, version: number, reason: string) {
    const voucher = await change(
      db,
      ctx,
      { vouchers: [id] },
      async (snap, tx) => {
        const v = existing(snap, ctx, id, version);
        await assertOrderChangeAllowed(tx, ctx.firmId, id, "cancel");
        await assertAssociateJournalEditable(tx, ctx.firmId, id);
        const blocked = cancelBlocker(snap.books, v);
        if (blocked) throw new AppError("CANNOT_CANCEL", blocked, 409);
        return core(() =>
          cancelVoucher(snap.books, id, reason, new Date().toISOString()),
        );
      },
    );
    return voucher;
  },

  /**
   * Put a cancelled voucher back as it was (doc 37, T47). Owner only until custom
   * roles add a restore right. The period lock is checked when saving, and the
   * order and associate hooks run as for any change.
   */
  async restore(db: Db, ctx: Ctx, id: string, version: number) {
    requireOwner(ctx.role);
    return change(
      db,
      ctx,
      { vouchers: [id] },
      (snap) => {
        const v = existing(snap, ctx, id, version);
        const blocked = restoreBlocker(snap.books, v);
        if (blocked) throw new AppError("CANNOT_RESTORE", blocked, 409);
        return core(() => restoreVoucher(snap.books, id));
      },
      // Orders: a restored conversion uses the order's quantities again.
      (tx, saved) => afterOrderVoucherChange(tx, ctx.firmId, saved.id),
    );
  },

  /** Cancelled entries, newest cancellation first, with why each can't be restored. */
  async cancelled(
    db: Db,
    firmId: string,
    role: Role,
    limit: number,
    cursor?: string,
  ): Promise<{ items: CancelledEntry[]; nextCursor: string | null }> {
    requireOwner(role);
    const { books, apiVoucher } = await readBooks(db, firmId);
    const rows = books.vouchers
      .filter((v) => v.status === "cancelled")
      .sort(
        (a, b) =>
          (b.cancelledAt ?? "").localeCompare(a.cancelledAt ?? "") ||
          b.date.localeCompare(a.date),
      );
    const offset = cursorOffset(cursor);
    const page = rows.slice(offset, offset + limit).map((v) => {
      const party =
        v.snapshot?.party ?? books.parties.find((p) => p.id === v.partyId);
      return {
        id: v.id,
        type: v.type,
        number: v.number,
        date: v.date,
        partyName: party?.name,
        amount: v.amount,
        reason: v.cancelReason,
        cancelledAt: v.cancelledAt,
        version: apiVoucher(v).version,
        restoreBlocker: restoreBlocker(books, v) ?? undefined,
      };
    });
    return {
      items: page,
      nextCursor:
        offset + limit < rows.length ? pageCursor(offset + limit) : null,
    };
  },

  /** Bank reconciliation: the date an entry showed up in the bank statement. */
  async bankDate(
    db: Db,
    ctx: Ctx,
    id: string,
    clearedOn: string | null,
    ledgerId?: string,
  ) {
    const voucher = await change(db, ctx, { vouchers: [id] }, (snap) => {
      const v = snap.books.vouchers.find((x) => x.id === id);
      if (!v) throw notFound("entry");
      if (v.status !== "posted")
        throw new AppError(
          "NOT_A_BANK_ENTRY",
          "Only posted cash and bank entries have a bank date.",
          409,
        );
      return core(() =>
        setCleared(snap.books, id, clearedOn, today(), ledgerId),
      );
    });
    return voucher;
  },

  async get(db: Db, firmId: string, id: string): Promise<VoucherDetail> {
    const { books, apiVoucher } = await readBooks(db, firmId);
    const voucher = books.vouchers.find((v) => v.id === id);
    if (!voucher) throw notFound("entry");

    const api = apiVoucher(voucher);
    const party = voucher.snapshot
      ? voucher.snapshot.party
      : books.parties.find((p) => p.id === voucher.partyId);
    const ledger = books.ledgers.find((l) => l.id === voucher.ledgerId);
    const toLedger = books.ledgers.find((l) => l.id === voucher.toLedgerId);
    const againstBill = books.vouchers.find((v) => v.id === voucher.againstId);
    const itemIds = new Set((voucher.lines ?? []).map((line) => line.itemId));
    const postings = voucherPostings(voucher, {
      party: party?.name,
      ledger: ledger?.name,
      toLedger: toLedger?.name,
    });
    const payments = books.vouchers.filter(
      (v) =>
        v.status === "posted" &&
        billAllocations(v).some((allocation) => allocation.voucherId === id),
    );
    const settled = payments.reduce(
      (sum, payment) =>
        sum +
        billAllocations(payment)
          .filter((allocation) => allocation.voucherId === id)
          .reduce((inner, allocation) => inner + allocation.amount, 0),
      0,
    );

    return {
      ...api,
      voucher: api,
      party,
      items: (voucher.snapshot?.items ?? books.items).filter((item) =>
        itemIds.has(item.id),
      ),
      ledgerName: ledger?.name,
      totals: hasInvoiceTotals(voucher)
        ? calcInvoice({
            lines: voucher.lines ?? [],
            charges: voucher.charges,
            interState: !!voucher.interState,
          })
        : undefined,
      postings,
      postingTotals: postingTotals(postings),
      settled,
      payments: payments.map(apiVoucher),
      allocatedTo: billAllocations(voucher).map((allocation) => ({
        voucherId: allocation.voucherId,
        number:
          books.vouchers.find((v) => v.id === allocation.voucherId)?.number ??
          "Opening balance",
        amount: allocation.amount,
      })),
      against: againstBill
        ? { id: againstBill.id, number: againstBill.number }
        : undefined,
      returns: books.vouchers
        .filter((v) => v.againstId === id && v.status === "posted")
        .map(apiVoucher),
      cancelBlocker: cancelBlocker(books, voucher),
      editBlocker: editBlocker(books, voucher),
      toLedgerName: toLedger?.name,
      canConvertTo: convertibleTargets(voucher),
      source: linkedVoucher(
        books.vouchers.find((v) => v.id === voucher.sourceId),
      ),
      convertedTo: linkedVoucher(
        books.vouchers.find((v) => v.id === voucher.convertedToId),
      ),
      history: await voucherHistory(db, firmId, id),
    };
  },

  async list(
    db: Db,
    firmId: string,
    f: Parameters<typeof vouchersRepo.list>[2],
  ) {
    const rows = await vouchersRepo.list(db, firmId, f);
    return rows.map((r) => toVoucher(r.voucher, r.version));
  },

  async invoices(
    db: Db,
    firmId: string,
    type: "sale" | "purchase",
  ): Promise<InvoiceRow[]> {
    const { books, apiVoucher } = await readBooks(db, firmId);
    const settled = settledAmounts(books.vouchers);
    const asOf = today();

    return newestFirst(books.vouchers)
      .filter((voucher) => voucher.type === type)
      .map((voucher) => {
        const paid = settled.get(voucher.id) ?? 0;
        return {
          voucher: apiVoucher(voucher),
          partyName:
            books.parties.find((party) => party.id === voucher.partyId)?.name ??
            "",
          settled: paid,
          pending:
            voucher.status === "posted"
              ? Math.max(voucher.amount - paid, 0)
              : 0,
          status: invoiceStatus(voucher, paid, asOf),
        };
      });
  },

  async orders(db: Db, firmId: string, type: OrderKind): Promise<OrderRow[]> {
    const { books, apiVoucher } = await readBooks(db, firmId);
    const asOf = today();

    return newestFirst(books.vouchers)
      .filter((voucher) => voucher.type === type)
      .map((voucher) => {
        const convertedTo = books.vouchers.find(
          (v) => v.id === voucher.convertedToId,
        );
        return {
          voucher: apiVoucher(voucher),
          partyName:
            books.parties.find((party) => party.id === voucher.partyId)?.name ??
            "",
          status: orderStatus(voucher, asOf),
          convertedTo: convertedTo
            ? { id: convertedTo.id, number: convertedTo.number }
            : undefined,
        };
      });
  },

  async nextNumber(
    db: Db,
    firmId: string,
    type: VoucherType,
    date = today(),
    series?: Series,
  ) {
    const [settings] = await db
      .select()
      .from(schema.invoiceSettings)
      .where(eq(schema.invoiceSettings.firmId, firmId));
    if (!settings) throw new Error("Invoice settings missing");

    const numbering = {
      prefixes: settings.prefixes as Record<VoucherType, string>,
      billOfSupplyPrefix: settings.billOfSupplyPrefix,
      retailPrefix: settings.retailPrefix,
      numbering: settings.numbering as InvoiceSettingsCore["numbering"],
    };
    const prefix = seriesPrefix(numbering, type, series);
    const rule = numberingRule(numbering, type);
    const year = counterYear(rule, date);
    const [counter] = await db
      .select()
      .from(schema.voucherCounters)
      .where(
        sql`${schema.voucherCounters.firmId} = ${firmId}::uuid
          and ${schema.voucherCounters.type} = ${type}
          and ${schema.voucherCounters.series} = ${prefix}
          and ${schema.voucherCounters.financialYear} = ${year}`,
      );
    return formatVoucherNumber(
      prefix,
      financialYear(date).short,
      nextSequence(counter?.lastNumber, rule),
      rule,
    );
  },

  async returnable(
    db: Db,
    firmId: string,
    billId: string,
  ): Promise<ReturnableBill> {
    const { books, apiVoucher } = await readBooks(db, firmId);
    const bill = books.vouchers.find((voucher) => voucher.id === billId);
    if (!bill || (bill.type !== "sale" && bill.type !== "purchase"))
      throw notFound("bill");
    const amounts = returnAmountBasis(bill, books.vouchers);

    return {
      bill: apiVoucher(bill),
      partyName:
        books.parties.find((party) => party.id === bill.partyId)?.name ?? "",
      lines: returnableLines(books.vouchers, bill).map((row) => {
        const item = books.items.find((i) => i.id === row.line.itemId);
        return {
          index: row.index,
          itemName: item?.name ?? "Item",
          unit: row.line.per?.unit ?? item?.unit ?? "",
          qty: row.line.qty,
          returned: row.returned,
          returnable: row.returnable,
          rate: row.line.rate,
          amountBasis: amounts[row.index],
        };
      }),
    };
  },

  print: printVoucher,
};

type OrderKind =
  "estimate" | "proforma" | "sales-order" | "delivery-note" | "purchase-order";

/**
 * The firm's live "Cash customer" (doc 37, T02), made the first time a retail
 * bill needs it: same state as the firm, no credit. The firm lock keeps two
 * first bills from making two.
 */
async function walkInPartyId(db: Db, firmId: string): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${firmId}, 0))`,
    );
    const [found] = await tx
      .select({ id: schema.parties.id, type: schema.parties.type })
      .from(schema.parties)
      .where(
        sql`${schema.parties.firmId} = ${firmId}::uuid
          and ${schema.parties.deletedAt} is null
          and lower(${schema.parties.name}) = ${WALK_IN_PARTY_NAME.toLowerCase()}`,
      );
    if (found) {
      if (found.type !== "customer")
        throw new AppError(
          "INVALID_VOUCHER",
          `A supplier is called "${WALK_IN_PARTY_NAME}". Rename it to make retail bills.`,
          400,
        );
      return found.id;
    }
    const [firm] = await tx
      .select({ stateCode: schema.firmProfile.stateCode })
      .from(schema.firmProfile)
      .where(eq(schema.firmProfile.firmId, firmId));
    if (!firm) throw notFound("firm");
    const id = uuidv7();
    await tx.insert(schema.parties).values({
      id,
      firmId,
      name: WALK_IN_PARTY_NAME,
      type: "customer",
      stateCode: firm.stateCode,
      openingDate: today(),
    });
    return id;
  });
}

async function invoice(
  db: Db,
  ctx: Ctx,
  type: "sale" | "purchase",
  input: NewInvoiceInput,
) {
  const voucher = await change(
    db,
    ctx,
    {
      parties: [input.partyId],
      items: lineItems(input.lines),
      vouchers: input.sourceId ? [input.sourceId] : [],
    },
    async (snap, tx) => {
      findParty(snap, input.partyId, type === "sale" ? "customer" : "supplier");
      checkItems(snap, input.lines);
      if (input.paidNow) checkLedger(snap, input.paidNow.ledgerId, "paidNow");
      const associates =
        type === "sale"
          ? await prepareInvoiceAssociates(tx, ctx, input, input.date)
          : {};
      return Object.assign(
        core(() =>
          type === "sale"
            ? createSale(snap.books, input)
            : createPurchase(snap.books, input),
        ),
        associates,
      );
    },
    (tx, saved) => enforceSaleCredit(tx, ctx, input, [saved]),
  );
  return voucher;
}

async function money(
  db: Db,
  ctx: Ctx,
  type: "receipt" | "payment",
  input: NewMoneyInput,
) {
  const voucher = await change(
    db,
    ctx,
    { parties: [input.partyId], vouchers: billIds(input) },
    (snap) => {
      findParty(snap, input.partyId);
      checkLedger(snap, input.ledgerId, "ledgerId");
      checkAllocations(snap, input.partyId, type, input);
      return core(() =>
        type === "receipt"
          ? createReceipt(snap.books, input)
          : createPayment(snap.books, input),
      );
    },
  );
  return voucher;
}

/** The voucher named in the URL, if it is in this firm and the caller may change it and saw its latest version. */
/** Restoring cancelled entries needs its own right (the owner by default; doc 37, T47/T57). */
function requireOwner(role: Role) {
  if (!roleFlag(role, "restoreCancelled"))
    throw new AppError(
      "FORBIDDEN",
      "Only the owner can see and restore cancelled entries.",
      403,
    );
}

/** Roles limited to their own records may only touch entries they created (doc 37, T57). */
export function requireOwnRecord(
  role: Role,
  ctx: { id: string },
  v: { createdBy?: string },
) {
  if (roleFlag(role, "ownRecordsOnly") && v.createdBy !== ctx.id)
    throw new AppError(
      "FORBIDDEN",
      "Your role can only change entries you made yourself.",
      403,
    );
}

function existing(snap: Snapshot, ctx: Ctx, id: string, version: number) {
  const v = snap.books.vouchers.find((x) => x.id === id);
  if (!v) throw notFound("entry");
  requireRight(ctx.role, v.type, "view");
  requireOwnRecord(ctx.role, ctx, v);
  if (snap.versions.get(id) !== version) throw editedElsewhere("entry");
  return v;
}

function out(
  v: CoreVoucher,
  versions: Map<string, number>,
  idOf: (id: string) => string,
): Voucher {
  return toVoucher({ ...v, id: idOf(v.id) }, versions.get(v.id) ?? 1);
}

/** The core voucher as the API sends it. */
export function toVoucher(v: CoreVoucher, version: number): Voucher {
  const { pendingSync: _pending, ...rest } = v;
  void _pending;
  return { ...rest, version };
}

export async function readBooks(db: Db, firmId: string) {
  const [books, versionRows] = await Promise.all([
    loadReportBooks(db, firmId),
    db
      .select({ id: schema.vouchers.id, version: schema.vouchers.version })
      .from(schema.vouchers)
      .where(eq(schema.vouchers.firmId, firmId)),
  ]);
  const versions = new Map(versionRows.map((row) => [row.id, row.version]));
  return {
    books,
    apiVoucher: (voucher: CoreVoucher) =>
      toVoucher(voucher, versions.get(voucher.id) ?? 1),
  };
}

function hasInvoiceTotals(voucher: CoreVoucher) {
  return (
    voucher.type === "sale" ||
    voucher.type === "purchase" ||
    voucher.type === "credit-note" ||
    voucher.type === "debit-note" ||
    isOrderType(voucher.type)
  );
}

function linkedVoucher(voucher?: CoreVoucher) {
  return voucher
    ? {
        id: voucher.id,
        number: voucher.number,
        type: voucher.type,
        date: voucher.date,
      }
    : undefined;
}

function convertibleTargets(voucher: CoreVoucher) {
  if (!isOrderType(voucher.type)) return [];
  if (voucher.status !== "posted" || voucher.convertedToId) return [];
  return CONVERTS_TO[voucher.type];
}

function returnableLines(vouchers: CoreVoucher[], bill: CoreVoucher) {
  const notes = vouchers.filter(
    (voucher) => voucher.status === "posted" && voucher.againstId === bill.id,
  );

  return (bill.lines ?? []).map((line, index) => {
    const returned = notes
      .flatMap((note) => note.lines ?? [])
      .filter((noteLine) => noteLine.sourceLine === index)
      .reduce((sum, noteLine) => sum + noteLine.qty, 0);
    return {
      index,
      line,
      returned,
      returnable: Math.max(line.qty - returned, 0),
    };
  });
}

async function voucherHistory(db: Db, firmId: string, voucherId: string) {
  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(
      sql`${schema.auditLog.firmId} = ${firmId}::uuid
        and ${schema.auditLog.voucherId} = ${voucherId}::uuid`,
    )
    .orderBy(asc(schema.auditLog.at));

  return rows.map((row) => ({
    id: row.id,
    voucherId: row.voucherId,
    number: row.number,
    voucherType: row.voucherType,
    action: row.action,
    at: row.at.toISOString(),
    userId: row.userId,
    userName: row.userName,
    changes: row.changes as { field: string; before: string; after: string }[],
    note: row.note ?? undefined,
  }));
}
