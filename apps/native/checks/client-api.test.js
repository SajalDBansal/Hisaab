import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { buildApp } from "../../api/src/app.ts";
import { memorySender } from "../../api/src/lib/email.ts";
import { createDb } from "../../../packages/backend/src/db/client.ts";
import { newRequestId, DEVELOPMENT_RECOVERY_EPOCH } from "@repo/contracts";
import { today } from "@repo/core";
import { parseApiBody, requestApi } from "../src/auth/apiRequest.ts";
import { ApiFailure } from "../src/auth/apiFailure.ts";
import { createOfflineBooks } from "../src/data/offlineBooks.ts";
import { downloadOfflineBooks } from "../src/data/offlineWarmup.ts";
import { remoteServices } from "../src/data/remoteServices.ts";
import {
  finalAccountsPeriod,
  REPORT_PERIODS,
} from "../src/data/reportPeriods.ts";
import {
  invoiceDrafts,
  invoiceDraftItem,
  invoiceDraftLine,
  invoiceDraftCharges,
} from "../src/forms/invoiceDraft.ts";

const databaseUrl = process.env.CLIENT_CHECK_DATABASE_URL;

test(
  "client fixes against authenticated API, isolated PostgreSQL and real report contracts",
  { skip: !databaseUrl, timeout: 90_000 },
  async () => {
    const target = new URL(databaseUrl);
    assert.equal(target.hostname, "127.0.0.1");
    assert.equal(
      target.pathname,
      "/hardening_client",
      "Only the disposable client database is allowed",
    );
    const { db, pool } = createDb(databaseUrl);
    const email = memorySender();
    const app = await buildApp({
      db,
      email: email.sender,
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        BETTER_AUTH_SECRET: "client-fixture-secret-with-thirty-two-characters",
        BETTER_AUTH_URL: "http://localhost:3000",
        TRUSTED_ORIGINS: ["http://localhost:8081", "hisaab://"],
      },
    });
    const run = randomUUID().slice(0, 8);
    const check = async (name, work) => {
      try {
        await work();
        process.stdout.write(`Verified: ${name}\n`);
      } catch (error) {
        process.stderr.write(`Failed: ${name}\n`);
        throw error;
      }
    };
    async function call(cookie, path, body, extra = {}) {
      const response = await app.inject({
        method: extra.method ?? (body ? "POST" : "GET"),
        url: path,
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:8081",
          "x-platform": "web",
          "x-recovery-epoch": DEVELOPMENT_RECOVERY_EPOCH,
          ...(cookie ? { cookie } : {}),
          ...(extra.headers ?? {}),
        },
        ...(body === undefined ? {} : { payload: body }),
      });
      if (extra.status)
        assert.equal(
          response.statusCode,
          extra.status,
          `${path}: ${response.body}`,
        );
      else
        assert(
          response.statusCode < 400,
          `${path}: ${response.statusCode} ${response.body}`,
        );
      return {
        data: parseApiBody(
          response.body,
          response.headers["content-type"] ?? null,
        ),
        response,
      };
    }
    async function user(name, phone) {
      const address = `${name}-${run}@example.invalid`;
      const phoneNumber = `9${parseInt(run, 16).toString().padStart(8, "0").slice(0, 8)}${phone.at(-1)}`;
      await call(null, "/api/auth/sign-up/email", {
        name,
        email: address,
        phoneNumber,
        password: "Fixture-password-123!",
      });
      const verified = await call(null, "/api/auth/email-otp/verify-email", {
        email: address,
        otp: email.lastCode(address),
      });
      const cookie = verified.response.cookies
        .map((item) => `${item.name}=${item.value}`)
        .join("; ");
      const { data: me } = await call(cookie, "/v1/me");
      return { cookie, email: address, id: me.id };
    }
    try {
      const owner = await user("owner", "9111111101");
      const invitee = await user("invitee", "9111111102");
      const declining = await user("declining", "9111111103");
      const { data: firm } = await call(owner.cookie, "/v1/firms", {
        name: `Client fixture ${run}`,
        city: "Agra",
        stateCode: "09",
        gstRegistration: "regular",
        gstin: "09AAAAA0000A1Z0",
      });
      const headers = { "x-firm-id": firm.id };
      const write = (path, body, extra = {}) =>
        call(owner.cookie, path, body, {
          ...extra,
          headers: {
            ...headers,
            "idempotency-key": newRequestId(randomUUID()),
            ...(extra.headers ?? {}),
          },
        });
      await check(
        "a fresh invitee accepts membership without creating a firm",
        async () => {
          assert.equal(
            (await call(invitee.cookie, "/v1/firms")).data.length,
            0,
          );
          const invitation = (
            await write("/v1/firms/current/invitations", {
              email: invitee.email,
              role: "sales",
            })
          ).data;
          assert(
            (await call(invitee.cookie, "/v1/me/invitations")).data.some(
              (row) => row.id === invitation.id,
            ),
          );
          const accepted = (
            await call(
              invitee.cookie,
              `/v1/me/invitations/${invitation.id}/accept`,
              undefined,
              { method: "POST" },
            )
          ).data;
          assert.equal(accepted.id, firm.id);
          assert.equal(
            (await call(invitee.cookie, "/v1/firms")).data.length,
            1,
          );
          await call(invitee.cookie, "/v1/firms/current", undefined, {
            headers,
          });
          await call(invitee.cookie, "/v1/reports/trial-balance", undefined, {
            headers,
            status: 403,
          });
        },
      );
      await check(
        "declined and expired invitations cannot grant membership",
        async () => {
          const first = (
            await write("/v1/firms/current/invitations", {
              email: declining.email,
              role: "sales",
            })
          ).data;
          await call(
            declining.cookie,
            `/v1/me/invitations/${first.id}/decline`,
            undefined,
            { method: "POST" },
          );
          assert.equal(
            (await call(declining.cookie, "/v1/firms")).data.length,
            0,
          );
          const second = (
            await write("/v1/firms/current/invitations", {
              email: declining.email,
              role: "sales",
            })
          ).data;
          await pool.query(
            "UPDATE invitation SET expires_at = now() - interval '1 day' WHERE id = $1",
            [second.id],
          );
          assert.equal(
            (await call(declining.cookie, "/v1/me/invitations")).data.length,
            0,
          );
          const expired = await app.inject({
            method: "POST",
            url: `/v1/me/invitations/${second.id}/accept`,
            headers: {
              cookie: declining.cookie,
              origin: "http://localhost:8081",
              "x-platform": "web",
            },
          });
          assert(expired.statusCode >= 400);
          assert.equal(
            (await call(declining.cookie, "/v1/firms")).data.length,
            0,
          );
        },
      );
      const partyInput = {
        name: `Party ${run}`,
        type: "supplier",
        phone: "",
        city: "Agra",
        stateCode: "09",
        gstin: "",
        creditDays: 30,
        creditLimit: 0,
        openingBalance: 0,
      };
      const supplier = (await write("/v1/parties", partyInput)).data;
      const customer = (
        await write("/v1/parties", {
          ...partyInput,
          name: `Customer ${run}`,
          type: "customer",
        })
      ).data;
      const baseItem = {
        name: `Goods ${run}`,
        code: "",
        hsn: "1234",
        group: "",
        taxType: "taxable",
        gstRate: 18,
        unit: "Pcs",
        altUnit: { name: "Box", factor: 12 },
        purchasePrice: 1000,
        salePrice: 2000,
        mrp: 0,
        reorderLevel: 0,
        openingStock: 0,
      };
      let item = (await write("/v1/items", baseItem)).data;
      let purchase;
      await check(
        "purchase and sale edits preserve issued packing, tax and discounts",
        async () => {
          purchase = (
            await write("/v1/purchases", {
              partyId: supplier.id,
              date: today(),
              bookScope: "gst",
              lines: [
                {
                  itemId: item.id,
                  qty: 2,
                  rate: 12000,
                  per: { unit: "Box", factor: 12 },
                  discountAmount: 100,
                  gstRate: 18,
                },
              ],
              charges: [
                { name: "Freight", amount: 500, gstRate: 5 },
                { name: "Packing", amount: 100, gstRate: 0 },
              ],
            })
          ).data;
          item = (
            await write(
              `/v1/items/${item.id}`,
              {
                ...baseItem,
                altUnit: { name: "Pack", factor: 12 },
                gstRate: 5,
              },
              { method: "PUT", headers: { "if-match": String(item.version) } },
            )
          ).data;
          const editedLines = invoiceDrafts(purchase, true).map((draft) =>
            invoiceDraftLine(
              draft,
              invoiceDraftItem(draft.itemId, item, purchase),
              "gst",
            ),
          );
          const edited = (
            await write(
              `/v1/vouchers/${purchase.id}`,
              {
                partyId: supplier.id,
                date: purchase.date,
                bookScope: "gst",
                lines: editedLines,
                charges: invoiceDraftCharges(500, purchase.charges),
                supplierInvoiceNo: "Fixture corrected reference",
              },
              {
                method: "PUT",
                headers: { "if-match": String(purchase.version) },
              },
            )
          ).data;
          assert.equal(edited.amount, purchase.amount);
          assert.deepEqual(edited.lines[0].per, { unit: "Box", factor: 12 });
          assert.equal(edited.lines[0].gstRate, 18);
          const lot = (
            await call(
              owner.cookie,
              `/v1/items/stock-lots?date=${today()}`,
              undefined,
              { headers },
            )
          ).data.find((row) => row.itemId === item.id && row.qty > 0);
          const sale = (
            await write("/v1/sales", {
              partyId: customer.id,
              date: today(),
              lines: [
                {
                  itemId: item.id,
                  stockLotId: lot.id,
                  qty: 1,
                  rate: 24000,
                  per: { unit: "Pack", factor: 12 },
                  discountPercent: 10,
                  gstRate: 5,
                },
              ],
              charges: [],
            })
          ).data;
          item = (
            await write(
              `/v1/items/${item.id}`,
              {
                ...baseItem,
                altUnit: { name: "Box", factor: 12 },
                gstRate: 18,
              },
              { method: "PUT", headers: { "if-match": String(item.version) } },
            )
          ).data;
          const revised = (
            await write(
              `/v1/vouchers/${sale.id}`,
              {
                partyId: customer.id,
                date: sale.date,
                lines: invoiceDrafts(sale, true).map((draft) =>
                  invoiceDraftLine(
                    draft,
                    invoiceDraftItem(draft.itemId, item, sale),
                    "gst",
                  ),
                ),
                charges: [],
              },
              { method: "PUT", headers: { "if-match": String(sale.version) } },
            )
          ).data;
          assert.equal(revised.amount, sale.amount);
          assert.deepEqual(revised.lines[0].per, { unit: "Pack", factor: 12 });
          assert.equal(revised.lines[0].gstRate, 5);
        },
      );
      const values = new Map();
      const store = {
        get: async (key) => values.get(key) ?? null,
        set: async (key, value) => {
          values.set(key, value);
        },
        remove: async (key) => {
          values.delete(key);
        },
        lock: async (_key, work) => work(),
      };
      let fault = "none";
      const transport = async (path, options = {}) => {
        const send = async (_url, init) => {
          if (fault === "offline") throw new TypeError("fixture disconnected");
          const response = await app.inject({
            method: init.method ?? "GET",
            url: path,
            headers: {
              cookie: owner.cookie,
              host: "localhost:3000",
              origin: "http://localhost:8081",
              "x-platform": "web",
              "x-recovery-epoch": DEVELOPMENT_RECOVERY_EPOCH,
              ...init.headers,
            },
            ...(init.body ? { payload: init.body } : {}),
          });
          if (fault === "body" && /^\/v1\/operations\/[^/]+$/.test(path)) {
            fault = "none";
            assert(response.statusCode < 400, response.body);
            return {
              text: async () => {
                throw new TypeError("reply lost after commit");
              },
            };
          }
          return new Response(response.body, {
            status: response.statusCode,
            headers: {
              "content-type":
                response.headers["content-type"] ?? "application/json",
            },
          });
        };
        const { response, text } = await requestApi(
          `http://localhost:3000${path}`,
          {
            method: options.method ?? (options.body ? "POST" : "GET"),
            headers: {
              ...(options.body ? { "content-type": "application/json" } : {}),
              ...options.headers,
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
          },
          3000,
          send,
        );
        const data = parseApiBody(text, response.headers.get("content-type"));
        if (!response.ok)
          throw new ApiFailure(
            response.status,
            data.error?.code ?? "ERROR",
            data.error?.message ?? "Fixture request failed",
          );
        return data;
      };
      const books = createOfflineBooks({
        scope: { userId: owner.id, firmId: firm.id, role: "owner" },
        store,
        transport,
        newId: randomUUID,
        recoveryEpoch: () => DEVELOPMENT_RECOVERY_EPOCH,
        assertActive: () => {},
        verifyAccess: async () => {
          await transport("/v1/firms");
        },
      });
      const services = remoteServices(books.transport, firm.id);
      await check(
        "invoice numbers and printable responses survive HTTP body decoding",
        async () => {
          const next = await services.voucherService.nextNumber(
            "sale",
            "nongst",
            today(),
          );
          assert.match(next, /^NSI\//);
          const printable = await transport(
            `/v1/vouchers/${purchase.id}/print`,
            { headers },
          );
          assert.equal(typeof printable.html, "string");
          assert(printable.html.includes(purchase.number));
        },
      );
      await check(
        "downloaded books include every P&L period and scope while offline",
        async () => {
          await downloadOfflineBooks(books, services);
          assert(books.getSnapshot().downloadedAt);
          const expected = new Map();
          for (const tax of ["all", "gst", "nongst"])
            for (const { key } of REPORT_PERIODS) {
              const { from, asOf } = finalAccountsPeriod(key);
              expected.set(
                `${tax}:${key}`,
                await services.accountService.finalAccounts(tax, from, asOf),
              );
            }
          fault = "offline";
          for (const tax of ["all", "gst", "nongst"])
            for (const { key } of REPORT_PERIODS) {
              const { from, asOf } = finalAccountsPeriod(key);
              assert.deepEqual(
                await services.accountService.finalAccounts(tax, from, asOf),
                expected.get(`${tax}:${key}`),
              );
            }
          fault = "none";
        },
      );
      await check(
        "a reply lost after committing is reconciled under the same request key",
        async () => {
          const key = newRequestId(randomUUID()),
            name = `Uncertain customer ${run}`;
          fault = "body";
          await assert.rejects(
            books.transport("/v1/parties", {
              body: { ...partyInput, name, type: "customer" },
              headers: { ...headers, "idempotency-key": key },
            }),
          );
          assert.equal(
            books.getSnapshot().entries.find((entry) => entry.key === key)
              ?.state,
            "unknown",
          );
          await books.sync();
          assert.equal(
            books.getSnapshot().entries.find((entry) => entry.key === key)
              ?.state,
            "committed",
          );
          assert.equal(
            (
              await call(
                owner.cookie,
                `/v1/parties?search=${encodeURIComponent(name)}`,
                undefined,
                { headers },
              )
            ).data.items.length,
            1,
          );
        },
      );
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
