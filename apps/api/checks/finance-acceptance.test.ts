import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { v7 as requestId } from "uuid";
import { acc } from "@repo/core";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
} from "@repo/contracts";
import { createDb } from "@repo/backend/db/client";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";

// These authenticated checks can only write to the explicitly selected disposable database.
const databaseUrl = process.env.FINANCE_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/hardening_finance")
    throw new Error("Use only the local hardening_finance fixture database.");
}

type Scope = "gst" | "nongst";
type Account = { id: string; name: string; version: number };
type Firm = { id: string; cash: Account };
type TrialRow = { key: string; debit: number; credit: number };
type Accrual = {
  id: string;
  balance: number;
  earned: number;
  bookScope: Scope;
};

describe.skipIf(!databaseUrl)(
  "Authenticated loan and commission acceptance",
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
      headers: Record<string, string> = {},
    ) {
      return app.inject({
        method,
        url,
        payload,
        headers: {
          host: "localhost:3107",
          origin,
          cookie,
          "user-agent": "finance-acceptance-fixture",
          [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
          ...(firmId ? { "x-firm-id": firmId } : {}),
          ...(method === "POST" ? { "idempotency-key": requestId() } : {}),
          ...headers,
        },
      });
    }

    async function success(
      method: "GET" | "POST",
      url: string,
      payload?: unknown,
      firmId?: string,
      status = method === "POST" ? 201 : 200,
      headers: Record<string, string> = {},
    ) {
      const response = await request(method, url, payload, firmId, headers);
      expect({
        status: response.statusCode,
        error: response.json().error,
      }).toEqual({ status, error: undefined });
      return response.json();
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
      const address = `finance-acceptance-${randomUUID()}@example.invalid`;
      await success(
        "POST",
        "/api/auth/sign-up/email",
        {
          email: address,
          password: "SyntheticFixtureOnly-2026!",
          name: "Finance acceptance",
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

    async function firm(): Promise<Firm> {
      const row = await success("POST", "/v1/firms", {
        name: `Finance ${randomUUID()}`,
        city: "Mathura",
        stateCode: "09",
        gstRegistration: "regular",
        gstin: "09AAAAA0000A1Z0",
      });
      const cash = (
        await success("GET", "/v1/ledgers", undefined, row.id)
      ).find((r: { kind: string }) => r.kind === "cash");
      expect(cash).toBeDefined();
      return { id: row.id, cash };
    }

    const master = (f: Firm, name: string, group: string): Promise<Account> =>
      success(
        "POST",
        "/v1/accounts/masters",
        { name, group, openingBalance: 0 },
        f.id,
      );
    const journal = (
      f: Firm,
      scope: Scope,
      date: string,
      debit: string,
      credit: string,
      amount: number,
    ) =>
      success(
        "POST",
        "/v1/journals",
        {
          date,
          bookScope: scope,
          narration: "Synthetic finance acceptance",
          lines: [
            { account: debit, name: "Debit", debit: amount, credit: 0 },
            { account: credit, name: "Credit", debit: 0, credit: amount },
          ],
        },
        f.id,
      );
    const accountStatement = (
      f: Firm,
      account: string,
      scope: string = "all",
    ) =>
      success(
        "GET",
        `/v1/accounts/${encodeURIComponent(account)}/statement?tax=${scope}`,
        undefined,
        f.id,
      );

    // Compare account signs and all financial totals; GST and non-GST must sum to the mixed book.
    async function assertScopes(f: Firm) {
      const trials = [],
        finals = [];
      for (const scope of ["gst", "nongst", "all"]) {
        const trial = await success(
          "GET",
          `/v1/reports/trial-balance?tax=${scope}`,
          undefined,
          f.id,
        );
        const final = await success(
          "GET",
          `/v1/reports/final-accounts?tax=${scope}`,
          undefined,
          f.id,
        );
        expect(trial.totalDebit).toBe(trial.totalCredit);
        expect(final.balanceSheet.balanced).toBe(true);
        expect(final.balanceSheet.assets.total).toBe(
          final.balanceSheet.liabilities.total,
        );
        trials.push(
          new Map<string, number>(
            trial.rows.map((r: TrialRow) => [r.key, r.debit - r.credit]),
          ),
        );
        finals.push(final.profitAndLoss);
      }
      const keys = new Set(trials.flatMap((trial) => [...trial.keys()]));
      for (const key of keys)
        expect(trials[2]?.get(key) ?? 0).toBe(
          (trials[0]?.get(key) ?? 0) + (trials[1]?.get(key) ?? 0),
        );
      for (const key of [
        "sales",
        "openingStock",
        "purchases",
        "closingStock",
        "grossProfit",
        "netProfit",
      ])
        expect(finals[2][key]).toBe(finals[0][key] + finals[1][key]);
    }

    async function counts() {
      return (
        await database.pool.query(
          "select (select count(*) from vouchers) as vouchers, (select count(*) from postings) as postings, (select count(*) from settlement_entries) as settlements, (select count(*) from associate_payouts) as payouts, (select count(*) from commission_entries) as commissions, (select count(*) from operation_receipts) as receipts",
        )
      ).rows[0];
    }

    async function loanFixture(direction: "borrowed" | "lent", scope: Scope) {
      const f = await firm();
      const account = await master(
        f,
        "Principal",
        direction === "borrowed"
          ? "Unsecured Loans"
          : "Loans & Advances (Asset)",
      );
      const interest = await master(
        f,
        "Reviewed interest",
        direction === "borrowed"
          ? "Other Current Liabilities"
          : "Other Current Assets",
      );
      const capital = await master(f, "Capital", "Capital Account");
      await journal(
        f,
        scope,
        "2026-09-01",
        acc.ledger(f.cash.id),
        acc.account(capital.id),
        240000,
      );
      const input = {
        name: "Acceptance loan",
        counterparty: "Synthetic counterparty",
        agreementReference: "FIXTURE",
        note: "Test only",
        accountId: account.id,
        direction,
        terms: {
          principal: 120000,
          annualRateBps: 1200,
          installments: 12,
          startDate: "2026-09-01",
          firstDueDate: "2026-10-01",
          scheduleModel: "fixed-principal-monthly-v1",
        },
      };
      const loan = await success("POST", "/v1/loans", input, f.id);
      const principal = acc.account(account.id),
        cash = acc.ledger(f.cash.id);
      await journal(
        f,
        scope,
        "2026-09-01",
        direction === "borrowed" ? cash : principal,
        direction === "borrowed" ? principal : cash,
        120000,
      );
      const read = () =>
        success("GET", `/v1/loans/${loan.id}`, undefined, f.id);
      const settle = async (
        kind: string,
        date: string,
        amount: number,
        extra = {},
        headers = {},
      ) => {
        const current = await read();
        return success(
          "POST",
          "/v1/settlements/loan-interest",
          {
            kind,
            date,
            amount,
            bookScope: scope,
            loanId: loan.id,
            loanVersion: current.loan.version,
            installmentNumber: 1,
            interestAccountId: interest.id,
            reason: "Reviewed fixture amount",
            confirmedNoDuplicate: true,
            ...extra,
          },
          f.id,
          201,
          headers,
        );
      };
      return { f, loan, input, interest, principal, cash, read, settle };
    }

    for (const scope of ["gst", "nongst"] as const)
      for (const direction of ["borrowed", "lent"] as const)
        test(`${scope} ${direction}: reviewed interest, partial/full payment, principal reference and closure`, async () => {
          const x = await loanFixture(direction, scope);
          const before = await counts();
          const detail = await x.read();
          expect(detail.postedBalance).toBe(
            direction === "borrowed" ? -120000 : 120000,
          );
          expect(detail.schedule.installments[0].interest).toBe(1200);
          expect(await counts()).toEqual(before);
          const base = {
            kind: "loan-interest-accrual",
            date: "2026-10-01",
            amount: 1250,
            bookScope: scope,
            loanId: x.loan.id,
            loanVersion: detail.loan.version,
            installmentNumber: 1,
            interestAccountId: x.interest.id,
            reason: "Reviewed override",
          };
          const unreviewed = await request(
            "POST",
            "/v1/settlements/loan-interest",
            base,
            x.f.id,
          );
          expect(unreviewed.statusCode).toBe(400);
          expect(await counts()).toEqual(before);
          const key = requestId(),
            body = { ...base, confirmedNoDuplicate: true };
          const accrued = await success(
            "POST",
            "/v1/settlements/loan-interest",
            body,
            x.f.id,
            201,
            { "idempotency-key": key },
          );
          expect(accrued.details.plannedInterest).toBe(1200);
          expect(accrued.details.confirmedAmount).toBe(1250);
          const afterAccrual = await counts();
          expect(
            await success(
              "POST",
              "/v1/settlements/loan-interest",
              body,
              x.f.id,
              201,
              { "idempotency-key": key },
            ),
          ).toEqual(accrued);
          expect(await counts()).toEqual(afterAccrual);
          const duplicate = await request(
            "POST",
            "/v1/settlements/loan-interest",
            { ...body, loanVersion: (await x.read()).loan.version },
            x.f.id,
          );
          expect(duplicate.statusCode).toBe(409);
          expect(duplicate.json().error.code).toBe("DUPLICATE_INTEREST");
          expect(await counts()).toEqual(afterAccrual);
          expect((await x.read()).postedBalance).toBe(detail.postedBalance);
          expect(
            (await accountStatement(x.f, acc.account(x.interest.id), scope))
              .closing,
          ).toBe(direction === "borrowed" ? -1250 : 1250);
          const payment = { ledgerId: x.f.cash.id, sourceEntryId: accrued.id };
          await x.settle("loan-interest-payment", "2026-10-05", 400, payment);
          const close = await request(
            "POST",
            `/v1/loans/${x.loan.id}/update`,
            {
              ...x.input,
              status: "closed",
              reason: "Should still owe principal and interest",
            },
            x.f.id,
            { "if-match": String((await x.read()).loan.version) },
          );
          expect(close.statusCode).toBe(409);
          expect(close.json().error.code).toBe("LOAN_NOT_SETTLED");
          const badPayment = {
            ...body,
            ...payment,
            kind: "loan-interest-payment",
            date: "2026-10-06",
            loanVersion: (await x.read()).loan.version,
            amount: 851,
          };
          const overpay = await request(
            "POST",
            "/v1/settlements/loan-interest",
            badPayment,
            x.f.id,
          );
          expect(overpay.statusCode).toBe(409);
          expect(overpay.json().error.code).toBe("INTEREST_OVERPAYMENT");
          const wrongBook = await request(
            "POST",
            "/v1/settlements/loan-interest",
            {
              ...badPayment,
              amount: 850,
              bookScope: scope === "gst" ? "nongst" : "gst",
            },
            x.f.id,
          );
          expect(wrongBook.statusCode).toBe(422);
          await x.settle("loan-interest-payment", "2026-10-06", 850, payment);
          expect(
            (await accountStatement(x.f, acc.account(x.interest.id))).closing,
          ).toBe(0);
          const repaid = await journal(
            x.f,
            scope,
            "2026-10-10",
            direction === "borrowed" ? x.principal : x.cash,
            direction === "borrowed" ? x.cash : x.principal,
            120000,
          );
          await success(
            "POST",
            `/v1/loans/${x.loan.id}/references`,
            {
              voucherId: repaid.id,
              voucherVersion: repaid.version,
              installmentNumber: 1,
              principalConfirmed: true,
              note: "Full principal repayment",
            },
            x.f.id,
            201,
            { "if-match": String((await x.read()).loan.version) },
          );
          const settled = await x.read();
          expect(settled.postedBalance).toBe(0);
          expect(settled.referencedPrincipal).toBe(120000);
          expect(settled.referencedInterest).toBe(0);
          expect(settled.references[0].state).toBe("valid");
          const closed = await success(
            "POST",
            `/v1/loans/${x.loan.id}/update`,
            {
              ...x.input,
              status: "closed",
              reason: "Principal and reviewed interest settled",
            },
            x.f.id,
            200,
            { "if-match": String(settled.loan.version) },
          );
          expect(closed.status).toBe("closed");
          await assertScopes(x.f);
        }, 30000);

    async function commissionFixture() {
      const f = await firm();
      const payable = await master(
        f,
        "Commission payable",
        "Other Current Liabilities",
      );
      const associate = await success(
        "POST",
        "/v1/associates",
        {
          name: "Synthetic carpenter",
          roles: ["commission-partner"],
          commission: {
            payableAccountId: payable.id,
            rate: 10,
            effectiveFrom: "2026-04-01",
          },
        },
        f.id,
      );
      const customer = await success(
        "POST",
        "/v1/parties",
        {
          name: "Synthetic customer",
          type: "customer",
          phone: "",
          city: "Mathura",
          stateCode: "09",
          creditDays: 0,
          creditLimit: 0,
          openingBalance: 0,
        },
        f.id,
      );
      const item = await success(
        "POST",
        "/v1/items",
        {
          name: "Hardware",
          code: "",
          hsn: "1001",
          group: "Hardware",
          taxType: "taxable",
          gstRate: 18,
          unit: "Nos",
          purchasePrice: 5000,
          salePrice: 10000,
          mrp: 0,
          reorderLevel: 0,
          openingStock: 20,
          openingLots: [
            { id: "gst-stock", qty: 10, unitCost: 5000, bookScope: "gst" },
            {
              id: "nongst-stock",
              qty: 10,
              unitCost: 5000,
              bookScope: "nongst",
            },
          ],
        },
        f.id,
      );
      const read = () =>
        success("GET", `/v1/associates/${associate.id}`, undefined, f.id);
      const statement = (scope = "all", to?: string) =>
        success(
          "GET",
          `/v1/associates/${associate.id}/statement?scope=${scope}${to ? `&to=${to}` : ""}`,
          undefined,
          f.id,
        );
      const sale = (scope: Scope, date = "2026-10-02") =>
        success(
          "POST",
          "/v1/sales",
          {
            date,
            partyId: customer.id,
            bookScope: scope,
            commission: { associateId: associate.id },
            charges: [{ name: "Freight", amount: 5000, gstRate: 18 }],
            lines: [
              {
                itemId: item.id,
                stockLotId: `${scope}-stock`,
                qty: 2,
                rate: 10000,
                discountPercent: 10,
                gstRate: 18,
              },
            ],
          },
          f.id,
        );
      const payout = async (
        date: string,
        allocations: { accrualId: string; amount: number }[],
        key = requestId(),
      ) =>
        success(
          "POST",
          `/v1/associates/${associate.id}/payouts`,
          {
            date,
            ledgerId: f.cash.id,
            reference: "Fixture payout",
            allocations,
          },
          f.id,
          201,
          {
            "if-match": String((await read()).associate.version),
            "idempotency-key": key,
          },
        );
      return { f, payable, associate, read, statement, sale, payout };
    }

    for (const scope of ["gst", "nongst"] as const)
      test(`${scope}: discounted goods commission excludes GST/freight, returns reduce it and payout reconciles`, async () => {
        const x = await commissionFixture();
        const sale = await x.sale(scope);
        const earned = await x.statement(scope);
        expect(earned.earned).toBe(1800);
        expect(earned.closing).toBe(1800);
        expect(earned.ledgerBalance).toBe(1800);
        expect(earned.difference).toBe(0);
        expect(
          (await x.statement(scope === "gst" ? "nongst" : "gst")).closing,
        ).toBe(0);
        // A later rule change must not reprice commission already earned by this sale.
        await success(
          "POST",
          `/v1/associates/${x.associate.id}/update`,
          {
            name: "Synthetic carpenter",
            roles: ["commission-partner"],
            commission: {
              payableAccountId: x.payable.id,
              rate: 20,
              effectiveFrom: "2026-10-03",
            },
            reason: "New sales use the new rate",
          },
          x.f.id,
          200,
          { "if-match": String((await x.read()).associate.version) },
        );
        await success(
          "POST",
          "/v1/credit-notes",
          {
            againstId: sale.id,
            date: "2026-10-03",
            reason: "One returned item",
            lines: [{ index: 0, qty: 1 }],
          },
          x.f.id,
        );
        const returned = await x.statement(scope);
        expect(returned.adjusted).toBe(-900);
        expect(returned.closing).toBe(900);
        expect(returned.difference).toBe(0);
        await x.payout("2026-10-04", [
          { accrualId: earned.accruals[0].id, amount: 900 },
        ]);
        const paid = await x.statement(scope);
        expect(paid.paid).toBe(900);
        expect(paid.closing).toBe(0);
        expect(paid.ledgerBalance).toBe(0);
        expect(paid.difference).toBe(0);
        expect(
          (await accountStatement(x.f, acc.expense("Sales Commission"), scope))
            .closing,
        ).toBe(900);
        await assertScopes(x.f);
      }, 30000);

    test("one payout across both books preserves separate journals and retry identity", async () => {
      const x = await commissionFixture();
      await x.sale("gst");
      await x.sale("nongst");
      const earned = await x.statement();
      expect(earned.earned).toBe(3600);
      const allocations = earned.accruals.map((a: Accrual) => ({
        accrualId: a.id,
        amount: a.balance,
      }));
      const key = requestId(),
        version = String((await x.read()).associate.version);
      const body = {
        date: "2026-10-05",
        ledgerId: x.f.cash.id,
        reference: "Mixed payout",
        allocations,
      };
      const payout = await success(
        "POST",
        `/v1/associates/${x.associate.id}/payouts`,
        body,
        x.f.id,
        201,
        { "if-match": version, "idempotency-key": key },
      );
      expect(payout.amount).toBe(3600);
      const before = await counts();
      expect(
        await success(
          "POST",
          `/v1/associates/${x.associate.id}/payouts`,
          body,
          x.f.id,
          201,
          { "if-match": version, "idempotency-key": key },
        ),
      ).toEqual(payout);
      expect(await counts()).toEqual(before);
      for (const scope of ["gst", "nongst", "all"]) {
        const paid = await x.statement(scope);
        expect(paid.paid).toBe(scope === "all" ? 3600 : 1800);
        expect(paid.closing).toBe(0);
        expect(paid.difference).toBe(0);
      }
      await success(
        "POST",
        `/v1/associates/payouts/${payout.id}/reverse`,
        { date: "2026-10-10", reason: "Payment did not complete" },
        x.f.id,
        200,
        { "if-match": String(payout.version) },
      );
      expect((await x.statement()).closing).toBe(3600);
      expect((await x.statement("all", "2026-10-06")).closing).toBe(0);
      await assertScopes(x.f);
    }, 30000);

    test("backdated commission payout cannot reuse funds consumed before a later reversal", async () => {
      const x = await commissionFixture();
      await x.sale("gst");
      const earned = await x.statement();
      const allocations = [{ accrualId: earned.accruals[0].id, amount: 1800 }];
      const first = await x.payout("2026-10-05", allocations);
      await success(
        "POST",
        `/v1/associates/payouts/${first.id}/reverse`,
        { date: "2026-10-10", reason: "Original payment reversed" },
        x.f.id,
        200,
        { "if-match": String(first.version) },
      );
      const before = await counts();
      const blocked = await request(
        "POST",
        `/v1/associates/${x.associate.id}/payouts`,
        {
          date: "2026-10-03",
          ledgerId: x.f.cash.id,
          reference: "Must not consume historical funds twice",
          allocations,
        },
        x.f.id,
        { "if-match": String((await x.read()).associate.version) },
      );
      expect(blocked.statusCode).toBe(422);
      expect(await counts()).toEqual(before);
      expect((await x.statement("all", "2026-10-06")).closing).toBe(0);
      await x.payout("2026-10-11", allocations);
      expect((await x.statement()).closing).toBe(0);
    }, 30000);

    test("new accrual cannot hide an intermediate book shortfall caused by another sale's return", async () => {
      const x = await commissionFixture();
      const firstSale = await x.sale("gst");
      const firstEarned = await x.statement();
      await x.payout("2026-10-05", [
        { accrualId: firstEarned.accruals[0].id, amount: 1800 },
      ]);
      await success(
        "POST",
        "/v1/credit-notes",
        {
          againstId: firstSale.id,
          date: "2026-10-06",
          reason: "Fully returned after payout",
          lines: [{ index: 0, qty: 2 }],
        },
        x.f.id,
      );
      const secondSale = await x.sale("gst", "2026-10-03");
      await x.sale("gst", "2026-10-10");
      const balances = await x.statement();
      const second = balances.accruals.find(
        (a: { saleId: string }) => a.saleId === secondSale.id,
      );
      expect(second.balance).toBe(1800);
      expect(balances.closing).toBe(1800);
      expect((await x.statement("gst", "2026-10-07")).closing).toBe(0);
      const before = await counts();
      const blocked = await request(
        "POST",
        `/v1/associates/${x.associate.id}/payouts`,
        {
          date: "2026-10-04",
          ledgerId: x.f.cash.id,
          reference: "Must preserve every dated book balance",
          allocations: [{ accrualId: second.id, amount: 1800 }],
        },
        x.f.id,
        { "if-match": String((await x.read()).associate.version) },
      );
      expect(blocked.statusCode).toBe(422);
      expect(await counts()).toEqual(before);
      await x.payout("2026-10-11", [{ accrualId: second.id, amount: 1800 }]);
      expect((await x.statement()).difference).toBe(0);
    }, 30000);

    test("reviewed interest payment also preserves an exhausted interval before its reversal", async () => {
      const x = await loanFixture("borrowed", "nongst");
      const accrual = await x.settle(
        "loan-interest-accrual",
        "2026-10-01",
        1200,
      );
      const payment = { ledgerId: x.f.cash.id, sourceEntryId: accrual.id };
      const paid = await x.settle(
        "loan-interest-payment",
        "2026-10-05",
        1200,
        payment,
      );
      await success(
        "POST",
        `/v1/settlements/${paid.id}/reverse`,
        {
          date: "2026-10-10",
          bookScope: "nongst",
          reason: "Synthetic payment reversal",
          version: paid.version,
        },
        x.f.id,
      );
      const before = await counts();
      const blocked = await request(
        "POST",
        "/v1/settlements/loan-interest",
        {
          ...payment,
          kind: "loan-interest-payment",
          date: "2026-10-03",
          bookScope: "nongst",
          amount: 1200,
          loanId: x.loan.id,
          loanVersion: (await x.read()).loan.version,
          installmentNumber: 1,
          interestAccountId: x.interest.id,
          reason: "Historical interval is exhausted",
          confirmedNoDuplicate: true,
        },
        x.f.id,
      );
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error.code).toBe("INTEREST_OVERPAYMENT");
      expect(await counts()).toEqual(before);
      await x.settle("loan-interest-payment", "2026-10-11", 1200, payment);
      expect(
        (await accountStatement(x.f, acc.account(x.interest.id))).closing,
      ).toBe(0);
    }, 30000);
  },
);
