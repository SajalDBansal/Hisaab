import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
  newRequestId,
} from "@repo/contracts";
import { createDb, schema } from "@repo/backend/db/client";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";
import { fakeStorage } from "../src/lib/storage";

// Only the explicitly supplied disposable database; never .env.
test(
  "retail bills (T02) and the UPI QR on bills (T18)",
  { skip: !process.env.HISAAB_DATA_TEST_URL, timeout: 120_000 },
  async () => {
    const databaseUrl = process.env.HISAAB_DATA_TEST_URL;
    assert.ok(databaseUrl);
    const url = new URL(databaseUrl);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    assert.match(url.pathname, /^\/hardening_data(_[a-z0-9]+)?$/);
    const { db, pool } = createDb(url.toString(), { workload: "maintenance" });
    const mail = memorySender();
    const app = await buildApp({
      db,
      email: mail.sender,
      storage: fakeStorage(),
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        BETTER_AUTH_SECRET: "retail-upi-fixture-only-secret-not-for-users",
        BETTER_AUTH_URL: "http://localhost:3000",
        TRUSTED_ORIGINS: ["http://localhost:8081"],
        SENTRY_TRACES_SAMPLE_RATE: 0,
      },
    });
    const tag = randomUUID().slice(0, 8);
    const headers = {
      origin: "http://localhost:8081",
      [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
    };
    try {
      async function account(suffix: string) {
        const email = `retail-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Retail ${suffix}`,
            email,
            password: "Fixture-password-123!",
            phoneNumber: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
          },
        });
        assert.equal(signup.statusCode, 200, signup.body);
        const verify = await app.inject({
          method: "POST",
          url: "/api/auth/email-otp/verify-email",
          headers,
          payload: { email, otp: mail.lastCode(email) },
        });
        assert.equal(verify.statusCode, 200, verify.body);
        const cookies = verify.headers["set-cookie"];
        return {
          id: verify.json<{ user: { id: string } }>().user.id,
          cookie: (Array.isArray(cookies) ? cookies : [String(cookies)])
            .map((c) => c.split(";")[0])
            .join("; "),
        };
      }
      const owner = await account("owner");
      const viewer = await account("viewer");
      let firmId = "";
      type Method = "GET" | "POST" | "PATCH" | "PUT";
      type Who = { cookie: string };
      const call = (
        who: Who,
        method: Method,
        path: string,
        payload?: object,
        key: string | undefined = method === "POST"
          ? newRequestId(randomUUID())
          : undefined,
        extra: Record<string, string> = {},
      ) =>
        app.inject({
          method,
          url: path,
          headers: {
            ...headers,
            cookie: who.cookie,
            ...(firmId ? { "x-firm-id": firmId } : {}),
            ...(key ? { "idempotency-key": key } : {}),
            ...extra,
          },
          payload,
        });
      const ok = async <T>(
        who: Who,
        method: Method,
        path: string,
        payload?: object,
      ) => {
        const reply = await call(who, method, path, payload);
        assert.ok(
          reply.statusCode < 300,
          `${path}: ${reply.statusCode} ${reply.body}`,
        );
        return reply.json<T>();
      };

      const firm = await ok<{ id: string }>(owner, "POST", "/v1/firms", {
        name: `Retail ${tag}`,
        city: "Delhi",
        stateCode: "07",
        gstin: "07AAAAA0000A1Z4",
        gstRegistration: "regular",
      });
      firmId = firm.id;
      await db
        .insert(schema.member)
        .values({ organizationId: firmId, userId: viewer.id, role: "viewer" });
      const supplier = await ok<{ id: string }>(owner, "POST", "/v1/parties", {
        name: `Supplier ${tag}`,
        type: "supplier",
        phone: "",
        city: "Delhi",
        stateCode: "09",
        gstin: "09BBBBB1111B1ZL",
        creditDays: 0,
        creditLimit: 0,
        openingBalance: 0,
      });
      const item = await ok<{ id: string }>(owner, "POST", "/v1/items", {
        name: `Soap ${tag}`,
        code: `SOAP${tag}`,
        hsn: "3401",
        group: "",
        taxType: "taxable",
        gstRate: 18,
        unit: "Pcs",
        purchasePrice: 2000,
        salePrice: 3000,
        mrp: 0,
        reorderLevel: 0,
        openingStock: 0,
      });
      const today = new Date().toISOString().slice(0, 10);
      const { fyStart } = await ok<{ fyStart: string }>(
        owner,
        "GET",
        "/v1/firms/current",
      );
      await ok(owner, "POST", "/v1/purchases", {
        partyId: supplier.id,
        date: fyStart,
        lines: [{ itemId: item.id, qty: 20, rate: 2000, gstRate: 18 }],
        charges: [],
      });
      const [cash] = await ok<{ id: string }[]>(
        owner,
        "GET",
        "/v1/ledgers?kind=cash",
      );
      assert.ok(cash);
      const retail = (date = today) => ({
        date,
        lines: [{ itemId: item.id, qty: 2, rate: 3000, gstRate: 18 }],
        buyer: { name: "Ravi", phone: "98765 43210" },
        paidBy: { mode: "cash", ledgerId: cash.id },
      });

      // ---- A retail bill: retail series, cash customer, paid in full ----
      const key = newRequestId(randomUUID());
      const first = await call(
        owner,
        "POST",
        "/v1/sales/retail",
        retail(),
        key,
      );
      assert.equal(first.statusCode, 201, first.body);
      const [bill] = first.json<
        {
          id: string;
          number: string;
          amount: number;
          partyId: string;
          retail: { name?: string; phone?: string };
          docType: string;
        }[]
      >();
      assert.ok(bill);
      assert.match(bill.number, /^RI\/\d{2}-\d{2}\/0001$/);
      assert.equal(bill.amount, 7100);
      assert.equal(bill.docType, "tax-invoice");
      assert.deepEqual(bill.retail, { name: "Ravi", phone: "9876543210" });
      // The same request again replays the first answer.
      const again = await call(
        owner,
        "POST",
        "/v1/sales/retail",
        retail(),
        key,
      );
      assert.equal(again.statusCode, 201, again.body);
      assert.equal(again.json<{ id: string }[]>()[0]?.id, bill.id);

      const detail = await ok<{
        party: { name: string; stateCode: string };
        settled: number;
        voucher: { retail: object; version: number };
      }>(owner, "GET", `/v1/vouchers/${bill.id}`);
      assert.equal(detail.party.name, "Cash customer");
      assert.equal(detail.party.stateCode, "07");
      assert.equal(detail.settled, 7100);

      // A second bill reuses the cash customer and the next retail number.
      const [second] = await ok<{ number: string; partyId: string }[]>(
        owner,
        "POST",
        "/v1/sales/retail",
        { ...retail(), buyer: undefined },
      );
      assert.ok(second);
      assert.match(second.number, /^RI\/\d{2}-\d{2}\/0002$/);
      assert.equal(second.partyId, bill.partyId);
      const walkIns = await db
        .select()
        .from(schema.parties)
        .where(eq(schema.parties.firmId, firmId));
      assert.equal(walkIns.filter((p) => p.name === "Cash customer").length, 1);
      // Ordinary sales keep their own series.
      const [sale] = await ok<{ number: string }[]>(
        owner,
        "POST",
        "/v1/sales/split",
        {
          partyId: bill.partyId,
          date: today,
          lines: [{ itemId: item.id, qty: 1, rate: 3000, gstRate: 18 }],
          charges: [],
        },
      );
      assert.ok(sale);
      assert.match(sale.number, /^SI\/\d{2}-\d{2}\/0001$/);
      const next = await call(
        owner,
        "GET",
        `/v1/vouchers/next-number?type=sale&series=retail&date=${today}`,
      );
      assert.match(next.body.replace(/"/g, ""), /^RI\/\d{2}-\d{2}\/0003$/);

      // Nothing stays due on the cash customer from retail bills.
      const party = await ok<{ balance: number }>(
        owner,
        "GET",
        `/v1/parties/${bill.partyId}`,
      );
      assert.equal(party.balance, 3500); // only the ordinary sale

      // GSTR-1: unregistered, same state → B2C small.
      const gstr1 = await ok<{
        b2cs: { stateCode: string; rate: number; taxable: number }[];
      }>(owner, "GET", `/v1/gst/gstr1?month=${today.slice(0, 7)}`);
      const row = gstr1.b2cs.find((r) => r.stateCode === "07" && r.rate === 18);
      assert.equal(row?.taxable, 2 * 6000 + 3000); // two retail bills and the sale

      // ---- Rights and edits ----
      const refused = await call(viewer, "POST", "/v1/sales/retail", retail());
      assert.equal(refused.statusCode, 403, refused.body);
      const badLedger = await call(owner, "POST", "/v1/sales/retail", {
        ...retail(),
        paidBy: { mode: "cash", ledgerId: randomUUID() },
      });
      assert.equal(badLedger.statusCode, 400, badLedger.body);
      const edit = await call(
        owner,
        "PUT",
        `/v1/vouchers/${bill.id}`,
        {
          partyId: bill.partyId,
          date: today,
          lines: [{ itemId: item.id, qty: 3, rate: 3000, gstRate: 18 }],
          charges: [],
        },
        undefined,
        { "if-match": String(detail.voucher.version) },
      );
      assert.equal(edit.statusCode, 400, edit.body);
      assert.match(edit.body, /retail bill was paid/);

      // ---- Settings: retail prefix, thermal roll, UPI QR ----
      const clash = await call(owner, "PATCH", "/v1/settings/invoice", {
        retailPrefix: "SI",
      });
      assert.equal(clash.statusCode, 400, clash.body);
      const settings = await ok<{
        retailPrefix: string;
        retailPaper: string;
        upiQr: { upiId: string; payeeName: string } | null;
      }>(owner, "PATCH", "/v1/settings/invoice", {
        retailPaper: "58",
        upiQr: { upiId: "shop@okhdfc", payeeName: "Retail Shop" },
      });
      assert.equal(settings.retailPrefix, "RI");
      assert.equal(settings.retailPaper, "58");
      assert.deepEqual(settings.upiQr, {
        upiId: "shop@okhdfc",
        payeeName: "Retail Shop",
      });

      // ---- Print: the retail bill opens on the 58 mm roll without a QR (paid);
      // the credit sale prints a QR for the amount due ----
      const retailPrint = await ok<{ html: string }>(
        owner,
        "GET",
        `/v1/vouchers/${bill.id}/print`,
      );
      assert.match(retailPrint.html, /name="hisaab-roll" content="58mm"/);
      assert.match(retailPrint.html, /Received \(Cash\)/);
      assert.match(retailPrint.html, /Ravi/);
      assert.doesNotMatch(retailPrint.html, /UPI QR code/);
      const sales = await ok<{ items: { id: string; number: string }[] }>(
        owner,
        "GET",
        "/v1/vouchers?type=sale",
      );
      const credit = sales.items.find((v) => v.number.startsWith("SI/"));
      assert.ok(credit);
      const creditPrint = await ok<{ html: string }>(
        owner,
        "GET",
        `/v1/vouchers/${credit.id}/print?template=compact-58`,
      );
      assert.match(creditPrint.html, /UPI QR code/);
      assert.match(creditPrint.html, /Scan to pay ₹35\.00/);
      const a4 = await ok<{ html: string }>(
        owner,
        "GET",
        `/v1/vouchers/${credit.id}/print?template=classic`,
      );
      assert.match(a4.html, /UPI QR code/);
      assert.doesNotMatch(a4.html, /hisaab-roll/);

      // ---- Period lock: a retail bill can't go into a closed period ----
      const back = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      if (back > fyStart) {
        const books = await ok<{
          version: number;
          opening: { digest: string; capital: number };
        }>(owner, "GET", "/v1/settings/books");
        const approved = await ok<{ version: number }>(
          owner,
          "POST",
          "/v1/settings/books",
          {
            action: "approve-openings",
            digest: books.opening.digest,
            capital: books.opening.capital,
            version: books.version,
            reason: "Opening balances checked for the test.",
          },
        );
        await ok(owner, "POST", "/v1/settings/books", {
          action: "close-period",
          date: back,
          version: approved.version,
          reason: "Closing yesterday for the retail test.",
        });
        const locked = await call(
          owner,
          "POST",
          "/v1/sales/retail",
          retail(back),
        );
        assert.equal(locked.statusCode, 409, locked.body);
        assert.equal(locked.json().error.code, "PERIOD_CLOSED");
      }

      // ---- The firm export carries the settings and the buyer details ----
      const exported = await ok<{ text: string }>(
        owner,
        "GET",
        "/v1/backup/export",
      );
      const data = JSON.parse(exported.text).payload.data;
      assert.equal(data.invoiceSettings.retailPaper, "58");
      assert.deepEqual(data.invoiceSettings.upiQr, {
        upiId: "shop@okhdfc",
        payeeName: "Retail Shop",
      });
      const exportedBill = data.vouchers.find(
        (v: { id: string }) => v.id === bill.id,
      );
      assert.deepEqual(exportedBill.retail, {
        name: "Ravi",
        phone: "9876543210",
      });
      const inspected = await call(owner, "POST", "/v1/backup/inspect", {
        text: exported.text,
      });
      assert.equal(inspected.statusCode, 200, inspected.body);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
