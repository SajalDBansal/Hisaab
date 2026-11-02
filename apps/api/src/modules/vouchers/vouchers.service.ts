import {
  can,
  describeAccount,
  calcInvoice,
  cancelBlocker,
  cancelVoucher,
  CONVERTS_TO,
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
  editBlocker,
  financialYear,
  invoiceStatus,
  isOrderType,
  newestFirst,
  orderStatus,
  openingBillId,
  partyBills,
  postingTotals,
  returnAmountBasis,
  setCleared,
  settledAmounts,
  today,
  updateInvoice,
  voucherPostings,
  type Permission,
  type Role,
  type Voucher as CoreVoucher,
  type VoucherType,
} from "@repo/core";
import type {
  InvoiceRow,
  NewContraInput,
  NewExpenseInput,
  NewInvoiceInput,
  NewJournalInput,
  NewMoneyInput,
  NewNoteInput,
  NewOrderInput,
  OrderRow,
  ReturnableBill,
  Voucher,
  VoucherDetail,
} from "@repo/contracts";
import { and, asc, eq, sql } from "drizzle-orm";
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
type Series = "bos" | "nongst";

/** Which right a voucher type needs (the same split as the app's roles). */
export const NEEDS: Record<VoucherType, Permission> = {
  sale: "sales",
  "credit-note": "sales",
  receipt: "sales",
  estimate: "sales",
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

export function requireRight(role: Role, type: VoucherType) {
  if (!can(role, NEEDS[type]))
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
          requireRight(ctx.role, voucher.type);
        return seen;
      }
    }
    const snap = await loadBooks(tx, ctx.firmId, ctx, scope);
    const result = await work(snap, tx);
    for (const v of [result].flat()) requireRight(member.role as Role, v.type);
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
    const voucher = await change(db, ctx, {}, (snap) => {
      checkLedger(snap, input.ledgerId, "ledgerId");
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

    const prefixes = settings.prefixes as Record<string, string>;
    const prefix =
      series === "nongst"
        ? `N${prefixes[type]}`
        : series === "bos"
          ? settings.billOfSupplyPrefix
          : prefixes[type];
    const year = financialYear(date).short;
    const [counter] = await db
      .select()
      .from(schema.voucherCounters)
      .where(
        sql`${schema.voucherCounters.firmId} = ${firmId}::uuid
          and ${schema.voucherCounters.type} = ${type}
          and ${schema.voucherCounters.series} = ${prefix}
          and ${schema.voucherCounters.financialYear} = ${year}`,
      );
    const next = (counter?.lastNumber ?? 0) + 1;
    return `${prefix}/${year}/${String(next).padStart(4, "0")}`;
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
  "estimate" | "sales-order" | "delivery-note" | "purchase-order";

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
function existing(snap: Snapshot, ctx: Ctx, id: string, version: number) {
  const v = snap.books.vouchers.find((x) => x.id === id);
  if (!v) throw notFound("entry");
  requireRight(ctx.role, v.type);
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

async function readBooks(db: Db, firmId: string) {
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
