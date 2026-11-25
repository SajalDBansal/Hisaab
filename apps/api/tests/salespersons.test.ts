import assert from "node:assert/strict";
import { test } from "node:test";
import { schema } from "@repo/backend/db/client";
import { and, eq } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";

type Sp = { id: string; name: string; version: number; userId?: string };
type Row = { cells: (string | number)[] };

test(
  "salespersons: master, on sales and orders, reports and own records (T10)",
  { skip: !process.env.HISAAB_DATA_TEST_URL, timeout: 120_000 },
  async () => {
    const f = await catalogFixture("salesperson");
    const { owner, call, ok, today } = f;
    try {
      const counter = await f.account("counter");
      await f.db.insert(schema.member).values({
        organizationId: f.firmId(),
        userId: counter.id,
        role: "sales",
      });
      const [member] = await f.db
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, f.firmId()),
            eq(schema.member.userId, counter.id),
          ),
        );
      // A counter role limited to its own records.
      const roles = await ok<{ custom: { id: string; name: string }[] }>(
        owner,
        "POST",
        "/v1/firms/current/roles",
        {
          name: "Counter",
          rights: {
            permissions: ["sales"],
            vouchers: {
              sale: ["view", "create", "edit"],
              "sales-order": ["view", "create"],
            },
            flags: {
              hidePurchaseRate: true,
              viewProfitMargin: false,
              ownRecordsOnly: true,
              viewAudit: false,
              restoreCancelled: false,
            },
          },
        },
      );
      const role = roles.custom.find((r) => r.name === "Counter");
      assert.ok(role && member);
      await ok(owner, "PATCH", `/v1/firms/current/members/${member.id}`, {
        role: role.id,
      });

      // The master: names are unique, a login links to one salesperson only.
      const ravi = await ok<Sp>(owner, "POST", "/v1/settings/salespersons", {
        name: "Ravi",
        userId: counter.id,
        phone: "98100 00000",
        active: true,
      });
      const anil = await ok<Sp>(owner, "POST", "/v1/settings/salespersons", {
        name: "Anil",
        active: true,
      });
      const twice = await call(owner, "POST", "/v1/settings/salespersons", {
        name: "ravi",
        active: true,
      });
      assert.equal(twice.statusCode, 400, twice.body);
      const linkedTwice = await call(
        owner,
        "PUT",
        `/v1/settings/salespersons/${anil.id}`,
        { name: "Anil", userId: counter.id, active: true },
        { "if-match": String(anil.version) },
      );
      assert.equal(linkedTwice.statusCode, 400, linkedTwice.body);
      const stranger = await call(owner, "POST", "/v1/settings/salespersons", {
        name: "Stranger",
        userId: f.firmId(),
        active: true,
      });
      assert.equal(stranger.statusCode, 400, stranger.body);
      // Only the settings right changes them; everyone reads them, with their own one.
      const denied = await call(counter, "POST", "/v1/settings/salespersons", {
        name: "Self",
        active: true,
      });
      assert.equal(denied.statusCode, 403, denied.body);
      const list = await ok<{ rows: Sp[]; mine: string | null }>(
        counter,
        "GET",
        "/v1/settings/salespersons",
      );
      assert.equal(list.mine, ravi.id);
      assert.deepEqual(
        list.rows.map((s) => s.name),
        ["Anil", "Ravi"],
      );
      const ownerList = await ok<{ mine: string | null }>(
        owner,
        "GET",
        "/v1/settings/salespersons",
      );
      assert.equal(ownerList.mine, null);

      const supplier = await f.party("supplier");
      const customer = await f.party("customer");
      const item = await f.item();
      await ok(owner, "POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [{ itemId: item.id, qty: 20, rate: 10000, gstRate: 0 }],
        charges: [],
      });
      const saleBody = (salespersonId?: string | null, qty = 1) => ({
        partyId: customer.id,
        date: today,
        lines: [{ itemId: item.id, qty, rate: 15000, gstRate: 0 }],
        charges: [],
        ...(salespersonId !== undefined ? { salespersonId } : {}),
      });
      type Bill = { id: string; version: number; salespersonId?: string };
      const sell = async (salespersonId?: string | null, qty = 1) => {
        const [bill] = await ok<Bill[]>(
          owner,
          "POST",
          "/v1/sales/split",
          saleBody(salespersonId, qty),
        );
        assert.ok(bill);
        return bill;
      };
      const byRavi = await sell(ravi.id, 2);
      const byAnil = await sell(anil.id);
      const nobody = await sell();
      assert.equal(byRavi.salespersonId, ravi.id);
      assert.equal(nobody.salespersonId, undefined);
      const unknown = await call(
        owner,
        "POST",
        "/v1/sales/split",
        saleBody(f.firmId()),
      );
      assert.equal(unknown.statusCode, 400, unknown.body);
      // A purchase never carries one.
      const buy = await call(owner, "POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [{ itemId: item.id, qty: 1, rate: 10000, gstRate: 0 }],
        charges: [],
        salespersonId: ravi.id,
      });
      assert.equal(buy.statusCode, 400, buy.body);

      // A sales order with Ravi; Anil switched off can't be picked again,
      // but stays on his bill and an edit keeps him.
      await ok(owner, "POST", "/v1/orders/sales-order", {
        partyId: customer.id,
        date: today,
        lines: [{ itemId: item.id, qty: 3, rate: 15000, gstRate: 0 }],
        charges: [],
        salespersonId: ravi.id,
      });
      await ok(
        owner,
        "PUT",
        `/v1/settings/salespersons/${anil.id}`,
        { name: "Anil", active: false },
        { "if-match": String(anil.version) },
      );
      const offPick = await call(
        owner,
        "POST",
        "/v1/sales/split",
        saleBody(anil.id),
      );
      assert.equal(offPick.statusCode, 400, offPick.body);
      const edited = await ok<Bill>(
        owner,
        "PUT",
        `/v1/vouchers/${byAnil.id}`,
        saleBody(undefined, 2),
        { "if-match": String(byAnil.version) },
      );
      assert.equal(edited.salespersonId, anil.id);

      // Own records only: the counter made no sale but sees Ravi's.
      const page = await ok<{ items: { voucher: { id: string } }[] }>(
        counter,
        "GET",
        "/v1/vouchers/invoices/page?type=sale&limit=50",
      );
      assert.deepEqual(
        page.items.map((row) => row.voucher.id),
        [byRavi.id],
      );
      assert.equal(
        (await call(counter, "GET", `/v1/vouchers/${byRavi.id}`)).statusCode,
        200,
      );
      assert.equal(
        (await call(counter, "GET", `/v1/vouchers/${nobody.id}`)).statusCode,
        403,
      );
      const listed = await ok<{ items: { id: string }[] }>(
        counter,
        "GET",
        "/v1/vouchers?types=sale",
      );
      assert.deepEqual(
        listed.items.map((v) => v.id),
        [byRavi.id],
      );
      // As its salesperson the counter may change that bill, not the others.
      const counterEdit = await call(
        counter,
        "PUT",
        `/v1/vouchers/${byRavi.id}`,
        saleBody(undefined, 1),
        { "if-match": String(byRavi.version) },
      );
      assert.equal(counterEdit.statusCode, 200, counterEdit.body);
      const otherEdit = await call(
        counter,
        "PUT",
        `/v1/vouchers/${nobody.id}`,
        saleBody(undefined, 1),
        { "if-match": String(nobody.version) },
      );
      assert.equal(otherEdit.statusCode, 403, otherEdit.body);

      // The reports.
      type Doc = { sections: { rows: Row[] }[] };
      const report = async (name: string) =>
        (
          await ok<Doc>(owner, "POST", "/v1/reports/export", {
            report: name,
            from: today,
            to: today,
            includeNarration: false,
            includeZeroBalances: false,
          })
        ).sections[0]?.rows ?? [];
      const row = (rows: Row[], name: string) =>
        rows.find((r) => r.cells[0] === name)?.cells.slice(1);
      const sales = await report("sales-by-salesperson");
      assert.deepEqual(row(sales, "Ravi"), [1, 0, 15000, 0, 15000]);
      assert.deepEqual(row(sales, "Anil"), [1, 0, 30000, 0, 30000]);
      assert.deepEqual(row(sales, "No salesperson"), [1, 0, 15000, 0, 15000]);
      const orders = await report("sales-orders-by-salesperson");
      assert.deepEqual(row(orders, "Ravi"), [1, 1, 45000, 45000]);

      // The firm export carries the master and the voucher link.
      const data = await f.exported<{
        salespersons: { id: string; userId: string | null }[];
        vouchers: { id: string; salespersonId: string | null }[];
      }>();
      assert.equal(data.salespersons.length, 2);
      assert.equal(
        data.vouchers.find((v) => v.id === byRavi.id)?.salespersonId,
        ravi.id,
      );
    } finally {
      await f.close();
    }
  },
);
