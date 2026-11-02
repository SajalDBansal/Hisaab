import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { v7 as requestId } from "uuid";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
} from "@repo/contracts";
import { createDb } from "@repo/backend/db/client";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";

// Explicit opt-in; these checks may only write to the dedicated local fixture database.
const databaseUrl = process.env.FINANCE_DATABASE_URL;
if (databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/hardening_finance"
  )
    throw new Error("Use only the local hardening_finance fixture database.");
}

describe.skipIf(!databaseUrl)(
  "A02/A03 authenticated financial regressions",
  () => {
    let database: ReturnType<typeof createDb>;
    let app: Awaited<ReturnType<typeof buildApp>>;
    let cookie = "";
    const origin = "http://localhost:3107";
    const email = memorySender();

    async function request(
      method: "GET" | "POST",
      url: string,
      payload?: unknown,
      firmId?: string,
      extra: Record<string, string> = {},
    ) {
      return app.inject({
        method,
        url,
        payload,
        headers: {
          host: "localhost:3107",
          origin,
          cookie,
          "user-agent": "financial-fixture",
          [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
          ...(firmId ? { "x-firm-id": firmId } : {}),
          ...(method === "POST" ? { "idempotency-key": requestId() } : {}),
          ...extra,
        },
      });
    }

    async function success(
      method: "GET" | "POST",
      url: string,
      payload?: unknown,
      firmId?: string,
      status = 201,
      extra: Record<string, string> = {},
    ) {
      const result = await request(method, url, payload, firmId, extra);
      expect({ status: result.statusCode, error: result.json().error }).toEqual(
        { status, error: undefined },
      );
      return result.json();
    }

    beforeAll(async () => {
      if (!databaseUrl)
        throw new Error("The fixture database was not configured.");
      database = createDb(databaseUrl, { max: 4 });
      app = await buildApp({
        db: database.db,
        email: email.sender,
        env: {
          NODE_ENV: "test",
          LOG_LEVEL: "silent",
          BETTER_AUTH_URL: origin,
          BETTER_AUTH_SECRET:
            "synthetic-finance-fixture-secret-32-characters-minimum",
          TRUSTED_ORIGINS: [origin],
        },
      });
      const address = `finance-${randomUUID()}@example.invalid`;
      await success(
        "POST",
        "/api/auth/sign-up/email",
        {
          email: address,
          password: "SyntheticFixtureOnly-2026!",
          name: "Finance fixture",
          phoneNumber: `9${Date.now().toString().slice(-9)}`,
        },
        undefined,
        200,
      );
      const verified = await request(
        "POST",
        "/api/auth/email-otp/verify-email",
        { email: address, otp: email.lastCode(address) },
      );
      expect(verified.statusCode).toBe(200);
      cookie = verified.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      expect(cookie.length).toBeGreaterThan(0);
    }, 30000);

    afterAll(async () => {
      await app?.close();
      await database?.pool.end();
    });

    async function fixture(
      type: "customer" | "supplier",
      scope: "gst" | "nongst",
    ) {
      const firm = await success("POST", "/v1/firms", {
        name: `Finance ${randomUUID()}`,
        city: "Mathura",
        stateCode: "09",
        gstRegistration: "regular",
        gstin: "09AAAAA0000A1Z0",
      });
      const party = await success(
        "POST",
        "/v1/parties",
        {
          name: `${type} fixture`,
          type,
          phone: "",
          city: "Mathura",
          stateCode: "09",
          creditDays: 0,
          creditLimit: 0,
          openingBalance: 0,
        },
        firm.id,
      );
      const cash = (
        await success("GET", "/v1/ledgers", undefined, firm.id, 200)
      ).find((row: { kind: string }) => row.kind === "cash");
      return { firmId: firm.id as string, party, cash, scope };
    }

    async function counts() {
      return (
        await database.pool.query(
          "select (select count(*) from vouchers) as vouchers, (select count(*) from settlement_entries) as settlements, (select count(*) from postings) as postings, (select count(*) from operation_receipts) as receipts, (select count(*) from idempotency_keys) as retry_keys",
        )
      ).rows[0];
    }

    for (const scope of ["gst", "nongst"] as const)
      for (const type of ["customer", "supplier"] as const) {
        test(`${scope} ${type}: reject a refund in an exhausted historical interval without writing`, async () => {
          const f = await fixture(type, scope);
          const kind =
            type === "customer" ? "advance-receipt" : "advance-payment";
          const refund =
            type === "customer" ? "customer-refund" : "supplier-refund";
          const input = (entryKind: string, date: string) => ({
            kind: entryKind,
            partyId: f.party.id,
            partyVersion: f.party.version,
            ledgerId: f.cash.id,
            bookScope: scope,
            reason: "Financial regression fixture",
            amount: 10000,
            date,
          });
          const advance = await success(
            "POST",
            "/v1/settlements",
            input(kind, "2026-10-01"),
            f.firmId,
          );
          const first = await success(
            "POST",
            "/v1/settlements",
            input(refund, "2026-10-05"),
            f.firmId,
          );
          await success(
            "POST",
            "/v1/settlements",
            input(kind, "2026-10-10"),
            f.firmId,
          );
          const before = await counts();
          const blocked = await request(
            "POST",
            "/v1/settlements",
            input(refund, "2026-10-02"),
            f.firmId,
          );
          expect(blocked.statusCode).toBe(422);
          expect(blocked.json().error.code).toBe("INVALID_SETTLEMENT");
          expect(await counts()).toEqual(before);
          const invalidReversal = await request(
            "POST",
            `/v1/settlements/${advance.id}/reverse`,
            {
              date: "2026-10-02",
              bookScope: scope,
              reason: "Advance was already consumed later",
              version: advance.version,
            },
            f.firmId,
          );
          expect(invalidReversal.statusCode).toBe(409);
          expect(invalidReversal.json().error.code).toBe("SETTLEMENT_CONFLICT");
          expect(await counts()).toEqual(before);
          const otherBook = scope === "gst" ? "nongst" : "gst";
          const crossBook = await request(
            "POST",
            "/v1/settlements",
            { ...input(refund, "2026-10-10"), bookScope: otherBook },
            f.firmId,
          );
          expect(crossBook.statusCode).toBe(422);
          await success(
            "POST",
            `/v1/settlements/${first.id}/reverse`,
            {
              date: "2026-10-10",
              bookScope: scope,
              reason: "Reverse refund fixture",
              version: first.version,
            },
            f.firmId,
          );
          const stillBlocked = await request(
            "POST",
            "/v1/settlements",
            input(refund, "2026-10-02"),
            f.firmId,
          );
          expect(stillBlocked.statusCode).toBe(422);
          await success(
            "POST",
            "/v1/settlements",
            input(refund, "2026-10-11"),
            f.firmId,
          );
          await success(
            "POST",
            `/v1/settlements/${advance.id}/reverse`,
            {
              date: "2026-10-11",
              bookScope: scope,
              reason: "Remaining credit is available for reversal",
              version: advance.version,
            },
            f.firmId,
          );
        }, 30000);
      }

    test("concurrent refunds serialize and identical retries return one result", async () => {
      const f = await fixture("customer", "nongst");
      const base = {
        partyId: f.party.id,
        partyVersion: f.party.version,
        ledgerId: f.cash.id,
        bookScope: f.scope,
        reason: "Concurrent fixture",
        amount: 10000,
        date: "2026-10-15",
      };
      await success(
        "POST",
        "/v1/settlements",
        { ...base, kind: "advance-receipt" },
        f.firmId,
      );
      const refund = { ...base, kind: "customer-refund" };
      const attempts = await Promise.all([
        request("POST", "/v1/settlements", refund, f.firmId),
        request("POST", "/v1/settlements", refund, f.firmId),
      ]);
      expect(attempts.map((r) => r.statusCode).sort()).toEqual([201, 422]);
      await success(
        "POST",
        "/v1/settlements",
        { ...base, kind: "advance-receipt" },
        f.firmId,
      );
      const before = await counts(),
        key = requestId();
      const retries = await Promise.all([
        request("POST", "/v1/settlements", refund, f.firmId, {
          "idempotency-key": key,
        }),
        request("POST", "/v1/settlements", refund, f.firmId, {
          "idempotency-key": key,
        }),
      ]);
      expect(retries.map((r) => r.statusCode)).toEqual([201, 201]);
      expect(retries[0].json().id).toBe(retries[1].json().id);
      expect(
        Number((await counts()).settlements) - Number(before.settlements),
      ).toBe(1);
    }, 30000);

    for (const scope of ["gst", "nongst"] as const)
      for (const step of [1, 0.001])
        for (const cancel of [0, 1]) {
          test(`${scope}: persist ${step}-unit returns, cancellation ${cancel + 1}, reports and resale`, async () => {
            const f = await fixture("customer", scope);
            const supplier = await success(
              "POST",
              "/v1/parties",
              {
                name: "supplier fixture",
                type: "supplier",
                phone: "",
                city: "Mathura",
                stateCode: "09",
                // A supplier charging GST must be registered.
                gstin: "09BBBBB1111B1ZL",
                creditDays: 0,
                creditLimit: 0,
                openingBalance: 0,
              },
              f.firmId,
            );
            const item = await success(
              "POST",
              "/v1/items",
              {
                name: "Stock fixture",
                code: "",
                hsn: "1001",
                group: "",
                taxType: "taxable",
                gstRate: 18,
                unit: "Nos",
                purchasePrice: 100,
                salePrice: 100,
                mrp: 0,
                reorderLevel: 0,
                openingStock: 0,
              },
              f.firmId,
            );
            const purchase = await success(
              "POST",
              "/v1/purchases",
              {
                date: "2026-10-01",
                partyId: supplier.id,
                bookScope: scope,
                charges: [],
                lines: [
                  {
                    itemId: item.id,
                    qty: step * 3,
                    rate: 100 / step,
                    discountAmount: 200,
                    gstRate: 18,
                  },
                ],
              },
              f.firmId,
            );
            const baseline = await success(
              "GET",
              "/v1/reports/final-accounts",
              undefined,
              f.firmId,
              200,
            );
            const line = {
              itemId: item.id,
              qty: step * 3,
              rate: 100 / step,
              gstRate: 18,
              stockLotId: purchase.lines[0].stockLotId,
            };
            const sale = await success(
              "POST",
              "/v1/sales",
              {
                date: "2026-10-02",
                partyId: f.party.id,
                charges: [],
                lines: [line],
              },
              f.firmId,
            );
            const note = (day: number) =>
              success(
                "POST",
                "/v1/credit-notes",
                {
                  againstId: sale.id,
                  date: `2026-10-${day.toString().padStart(2, "0")}`,
                  reason: "Return goods fixture",
                  lines: [{ index: 0, qty: step }],
                },
                f.firmId,
              );
            const first = await note(3),
              second = await note(4);
            expect([
              first.lines[0].stockCost,
              second.lines[0].stockCost,
            ]).toEqual([33, 34]);
            const cancelled = [first, second][cancel],
              surviving = [first, second][1 - cancel];
            await success(
              "POST",
              `/v1/vouchers/${cancelled.id}/cancel`,
              { reason: "Correct return fixture" },
              f.firmId,
              200,
              { "if-match": String(cancelled.version) },
            );
            const third = await note(6),
              fourth = await note(7);
            expect(
              surviving.lines[0].stockCost +
                third.lines[0].stockCost +
                fourth.lines[0].stockCost,
            ).toBe(100);
            const lots = await success(
              "GET",
              "/v1/items/stock-lots",
              undefined,
              f.firmId,
              200,
            );
            expect(
              lots.find((lot: { id: string }) => lot.id === line.stockLotId),
            ).toMatchObject({ qty: step * 3, value: 100 });
            const final = await success(
              "GET",
              "/v1/reports/final-accounts",
              undefined,
              f.firmId,
              200,
            );
            expect(final.profitAndLoss.netProfit).toBe(
              baseline.profitAndLoss.netProfit,
            );
            const saved = await database.pool.query(
              "select stock_cost from voucher_lines where voucher_id=$1",
              [surviving.id],
            );
            expect(Number(saved.rows[0].stock_cost)).toBe(
              surviving.lines[0].stockCost,
            );
            const resale = await success(
              "POST",
              "/v1/sales",
              {
                date: "2026-10-08",
                partyId: f.party.id,
                charges: [],
                lines: [line],
              },
              f.firmId,
            );
            expect(resale.lines[0].stockCost).toBe(100);
          }, 30000);
        }
  },
);
