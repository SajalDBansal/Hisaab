import assert from "node:assert/strict";
import { test } from "node:test";
import { schema } from "@repo/backend/db/client";
import { and, eq } from "drizzle-orm";
import { catalogFixture } from "./catalog-fixture";

type List = {
  id: string;
  name: string;
  side: string;
  version: number;
  isDefault: boolean;
  rates: { itemId: string; rate: number; unit?: string }[];
};

test(
  "price lists: percent and per-item lists, parties, defaults and costs (T36)",
  { skip: !process.env.HISAAB_DATA_TEST_URL, timeout: 120_000 },
  async () => {
    const f = await catalogFixture("pricelist");
    const { owner, call, ok } = f;
    try {
      const item = await f.item({ code: "OIL1" });
      const boxed = await f.item({
        code: "SOAP",
        altUnit: { name: "Box", factor: 12 },
      });

      // A % list; a per-item list (one rate per box); checks on bad input.
      const wholesale = await ok<List>(
        owner,
        "POST",
        "/v1/settings/price-lists",
        {
          name: "Wholesale",
          side: "sale",
          mode: "percent",
          percent: -5,
          isDefault: true,
        },
      );
      assert.equal(wholesale.isDefault, true);
      const dealer = await ok<List>(owner, "POST", "/v1/settings/price-lists", {
        name: "Dealer",
        side: "sale",
        mode: "rates",
        rates: [
          { itemId: item.id, rate: 12000 },
          { itemId: boxed.id, rate: 150000, unit: "Box" },
        ],
      });
      assert.deepEqual(dealer.rates, [
        { itemId: item.id, rate: 12000 },
        { itemId: boxed.id, rate: 150000, unit: "Box" },
      ]);
      for (const bad of [
        { name: "wholesale", side: "sale", mode: "percent", percent: 1 },
        { name: "Far", side: "sale", mode: "percent", percent: -101 },
        {
          name: "Unit",
          side: "sale",
          mode: "rates",
          rates: [{ itemId: item.id, rate: 1, unit: "Kg" }],
        },
        {
          name: "Twice",
          side: "sale",
          mode: "rates",
          rates: [
            { itemId: item.id, rate: 1 },
            { itemId: item.id, rate: 2 },
          ],
        },
        {
          name: "Stranger",
          side: "sale",
          mode: "rates",
          rates: [{ itemId: f.firmId(), rate: 1 }],
        },
      ]) {
        const reply = await call(
          owner,
          "POST",
          "/v1/settings/price-lists",
          bad,
        );
        assert.equal(reply.statusCode, 400, `${bad.name}: ${reply.body}`);
      }
      // A second default replaces the first on that side.
      const special = await ok<List>(
        owner,
        "POST",
        "/v1/settings/price-lists",
        {
          name: "Special",
          side: "sale",
          mode: "percent",
          percent: 10,
          isDefault: true,
        },
      );
      const lists = await ok<List[]>(owner, "GET", "/v1/settings/price-lists");
      assert.deepEqual(
        lists.filter((l) => l.isDefault).map((l) => l.id),
        [special.id],
      );
      // The side is fixed; If-Match guards edits.
      const flip = await call(
        owner,
        "PUT",
        `/v1/settings/price-lists/${dealer.id}`,
        { name: "Dealer", side: "purchase", mode: "percent", percent: 0 },
        { "if-match": String(dealer.version) },
      );
      assert.equal(flip.statusCode, 409, flip.body);
      const stale = await call(
        owner,
        "PUT",
        `/v1/settings/price-lists/${dealer.id}`,
        { name: "Dealer", side: "sale", mode: "percent", percent: 0 },
        { "if-match": "9" },
      );
      assert.equal(stale.statusCode, 409, stale.body);

      // A purchase list: costs, hidden from a role without cost rights.
      const buying = await ok<List>(owner, "POST", "/v1/settings/price-lists", {
        name: "Buying",
        side: "purchase",
        mode: "percent",
        percent: 2,
      });

      // Parties: a customer takes a sale list, a supplier a purchase list.
      const customer = await f.party("customer", { priceListId: dealer.id });
      const detail = await ok<{ priceListId?: string; version: number }>(
        owner,
        "GET",
        `/v1/parties/${customer.id}`,
      );
      assert.equal(detail.priceListId, dealer.id);
      const wrongSide = await call(owner, "POST", "/v1/parties", {
        name: "Wrong side",
        type: "supplier",
        phone: "",
        city: "Delhi",
        stateCode: "07",
        gstin: "",
        creditDays: 0,
        creditLimit: 0,
        openingBalance: 0,
        priceListId: dealer.id,
      });
      assert.equal(wrongSide.statusCode, 400, wrongSide.body);
      const supplier = await f.party("supplier", { priceListId: buying.id });
      // An edit without the field keeps it; null clears it.
      const body = {
        name: `Kept ${f.tag}`,
        type: "customer",
        phone: "",
        city: "Delhi",
        stateCode: "07",
        gstin: "",
        creditDays: 0,
        creditLimit: 0,
        openingBalance: 0,
      };
      const kept = await ok<{ priceListId?: string; version: number }>(
        owner,
        "PUT",
        `/v1/parties/${customer.id}`,
        body,
        { "if-match": String(customer.version) },
      );
      assert.equal(kept.priceListId, dealer.id);
      const cleared = await ok<{ priceListId?: string }>(
        owner,
        "PUT",
        `/v1/parties/${customer.id}`,
        { ...body, priceListId: null },
        { "if-match": String(kept.version) },
      );
      assert.equal(cleared.priceListId, undefined);

      // Sales staff read the sale lists only and change none.
      const clerk = await f.account("clerk");
      await f.db.insert(schema.member).values({
        organizationId: f.firmId(),
        userId: clerk.id,
        role: "sales",
      });
      const seen = await ok<List[]>(clerk, "GET", "/v1/settings/price-lists");
      assert.ok(seen.every((l) => l.side === "sale"));
      assert.equal(seen.length, 3);
      const denied = await call(clerk, "POST", "/v1/settings/price-lists", {
        name: "Mine",
        side: "sale",
        mode: "percent",
        percent: 1,
      });
      assert.equal(denied.statusCode, 403, denied.body);

      // The firm export carries the lists and the parties' links.
      const data = await f.exported<{
        priceLists: List[];
        parties: { id: string; priceListId: string | null }[];
      }>();
      assert.equal(data.priceLists.length, 4);
      assert.equal(
        data.parties.find((p) => p.id === supplier.id)?.priceListId,
        buying.id,
      );
      const [row] = await f.db
        .select({ priceListId: schema.parties.priceListId })
        .from(schema.parties)
        .where(
          and(
            eq(schema.parties.firmId, f.firmId()),
            eq(schema.parties.id, customer.id),
          ),
        );
      assert.equal(row?.priceListId, null);
      void wholesale;
    } finally {
      await f.close();
    }
  },
);
