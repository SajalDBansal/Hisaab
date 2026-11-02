import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createDb, schema } from "@repo/backend/db/client";
import { REPORT_IDS, today } from "@repo/core";
import {
  newRequestId,
  RECOVERY_EPOCH_HEADER,
  DEVELOPMENT_RECOVERY_EPOCH,
  NextNumber,
  PrintableVoucher,
} from "@repo/contracts";
import type {
  PartyRow,
  ItemRow,
  Voucher,
  FinalAccounts,
  TrialBalance,
  Role,
  CustomAccount,
} from "@repo/contracts";
import {
  FIXTURE_DATABASE,
  FIXTURE_ORIGIN,
  FIXTURE_PASSWORD,
  FIXTURE_AUTH_SECRET,
  fixtureEmail,
} from "./system-fixture";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";

type Actor = Role | "outsider";
type CookieUser = { id: string; cookie: string };
type Lot = {
  id: string;
  itemId: string;
  bookScope: "gst" | "nongst";
  qty: number;
  value: number;
};
type Reply<T> = { status: number; data: T; headers: Headers };
const timings: number[] = [];
const checks: string[] = [];
const actors = {} as Record<Actor, CookieUser>;
const { db, pool } = createDb(FIXTURE_DATABASE);
let firmId = "";
const date = today();
const runId = randomUUID().slice(0, 8);
const key = () => newRequestId(randomUUID());
const passed = (name: string) => {
  checks.push(name);
  process.stdout.write(`PASS ${name}\n`);
};

// Real HTTP requests share the fixture server while browser sessions use the separate web platform.
async function call<T>(
  method: string,
  path: string,
  body?: object,
  headers: Record<string, string> = {},
): Promise<Reply<T>> {
  const started = performance.now();
  const response = await fetch(`${FIXTURE_ORIGIN}${path}`, {
    method,
    headers: {
      origin: FIXTURE_ORIGIN,
      "content-type": "application/json",
      "x-platform": "app",
      [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  });
  const text = await response.text();
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  const json =
    contentType === "application/json" || contentType?.endsWith("+json");
  timings.push(performance.now() - started);
  return {
    status: response.status,
    data: text ? ((json ? JSON.parse(text) : text) as T) : (undefined as T),
    headers: response.headers,
  };
}
async function request<T>(
  role: Actor,
  method: string,
  path: string,
  body?: object,
  options: {
    expected?: number | number[];
    firm?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const response = await call<T>(method, path, body, {
    cookie: actors[role].cookie,
    "x-firm-id": options.firm ?? firmId,
    ...options.headers,
  });
  const expected = options.expected ?? (method === "POST" ? 201 : 200);
  assert.ok(
    (Array.isArray(expected) ? expected : [expected]).includes(response.status),
    `${method} ${path}: ${response.status} ${JSON.stringify(response.data)}`,
  );
  return response;
}
async function post<T>(role: Actor, path: string, body: object, idem = key()) {
  return (
    await request<T>(role, "POST", path, body, {
      headers: { "idempotency-key": idem },
    })
  ).data;
}
function cookieOf(headers: Headers) {
  return headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
}
async function login(role: Actor) {
  const response = await call<{ user: { id: string } }>(
    "POST",
    "/api/auth/sign-in/email",
    { email: fixtureEmail(role), password: FIXTURE_PASSWORD },
    { "x-confirm-takeover": "true" },
  );
  assert.equal(response.status, 200, JSON.stringify(response.data));
  actors[role] = {
    id: response.data.user.id,
    cookie: cookieOf(response.headers),
  };
}
function party(type: "customer" | "supplier", suffix = "") {
  return {
    name: `Acceptance ${type} ${runId}${suffix}`,
    type,
    phone: "",
    city: "Delhi",
    stateCode: "07",
    gstin: type === "supplier" ? "07AAAAA0000A1Z5" : "",
    creditDays: 0,
    creditLimit: 0,
    openingBalance: 0,
  };
}
async function rolesInFirm() {
  for (const role of ["accountant", "sales", "viewer"] as const)
    await db
      .insert(schema.member)
      .values({ organizationId: firmId, userId: actors[role].id, role })
      .onConflictDoNothing();
}

try {
  const fixture = await call<{ firmId: string; otherFirmId: string }>(
    "GET",
    "/__fixture",
  );
  assert.equal(fixture.status, 200);
  for (const role of [
    "owner",
    "accountant",
    "sales",
    "viewer",
    "outsider",
  ] as const)
    await login(role);
  const firm = await request<{ id: string }>("owner", "POST", "/v1/firms", {
    name: `Acceptance ${runId}`,
    city: "Delhi",
    stateCode: "07",
    gstRegistration: "regular",
    gstin: "07AAAAA0000A1Z5",
  });
  firmId = firm.data.id;
  await rolesInFirm();
  passed("verified multiuser sign-in and independent acceptance firm");

  const supplier = await post<PartyRow>(
    "accountant",
    "/v1/parties",
    party("supplier"),
  );
  const customer = await post<PartyRow>(
    "sales",
    "/v1/parties",
    party("customer"),
  );
  const item = await post<ItemRow>("accountant", "/v1/items", {
    name: `Hardware ${runId}`,
    code: `ACC-${runId}`,
    hsn: "8205",
    group: "Hardware",
    taxType: "taxable",
    gstRate: 18,
    unit: "Pcs",
    purchasePrice: 10000,
    salePrice: 15000,
    mrp: 0,
    reorderLevel: 2,
    openingStock: 0,
    openingCost: 0,
    openingBookScope: "gst",
  });
  const ledgers = (
    await request<{ id: string; name: string; kind: string }[]>(
      "owner",
      "GET",
      "/v1/ledgers",
    )
  ).data;
  const cash = ledgers.find((row) => row.kind === "cash");
  assert.ok(cash);
  const capital = await post<CustomAccount>("owner", "/v1/accounts/masters", {
    name: `Capital ${runId}`,
    group: "Capital Account",
    openingBalance: 0,
    contactName: "",
    phone: "",
    note: "Synthetic acceptance",
  });
  const accounts = (
    await request<{ key: string; name: string }[]>(
      "owner",
      "GET",
      "/v1/accounts",
    )
  ).data;
  const capitalKey = accounts.find((row) => row.name === capital.name)?.key;
  const cashKey = accounts.find((row) => row.name === cash.name)?.key;
  assert.ok(capitalKey && cashKey);
  await post<Voucher>("accountant", "/v1/journals", {
    date,
    bookScope: "nongst",
    narration: "Synthetic capital introduced",
    lines: [
      { account: cashKey, name: cash.name, debit: 200000, credit: 0 },
      { account: capitalKey, name: capital.name, debit: 0, credit: 200000 },
    ],
  });

  const gstPurchase = await post<Voucher>("accountant", "/v1/purchases", {
    partyId: supplier.id,
    date,
    bookScope: "gst",
    supplierInvoiceNo: `GST-${runId}`,
    charges: [],
    lines: [
      {
        itemId: item.id,
        qty: 10,
        rate: 10000,
        gstRate: 18,
        taxType: "taxable",
      },
    ],
  });
  const nonPurchase = await post<Voucher>("accountant", "/v1/purchases", {
    partyId: supplier.id,
    date,
    bookScope: "nongst",
    supplierInvoiceNo: `NG-${runId}`,
    charges: [],
    lines: [
      { itemId: item.id, qty: 5, rate: 8000, gstRate: 0, taxType: "nongst" },
    ],
  });
  assert.equal(gstPurchase.amount, 118000);
  assert.equal(nonPurchase.amount, 40000);
  const lots = (
    await request<Lot[]>("sales", "GET", "/v1/items/stock-lots")
  ).data.filter((row) => row.itemId === item.id);
  const gstLot = lots.find((row) => row.bookScope === "gst" && row.qty > 0);
  const nonLot = lots.find((row) => row.bookScope === "nongst" && row.qty > 0);
  assert.ok(gstLot && nonLot);
  assert.equal(gstLot.qty, 10);
  assert.equal(nonLot.qty, 5);
  passed("GST/non-GST purchases retain separate stock costs under one item");

  const saleInput = {
    partyId: customer.id,
    date,
    charges: [],
    lines: [
      {
        itemId: item.id,
        stockLotId: gstLot.id,
        qty: 2,
        rate: 15000,
        gstRate: 18,
        taxType: "taxable",
        bookScope: "gst",
      },
      {
        itemId: item.id,
        stockLotId: nonLot.id,
        qty: 2,
        rate: 12000,
        gstRate: 0,
        taxType: "nongst",
        bookScope: "nongst",
      },
    ],
  };
  await request("sales", "POST", "/v1/sales", saleInput, {
    expected: 400,
    headers: { "idempotency-key": key() },
  });
  const sales = await post<Voucher[]>("sales", "/v1/sales/split", saleInput);
  assert.equal(sales.length, 2);
  assert.notEqual(sales[0]?.number, sales[1]?.number);
  const gstSale = sales.find((row) => row.bookScope === "gst");
  const nonSale = sales.find((row) => row.bookScope === "nongst");
  assert.ok(gstSale && nonSale);
  assert.equal(gstSale.amount, 35400);
  assert.equal(nonSale.amount, 24000);
  for (const sale of sales)
    await post<Voucher>("sales", "/v1/receipts", {
      partyId: customer.id,
      date,
      bookScope: sale.bookScope,
      mode: "cash",
      ledgerId: cash.id,
      amount: sale.amount,
      allocations: [{ voucherId: sale.id, amount: sale.amount }],
    });
  for (const purchase of [gstPurchase, nonPurchase])
    await post<Voucher>("accountant", "/v1/payments", {
      partyId: supplier.id,
      date,
      bookScope: purchase.bookScope,
      mode: "cash",
      ledgerId: cash.id,
      amount: purchase.amount,
      allocations: [{ voucherId: purchase.id, amount: purchase.amount }],
    });
  passed(
    "mixed-stock sale splits numbering and allocated receipts/payments clear bills",
  );

  const returned = await post<Voucher>("sales", "/v1/credit-notes", {
    againstId: gstSale.id,
    date,
    lines: [{ index: 0, qty: 1 }],
    reason: "Synthetic partial goods return",
  });
  assert.equal(returned.amount, 17700);
  const partyNow = (
    await request<PartyRow>("accountant", "GET", `/v1/parties/${customer.id}`)
  ).data;
  assert.equal(partyNow.balance, -17700);
  await post("accountant", "/v1/settlements", {
    kind: "customer-refund",
    partyId: customer.id,
    partyVersion: partyNow.version,
    date,
    bookScope: "gst",
    reason: "Refund returned goods",
    amount: 17700,
    ledgerId: cash.id,
  });
  await post<Voucher>("accountant", "/v1/expenses", {
    date,
    bookScope: "nongst",
    expenseHead: "Office expenses",
    amount: 1000,
    mode: "cash",
    ledgerId: cash.id,
    narration: "Synthetic expense",
  });
  const closedCustomer = (
    await request<PartyRow & { overdueAmount: number; maxOverdueDays: number }>(
      "owner",
      "GET",
      `/v1/parties/${customer.id}`,
    )
  ).data;
  assert.equal(closedCustomer.balance, 0);
  assert.equal(closedCustomer.overdueAmount, 0);
  assert.equal(closedCustomer.maxOverdueDays, 0);
  const closedSupplier = (
    await request<PartyRow>("owner", "GET", `/v1/parties/${supplier.id}`)
  ).data;
  assert.equal(closedSupplier.balance, 0);
  passed(
    "partial return, reviewed refund, expenses and zero-overdue customer balance",
  );

  const totals: Record<string, { profit: number; stock: number }> = {};
  for (const tax of ["gst", "nongst", "all"]) {
    const trial = (
      await request<TrialBalance>(
        "viewer",
        "GET",
        `/v1/reports/trial-balance?tax=${tax}`,
      )
    ).data;
    assert.equal(trial.totalDebit, trial.totalCredit);
    const final = (
      await request<FinalAccounts>(
        "viewer",
        "GET",
        `/v1/reports/final-accounts?tax=${tax}&from=2026-04-01&asOf=${date}`,
      )
    ).data;
    assert.equal(final.balanceSheet.balanced, true);
    assert.equal(
      final.balanceSheet.assets.total,
      final.balanceSheet.liabilities.total,
    );
    totals[tax] = {
      profit: final.profitAndLoss.netProfit,
      stock: final.profitAndLoss.closingStock,
    };
  }
  assert.deepEqual(totals, {
    gst: { profit: 5000, stock: 90000 },
    nongst: { profit: 7000, stock: 24000 },
    all: { profit: 12000, stock: 114000 },
  });
  const cashStatement = (
    await request<{ closing: number }>(
      "owner",
      "GET",
      `/v1/ledgers/${cash.id}/statement?tax=all`,
    )
  ).data;
  assert.equal(cashStatement.closing, 82700);
  const itemNow = (
    await request<ItemRow & { qty: number; value: number }>(
      "owner",
      "GET",
      `/v1/items/${item.id}`,
    )
  ).data;
  assert.equal(itemNow.qty, 12);
  assert.equal(itemNow.value, 114000);
  passed(
    "all three books reconcile trial balance, balance sheet, exact profit, stock and cash",
  );

  for (const tax of ["gst", "nongst", "all"])
    for (const report of REPORT_IDS) {
      const exported = await request<{ title: string; sections: unknown[] }>(
        "viewer",
        "POST",
        "/v1/reports/export",
        { report, tax, from: "2026-04-01", to: date },
        { expected: 200 },
      );
      assert.ok(exported.data.title);
      assert.ok(Array.isArray(exported.data.sections));
    }
  for (const path of [
    "/v1/reports/dashboard",
    "/v1/reports/outstanding?type=customer",
    "/v1/reports/outstanding?type=supplier",
    "/v1/reports/sale-summary?period=fy",
    "/v1/reports/purchase-summary?period=fy",
    "/v1/reports/expenses?period=fy",
    "/v1/reports/stock",
    "/v1/accounts/chart",
    "/v1/gst/months",
    `/v1/gst/gstr1?month=${date.slice(0, 7)}`,
    `/v1/gst/gstr3b?month=${date.slice(0, 7)}`,
  ])
    await request("viewer", "GET", path);
  passed(
    "63 report exports plus dashboard, registers, stock, accounts and GST read APIs",
  );

  const permissionResults = await Promise.all([
    request("sales", "GET", "/v1/reports/trial-balance", undefined, {
      expected: 403,
    }),
    request("sales", "GET", `/v1/vouchers/${gstPurchase.id}`, undefined, {
      expected: 403,
    }),
    request("sales", "GET", `/v1/parties/${supplier.id}`, undefined, {
      expected: 403,
    }),
    request("viewer", "POST", "/v1/parties", party("customer", "-forbidden"), {
      expected: 403,
    }),
    request(
      "sales",
      "POST",
      "/v1/purchases",
      {
        partyId: supplier.id,
        date,
        charges: [],
        lines: [{ itemId: item.id, qty: 1, rate: 10000, gstRate: 18 }],
      },
      { expected: 403 },
    ),
    request("outsider", "GET", "/v1/reports/trial-balance", undefined, {
      expected: 403,
    }),
    request("owner", "GET", "/v1/parties", undefined, {
      firm: fixture.data.otherFirmId,
      expected: 403,
    }),
    request("outsider", "GET", `/v1/vouchers/${gstSale.id}`, undefined, {
      firm: fixture.data.otherFirmId,
      expected: 404,
    }),
    request("accountant", "GET", "/v1/backup/export", undefined, {
      expected: 403,
    }),
    request("viewer", "GET", "/v1/backup/export", undefined, { expected: 403 }),
    request("sales", "GET", "/v1/vouchers?limit=200"),
  ]);
  const salesVisible = permissionResults.at(-1)?.data as { items: Voucher[] };
  assert.ok(
    salesVisible.items.every(
      (row) =>
        !["purchase", "payment", "journal", "expense", "debit-note"].includes(
          row.type,
        ),
    ),
  );
  passed(
    "simultaneous owner/accountant/sales/viewer/outsider role and firm isolation",
  );

  const concurrentCustomer = await post<PartyRow>(
    "sales",
    "/v1/parties",
    party("customer", "-concurrency"),
  );
  const saleBody = {
    partyId: concurrentCustomer.id,
    date,
    bookScope: "nongst",
    charges: [],
    lines: [
      {
        itemId: item.id,
        stockLotId: nonLot.id,
        qty: 1,
        rate: 12000,
        gstRate: 0,
        taxType: "nongst",
        bookScope: "nongst",
      },
    ],
  };
  const sameKey = key();
  const duplicates = await Promise.all(
    Array.from({ length: 6 }, () =>
      post<Voucher>("sales", "/v1/sales", saleBody, sameKey),
    ),
  );
  assert.equal(new Set(duplicates.map((row) => row.id)).size, 1);
  const stockAfterRetry = (
    await request<ItemRow & { qty: number }>(
      "owner",
      "GET",
      `/v1/items/${item.id}`,
    )
  ).data;
  assert.equal(stockAfterRetry.qty, 11);
  const operationKey = key();
  const operationBody = {
    method: "POST",
    path: "/receipts",
    role: "sales",
    body: {
      partyId: concurrentCustomer.id,
      date,
      bookScope: "nongst",
      mode: "cash",
      ledgerId: cash.id,
      amount: 12000,
      allocations: [{ voucherId: duplicates[0]?.id, amount: 12000 }],
    },
  };
  const operations = await Promise.all(
    Array.from({ length: 6 }, () =>
      request<{ state: string; response: Voucher }>(
        "sales",
        "POST",
        `/v1/operations/${operationKey}`,
        operationBody,
        { expected: 200 },
      ),
    ),
  );
  assert.ok(operations.every((row) => row.data.state === "committed"));
  assert.equal(new Set(operations.map((row) => row.data.response.id)).size, 1);
  const collisions = await Promise.all(
    ["owner", "accountant"].map((role) =>
      request<PartyRow>(
        role as Role,
        "PUT",
        `/v1/parties/${concurrentCustomer.id}`,
        { ...concurrentCustomer, city: role },
        {
          expected: [200, 409],
          headers: { "if-match": String(concurrentCustomer.version) },
        },
      ),
    ),
  );
  assert.deepEqual(collisions.map((row) => row.status).sort(), [200, 409]);
  const currentParty = (
    await request<PartyRow>(
      "owner",
      "GET",
      `/v1/parties/${concurrentCustomer.id}`,
    )
  ).data;
  assert.equal(currentParty.version, concurrentCustomer.version + 1);
  assert.equal(currentParty.balance, 0);
  const unbalanced = await pool.query(
    "select voucher_id from postings where firm_id=$1 group by voucher_id having sum(debit)<>sum(credit)",
    [firmId],
  );
  assert.equal(unbalanced.rowCount, 0);
  passed(
    "concurrent financial retries save once; competing versions yield one success and one conflict",
  );

  const snapshot = await request<{ text: string; fileName: string }>(
    "owner",
    "GET",
    "/v1/backup/export",
  );
  assert.ok(snapshot.data.text && snapshot.data.fileName);
  assert.match(String(snapshot.headers.get("cache-control")), /no-store/);
  const raw = JSON.parse(snapshot.data.text);
  assert.equal(JSON.stringify(raw).includes(FIXTURE_PASSWORD), false);
  passed(
    "owner-only firm export includes private no-store headers and no auth password",
  );

  for (const query of [
    "type=sale",
    "type=sale&series=nongst",
    "type=purchase",
    "type=purchase&series=nongst",
  ]) {
    const next = await request<string>(
      "owner",
      "GET",
      `/v1/vouchers/next-number?${query}&date=${date}`,
    );
    assert.match(String(next.headers.get("content-type")), /^text\/plain\b/i);
    assert.match(NextNumber.parse(next.data), /\/\d+$/);
  }
  passed(
    "next-number endpoints preserve plain-text HTTP responses and satisfy the shared string contract",
  );

  for (const entry of [gstSale, nonSale, gstPurchase, returned]) {
    const response = await request<unknown>(
      "owner",
      "GET",
      `/v1/vouchers/${entry.id}/print`,
    );
    assert.match(
      String(response.headers.get("content-type")),
      /^application\/json\b/i,
    );
    const print = PrintableVoucher.parse(response.data);
    assert.ok(print.html.includes(entry.number));
    assert.ok(print.fileName);
  }
  const reminder = await request<{ error: { code: string } }>(
    "sales",
    "GET",
    `/v1/parties/${customer.id}/reminder`,
    undefined,
    { expected: 409 },
  );
  assert.equal(reminder.data.error.code, "NOTHING_DUE");
  passed(
    "issued invoice print data renders and a cleared customer cannot receive a payment reminder",
  );

  const persisted = (
    await request<FinalAccounts>(
      "owner",
      "GET",
      "/v1/reports/final-accounts?tax=all",
    )
  ).data;
  const freshDb = createDb(FIXTURE_DATABASE, { max: 2 });
  const restarted = await buildApp({
    db: freshDb.db,
    email: memorySender().sender,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      BETTER_AUTH_SECRET: FIXTURE_AUTH_SECRET,
      BETTER_AUTH_URL: FIXTURE_ORIGIN,
      TRUSTED_ORIGINS: [FIXTURE_ORIGIN],
      SENTRY_TRACES_SAMPLE_RATE: 0,
    },
  });
  try {
    const reopened = await restarted.inject({
      url: "/v1/reports/final-accounts?tax=all",
      headers: {
        cookie: actors.owner.cookie,
        "x-firm-id": firmId,
        [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
      },
    });
    assert.equal(reopened.statusCode, 200, reopened.body);
    assert.deepEqual(reopened.json(), persisted);
    const recoveredOperation = await restarted.inject({
      method: "POST",
      url: `/v1/operations/${operationKey}/lookup`,
      payload: operationBody,
      headers: {
        cookie: actors.sales.cookie,
        "x-firm-id": firmId,
        [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
      },
    });
    assert.equal(recoveredOperation.statusCode, 200, recoveredOperation.body);
    assert.deepEqual(recoveredOperation.json(), operations[0]?.data);
  } finally {
    await restarted.close();
    await freshDb.pool.end();
  }
  passed(
    "a newly constructed API and fresh pool recover identical financial reports and durable receipts",
  );

  const transferEmail = `transfer-${runId}@system-fixture.invalid`;
  const signup = await call("POST", "/api/auth/sign-up/email", {
    name: "Fixture transfer",
    email: transferEmail,
    password: FIXTURE_PASSWORD,
    phoneNumber: `97${Date.now().toString().slice(-8)}`,
  });
  assert.equal(signup.status, 200);
  const otp = (
    await call<{ code: string }>(
      "GET",
      `/__fixture/otp?email=${encodeURIComponent(transferEmail)}`,
    )
  ).data.code;
  const verified = await call("POST", "/api/auth/email-otp/verify-email", {
    email: transferEmail,
    otp,
  });
  assert.equal(verified.status, 200);
  const appCookie = cookieOf(verified.headers);
  const webLogin = await call(
    "POST",
    "/api/auth/sign-in/email",
    { email: transferEmail, password: FIXTURE_PASSWORD },
    { "x-platform": "web" },
  );
  assert.equal(webLogin.status, 200);
  const firstWebCookie = cookieOf(webLogin.headers);
  const conflicting = await call<{ code: string }>(
    "POST",
    "/api/auth/sign-in/email",
    { email: transferEmail, password: FIXTURE_PASSWORD },
    { "x-platform": "web" },
  );
  assert.equal(conflicting.status, 409);
  assert.equal(conflicting.data.code, "ACTIVE_ELSEWHERE");
  const transfer = await call(
    "POST",
    "/api/auth/sign-in/email",
    { email: transferEmail, password: FIXTURE_PASSWORD },
    { "x-platform": "web", "x-confirm-takeover": "true" },
  );
  assert.equal(transfer.status, 200);
  const newWeb = await call("GET", "/v1/me", undefined, {
    cookie: cookieOf(transfer.headers),
    "x-platform": "web",
  });
  assert.equal(newWeb.status, 200);
  const oldWeb = await call<{ error: { code: string } }>(
    "GET",
    "/v1/me",
    undefined,
    { cookie: firstWebCookie, "x-platform": "web" },
  );
  assert.equal(oldWeb.status, 401);
  assert.equal(oldWeb.data.error.code, "SESSION_REPLACED");
  assert.equal(
    (await call("GET", "/v1/me", undefined, { cookie: appCookie })).status,
    200,
  );
  passed(
    "mobile and web coexist; confirmed web takeover succeeds once and replaces only old web session",
  );

  const rateEmail = `rate-${runId}@system-fixture.invalid`;
  const limits: number[] = [];
  for (let attempt = 0; attempt < 11; attempt++)
    limits.push(
      (
        await call("POST", "/api/auth/sign-in/email", {
          email: rateEmail,
          password: "Incorrect-Fixture-Password!",
        })
      ).status,
    );
  assert.deepEqual(limits, [...Array<number>(10).fill(401), 429]);
  passed(
    "password login permits ten failed attempts per minute and blocks the eleventh",
  );

  const sorted = timings.toSorted((a, b) => a - b);
  process.stdout.write(
    `${JSON.stringify(
      {
        passed: checks.length,
        requests: timings.length,
        firmId,
        runId,
        baseFinancialTotals: totals,
        localHttpMs: {
          p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] ?? 0),
          p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
          max: Math.round(sorted.at(-1) ?? 0),
        },
        limits: [
          "loopback fixture, not EC2 capacity certification",
          "fake storage and in-memory email; no live PDF, R2 or email delivery",
          "browser and physical-device acceptance are separate",
        ],
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await pool.end();
}
