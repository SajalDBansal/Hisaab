import assert from "node:assert/strict";
import { test } from "node:test";
import { createAppPrivacy } from "../src/auth/appPrivacy";
import { availableWithoutFirm } from "../src/auth/accountRoutes";
import { parseApiBody, requestApi } from "../src/auth/apiRequest";
import { ApiFailure } from "../src/auth/apiFailure";
import { canManageVoucher } from "../src/data/voucherAccess";
import { createOfflineBooks } from "../src/data/offlineBooks";
import { DEVELOPMENT_RECOVERY_EPOCH } from "@repo/contracts";
import {
  invoiceDrafts,
  invoiceDraftItem,
  invoiceDraftLine,
  invoiceDraftCharges,
} from "../src/forms/invoiceDraft";
import { calcInvoice } from "@repo/core";
function privacyFixture(timeout = 15 * 60000) {
  let now = 1000,
    locked = false,
    concealed = false,
    identity = "session:0",
    enabled = true;
  const events = [];
  const deps = {
    now: () => now,
    isLocked: () => locked,
    identity: () => identity,
    canRefresh: () => enabled,
    readTimeout: async () => timeout,
    conceal: (value) => {
      concealed = value;
      events.push(`conceal:${value}`);
    },
    lock: () => {
      locked = true;
      events.push("lock");
    },
    fail: () => {
      locked = true;
      events.push("failed");
    },
    refresh: async () => {
      events.push("refresh");
    },
  };
  return {
    deps,
    events,
    state: () => ({ locked, concealed }),
    pass: (ms) => {
      now += ms;
    },
    changeSession: () => {
      identity = "session:1";
    },
    logout: () => {
      enabled = false;
    },
  };
}
test("short background and camera handoffs conceal without locking drafts", async () => {
  const f = privacyFixture(),
    privacy = createAppPrivacy(f.deps);
  await privacy.change("inactive");
  await privacy.change("background");
  assert.deepEqual(f.state(), { locked: false, concealed: true });
  f.pass(1000);
  await privacy.change("active");
  assert.deepEqual(f.state(), { locked: false, concealed: false });
  assert(!f.events.includes("lock"));
  privacy.dispose();
});
test("expired, immediate and reversed-clock absences enforce a PIN", async () => {
  for (const [timeout, elapsed] of [
    [1000, 1000],
    [0, 1],
    [1000, -1],
  ]) {
    const f = privacyFixture(timeout),
      privacy = createAppPrivacy(f.deps);
    await privacy.change("background");
    f.pass(elapsed);
    await privacy.change("active");
    assert.deepEqual(f.state(), { locked: true, concealed: false });
    assert(f.events.indexOf("lock") < f.events.lastIndexOf("conceal:false"));
  }
});
test("PIN storage failure stays locked, while no PIN only conceals", async () => {
  const f = privacyFixture();
  f.deps.readTimeout = async () => {
    throw new Error("storage unavailable");
  };
  const privacy = createAppPrivacy(f.deps);
  await privacy.change("background");
  await privacy.change("active");
  assert.deepEqual(f.state(), { locked: true, concealed: false });
  const noPin = privacyFixture(null),
    unlocked = createAppPrivacy(noPin.deps);
  await unlocked.change("background");
  noPin.pass(60 * 60000);
  await unlocked.change("active");
  assert.deepEqual(noPin.state(), { locked: false, concealed: false });
});
test("stale foreground checks cannot reveal a new background or mutate a new session", async () => {
  const f = privacyFixture(0);
  let release;
  f.deps.readTimeout = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const privacy = createAppPrivacy(f.deps);
  await privacy.change("background");
  const foreground = privacy.change("active");
  await privacy.change("background");
  release(0);
  await foreground;
  assert.deepEqual(f.state(), { locked: false, concealed: true });
  const next = privacy.change("active");
  f.changeSession();
  release(0);
  await next;
  assert.deepEqual(f.state(), { locked: false, concealed: false });
  assert(!f.events.includes("lock"));
});
test("existing lock, logout and disposal are not undone by foregrounding", async () => {
  const f = privacyFixture(),
    privacy = createAppPrivacy(f.deps);
  f.deps.lock();
  await privacy.change("background");
  await privacy.change("active");
  assert(f.state().locked);
  f.logout();
  await privacy.change("background");
  await privacy.change("active");
  assert(f.state().locked);
  privacy.dispose();
  await privacy.change("background");
  assert.equal(f.state().concealed, false);
});
test("invitations, logout and PIN settings remain reachable before joining a firm", () => {
  for (const path of [["firms"], ["settings", "account"], ["settings", "pin"]])
    assert(availableWithoutFirm(path));
  for (const path of [
    ["sale", "new"],
    ["settings", "team"],
    ["settings"],
    ["final-accounts"],
  ])
    assert(!availableWithoutFirm(path));
});

test("viewer voucher reads expose no posting rights and sales staff stay in sales books", () => {
  for (const type of [
    "sale",
    "receipt",
    "credit-note",
    "estimate",
    "sales-order",
    "delivery-note",
    "purchase",
    "payment",
    "expense",
    "debit-note",
    "purchase-order",
    "journal",
    "contra",
  ]) {
    assert.equal(canManageVoucher("viewer", type), false);
    assert.equal(canManageVoucher(null, type), false);
    assert.equal(canManageVoucher("owner", type), true);
    assert.equal(canManageVoucher("accountant", type), true);
    assert.equal(
      canManageVoucher("sales", type),
      [
        "sale",
        "receipt",
        "credit-note",
        "estimate",
        "sales-order",
        "delivery-note",
      ].includes(type),
    );
  }
});
function memoryStore() {
  const data = new Map();
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
    lock: async (_key, work) => work(),
  };
}
test("header and body disconnects return cached reads through the offline transport", async () => {
  for (const stage of ["headers", "body"]) {
    let online = true;
    const send = async () => {
      if (online) return new Response('{"balance":12500}');
      if (stage === "headers") throw new TypeError("network lost");
      return {
        text: async () => {
          throw new TypeError("body interrupted");
        },
      };
    };
    const books = createOfflineBooks({
      scope: { userId: "user", firmId: "firm", role: "owner" },
      store: memoryStore(),
      transport: async (path) =>
        JSON.parse(
          (await requestApi(`https://local.invalid${path}`, {}, 100, send))
            .text,
        ),
      newId: () => "unused-key",
      recoveryEpoch: () => DEVELOPMENT_RECOVERY_EPOCH,
      assertActive: () => {},
      verifyAccess: async () => {},
    });
    const expected = await books.transport("/v1/reports/dashboard");
    online = false;
    assert.deepEqual(await books.transport("/v1/reports/dashboard"), expected);
    assert.equal(books.getSnapshot().online, false);
  }
});
test("deadline covers stalled headers and bodies and marks writes uncertain", async () => {
  for (const stage of ["headers", "body"]) {
    let signal;
    const send = async (_url, init) => {
      signal = init.signal;
      if (stage === "headers") return new Promise(() => {});
      return { text: () => new Promise(() => {}) };
    };
    await assert.rejects(
      requestApi(
        "https://local.invalid",
        { method: "POST", headers: { "idempotency-key": "stable-request" } },
        20,
        send,
      ),
      (error) => {
        assert(error instanceof ApiFailure);
        assert.equal(error.code, "REQUEST_TIMEOUT");
        assert.equal(error.offline, true);
        assert.equal(error.details.outcome, "unknown");
        return true;
      },
    );
    assert.equal(signal?.aborted, true);
  }
});
test("complete HTTP rejections remain definite, not offline failures", async () => {
  const send = async () =>
    new Response('{"error":{"code":"DENIED"}}', { status: 403 });
  const result = await requestApi("https://local.invalid", {}, 100, send);
  assert.equal(result.response.status, 403);
  assert.equal(JSON.parse(result.text).error.code, "DENIED");
});

test("number and print responses honor content type without accepting malformed JSON", () => {
  const number = "NSI/26-27/0001",
    html = "<!doctype html><html><body>Fixture invoice</body></html>";
  assert.equal(parseApiBody(number, "text/plain; charset=utf-8"), number);
  assert.equal(parseApiBody(html, "Text/HTML; charset=utf-8"), html);
  assert.equal(
    parseApiBody(JSON.stringify(number), "application/json"),
    number,
  );
  assert.deepEqual(
    parseApiBody('{"code":"DENIED"}', "application/problem+json"),
    { code: "DENIED" },
  );
  assert.equal(parseApiBody(number, "application/json"), null);
  assert.equal(parseApiBody('{"broken":', "application/json"), null);
  assert.equal(parseApiBody(html, null), null);
  assert.equal(parseApiBody("", "application/json"), null);
  assert.equal(parseApiBody("", "text/plain"), "");
});
const issuedItem = {
  id: "item",
  name: "Issued item",
  code: "",
  group: "",
  hsn: "1234",
  unit: "Pcs",
  altUnit: { name: "Box", factor: 12 },
  taxType: "taxable",
  gstRate: 18,
  purchasePrice: 100,
  salePrice: 200,
  mrp: 0,
  reorderLevel: 0,
  openingStock: 0,
};
const changedItem = {
  ...issuedItem,
  name: "New name",
  altUnit: { name: "Pack", factor: 12 },
  gstRate: 5,
};
test("saved packing, GST, discounts and charges survive master edits", () => {
  for (const scope of ["gst", "nongst"]) {
    for (const discount of [{ discountPercent: 10 }, { discountAmount: 99 }]) {
      const voucher = {
        id: "purchase",
        number: "PI/1",
        type: "purchase",
        date: "2026-10-01",
        status: "posted",
        amount: 0,
        createdAt: "",
        bookScope: scope,
        lines: [
          {
            itemId: "item",
            qty: 2,
            rate: 12000,
            per: { unit: "Box", factor: 12 },
            gstRate: scope === "gst" ? 18 : 0,
            taxType: scope === "gst" ? "taxable" : "nongst",
            bookScope: scope,
            ...discount,
          },
        ],
        charges: [
          { name: "Freight", amount: 500, gstRate: 5 },
          { name: "Packing", amount: 100, gstRate: 0 },
        ],
      };
      const draft = invoiceDrafts(voucher, true)[0],
        edited = invoiceDraftLine(draft, changedItem, scope);
      const charges = invoiceDraftCharges(500, voucher.charges);
      assert.deepEqual(edited.per, { unit: "Box", factor: 12 });
      assert.equal(edited.gstRate, voucher.lines[0].gstRate);
      assert.deepEqual(
        calcInvoice({ lines: [edited], charges, interState: false }),
        calcInvoice({
          lines: voucher.lines,
          charges: voucher.charges,
          interState: false,
        }),
      );
    }
  }
});
test("new lines use current masters; existing rows prefer issued item snapshots", () => {
  const draft = {
    key: 1,
    itemId: "item",
    qty: "2",
    rate: "120",
    inAlt: true,
    discountPercent: "",
  };
  const line = invoiceDraftLine(draft, changedItem, "gst");
  assert.deepEqual(line.per, { unit: "Pack", factor: 12 });
  assert.equal(line.gstRate, 5);
  const voucher = { snapshot: { items: [issuedItem] } };
  assert.equal(invoiceDraftItem("item", changedItem, voucher), issuedItem);
  assert.equal(invoiceDraftItem("new-item", changedItem, voucher), changedItem);
});
