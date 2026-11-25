import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogFixture } from "./catalog-fixture";

type ItemRow = {
  id: string;
  name: string;
  code: string;
  version: number;
  parentId?: string;
  variantValues?: { name: string; value: string }[];
  variantAttributes?: { name: string; values: string[] }[];
};
type Made = { parent: ItemRow; created: ItemRow[] };
type Row = { cells: (string | number)[]; total?: boolean };

test(
  "item variants: generated items, never billing the parent, grouped reports (T35)",
  { skip: !process.env.HISAAB_DATA_TEST_URL, timeout: 120_000 },
  async () => {
    const f = await catalogFixture("variants");
    const { owner, call, ok, today } = f;
    try {
      const shirt = await f.item({ name: `Shirt ${f.tag}`, code: "SH" });
      const make = (version: number, values: string[], extra: object[] = []) =>
        call(
          owner,
          "POST",
          `/v1/items/${shirt.id}/variants`,
          {
            attributes: [{ name: "Size", values }, ...extra],
          },
          { "if-match": String(version) },
        );
      const first = await make(
        shirt.version,
        ["S", "M"],
        [{ name: "Colour", values: ["Red"] }],
      );
      assert.equal(first.statusCode, 201, first.body);
      const made = first.json<Made>();
      assert.deepEqual(
        made.created.map((c) => [c.name, c.code, c.parentId]),
        [
          [`Shirt ${f.tag} – S / Red`, "SH-S-RED", shirt.id],
          [`Shirt ${f.tag} – M / Red`, "SH-M-RED", shirt.id],
        ],
      );
      assert.equal(made.parent.variantAttributes?.length, 2);
      // Stale version, removed values and changed attributes are refused.
      assert.equal(
        (await make(shirt.version, ["S", "M", "L"])).statusCode,
        409,
      );
      const removed = await make(
        made.parent.version,
        ["S"],
        [{ name: "Colour", values: ["Red"] }],
      );
      assert.equal(removed.statusCode, 400, removed.body);
      const more = await make(
        made.parent.version,
        ["S", "M", "L"],
        [{ name: "Colour", values: ["Red"] }],
      );
      assert.equal(more.statusCode, 201, more.body);
      const added = more.json<Made>();
      assert.deepEqual(
        added.created.map((c) => c.code),
        ["SH-L-RED"],
      );
      // A variant can't have variants; a used item can't become a parent.
      const [small, medium] = made.created;
      assert.ok(small && medium);
      const nested = await call(
        owner,
        "POST",
        `/v1/items/${small.id}/variants`,
        { attributes: [{ name: "Fit", values: ["Slim"] }] },
        { "if-match": String(small.version) },
      );
      assert.equal(nested.statusCode, 409, nested.body);

      const supplier = await f.party("supplier");
      const customer = await f.party("customer");
      await ok(owner, "POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [
          { itemId: small.id, qty: 5, rate: 10000, gstRate: 0 },
          { itemId: medium.id, qty: 5, rate: 10000, gstRate: 0 },
        ],
        charges: [],
      });
      const used = await call(
        owner,
        "POST",
        `/v1/items/${small.id}/variants`,
        { attributes: [{ name: "Fit", values: ["Slim"] }] },
        { "if-match": String(small.version) },
      );
      assert.equal(used.statusCode, 409, used.body);
      const parentSale = await call(owner, "POST", "/v1/sales/split", {
        partyId: customer.id,
        date: today,
        lines: [{ itemId: shirt.id, qty: 1, rate: 15000, gstRate: 0 }],
        charges: [],
      });
      assert.equal(parentSale.statusCode, 400, parentSale.body);
      await ok(owner, "POST", "/v1/sales/split", {
        partyId: customer.id,
        date: today,
        lines: [
          { itemId: small.id, qty: 2, rate: 15000, gstRate: 0 },
          { itemId: medium.id, qty: 1, rate: 15000, gstRate: 0 },
        ],
        charges: [],
      });

      const report = async (name: string, groupByParent: boolean) =>
        (
          (
            await ok<{ sections: { rows: Row[] }[] }>(
              owner,
              "POST",
              "/v1/reports/export",
              {
                report: name,
                from: today,
                to: today,
                includeNarration: false,
                includeZeroBalances: false,
                groupByParent,
              },
            )
          ).sections[0]?.rows ?? []
        ).filter((r) => !r.total);
      const grouped = await report("sales-by-item", true);
      assert.deepEqual(
        grouped.map((r) => [r.cells[0], r.cells[3], r.cells[4]]),
        [[`Shirt ${f.tag}`, 3, 45000]],
      );
      assert.equal((await report("sales-by-item", false)).length, 2);
      const stock = await report("stock", true);
      assert.deepEqual(
        stock
          .filter((r) => r.cells[1] === `Shirt ${f.tag}`)
          .map((r) => r.cells[2]),
        [7],
      );

      // The firm export carries the parent link and the attributes.
      const data = await f.exported<{
        items: {
          id: string;
          parentId: string | null;
          variantAttributes: unknown;
        }[];
      }>();
      assert.equal(data.items.filter((i) => i.parentId === shirt.id).length, 3);
      assert.ok(data.items.find((i) => i.id === shirt.id)?.variantAttributes);
    } finally {
      await f.close();
    }
  },
);
