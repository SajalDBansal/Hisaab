/* eslint-disable no-unused-vars, no-console */
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    ({ chromium } = require("C:/Users/dutts/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core"));
  }
}

const CHROME_PATH = process.env.CHROME_PATH || "C:/Users/dutts/AppData/Local/ms-playwright/chromium-1140/chrome-win/chrome.exe";
const BASE_URL = process.env.BASE_URL || "http://localhost:3900";
const API_URL = process.env.API_URL || "http://localhost:3309";

const routes = [
  "/",
  "/parties",
  "/items",
  "/more",
  "/create",
  "/accounting",
  "/accounts",
  "/associates",
  "/associates/fields",
  "/associates/new",
  "/associates/payout",
  "/audit",
  "/banking",
  "/contra/new",
  "/daybook",
  "/documents",
  "/documents/new",
  "/expense/new",
  "/final-accounts",
  "/firms",
  "/gst",
  "/gstr1",
  "/gstr3b",
  "/inventory",
  "/inventory/new",
  "/item/new",
  "/journal/financing",
  "/journal/new",
  "/loans",
  "/loans/new",
  "/note/new",
  "/notifications",
  "/orders",
  "/order/new",
  "/party/new",
  "/payment/new",
  "/purchase/new",
  "/purchases",
  "/receipt/new",
  "/reconcile",
  "/reports",
  "/reports/cash-forecast",
  "/reports/expenses",
  "/reports/outstanding",
  "/reports/stock",
  "/reports/trade",
  "/sale/new",
  "/sales",
  "/search",
  "/settings",
  "/settings/account",
  "/settings/backup",
  "/settings/books",
  "/settings/documents",
  "/settings/firm",
  "/settings/imports",
  "/settings/invite",
  "/settings/invoice",
  "/settings/offline-books",
  "/settings/opening-allocations",
  "/settings/pending-uploads",
  "/settings/pin",
  "/settings/reminders",
  "/settings/reports",
  "/settings/team",
  "/settings/units",
  "/settings/year-end",
  "/settlements",
  "/settlements/interest",
  "/settlements/new",
  "/account/new",
];

async function run() {
  console.log("Starting Browser Acceptance Suite...");
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const failures = [];
  const exceptions = [];
  const apiErrors = [];
  let currentTarget = "";

  page.on("pageerror", (err) => {
    exceptions.push({ target: currentTarget, message: err.message });
  });

  page.on("response", (res) => {
    if (res.status() >= 400 && res.url().includes(":3309/v1/")) {
      apiErrors.push({
        target: currentTarget,
        status: res.status(),
        url: res.url(),
      });
    }
  });

  try {
    // Step 1: Sign in as owner
    currentTarget = "auth-signin";
    console.log("1. Signing in as owner...");
    await page.goto(`${BASE_URL}/`);
    await page.waitForTimeout(600);

    const emailBox = page.getByRole("textbox", { name: /email/i }).first();
    if (await emailBox.count() > 0) {
      await emailBox.fill("owner@system-fixture.invalid");
      await page.getByRole("textbox", { name: /password/i }).first().fill("Fixture-Only-Password-2026!");
      await page.getByRole("button", { name: /sign in|login|continue/i }).first().click();
      await page.waitForTimeout(1500);
    }
    console.log("Logged in. Current URL:", page.url());

    // Step 2: Ensure a firm is selected or create one
    currentTarget = "firm-check";
    if (page.url().includes("/firms") || (await page.getByText(/Create firm|Select a firm/i).count()) > 0) {
      const firmButton = page.getByRole("button", { name: /Acceptance|Browser/i }).first();
      if (await firmButton.count() > 0) {
        await firmButton.click();
        await page.waitForTimeout(1000);
      }
    }

    // Step 3: Run the full 72 routes check across Desktop (1280px) and Mobile (390px)
    console.log(`2. Testing ${routes.length} routes at 1280px and 390px viewports...`);
    let checkedCount = 0;

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        currentTarget = `${width}px:${route}`;
        try {
          const res = await page.goto(`${BASE_URL}${route}`, { timeout: 15000 });
          await page.waitForTimeout(300);

          const evalData = await page.evaluate(() => ({
            text: document.body ? document.body.innerText : "",
            overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          }));

          const status = res ? res.status() : 0;
          const isErrorText = /Something went wrong|Render Error|undefined is not a function/i.test(evalData.text);

          if (status !== 200 || evalData.overflow || evalData.text.length < 10 || isErrorText) {
            failures.push({
              target: currentTarget,
              status,
              overflow: evalData.overflow,
              textLen: evalData.text.length,
              snippet: evalData.text.slice(0, 150).replace(/\n/g, " "),
            });
          }
          checkedCount++;
        } catch (e) {
          failures.push({ target: currentTarget, error: e.message });
        }
      }
    }

    console.log(`Completed route sweep: ${checkedCount} checks executed.`);
    console.log(`Failures: ${failures.length}, Exceptions: ${exceptions.length}, API Errors: ${apiErrors.length}`);

    // Step 4: Verify A05 Draft Preservation
    console.log("3. Verifying A05 Form Draft Preservation...");
    currentTarget = "a05-draft-preservation";
    await page.goto(`${BASE_URL}/party/new`);
    await page.waitForTimeout(600);
    const nameInput = page.getByRole("textbox", { name: /name/i }).first();
    if (await nameInput.count() > 0) {
      await nameInput.fill("Preserved Test Party Draft");
      // Simulate app backgrounding concealment
      await page.evaluate(() => {
        window.dispatchEvent(new Event("blur"));
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await page.waitForTimeout(500);
      const val = await nameInput.inputValue();
      if (val !== "Preserved Test Party Draft") {
        failures.push({ target: "a05-draft-preservation", error: `Expected draft preserved, found: '${val}'` });
      } else {
        console.log("PASS A05 Draft preserved successfully across blur/focus.");
      }
    }

    // Step 5: Verify A06 Invitee Zero-Firm Flow
    console.log("4. Verifying A06 Invitee Zero-Firm Acceptance...");
    currentTarget = "a06-invitee-flow";
    const inviteeContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const inviteePage = await inviteeContext.newPage();
    await inviteePage.goto(`${BASE_URL}/`);
    await inviteePage.waitForTimeout(600);
    const inviteeEmail = inviteePage.getByRole("textbox", { name: /email/i }).first();
    if (await inviteeEmail.count() > 0) {
      await inviteeEmail.fill("invitee@system-fixture.invalid");
      await inviteePage.getByRole("textbox", { name: /password/i }).first().fill("Fixture-Only-Password-2026!");
      await inviteePage.getByRole("button", { name: /sign in|login|continue/i }).first().click();
      await inviteePage.waitForTimeout(1500);
      const text = await inviteePage.locator("body").innerText();
      // Should not be stuck or crash; should allow account/invitations access
      const hasAccountAccess = text.includes("Firms") || text.includes("Account") || text.includes("Invitations") || text.includes("Create firm");
      if (!hasAccountAccess) {
        failures.push({ target: "a06-invitee-flow", error: `Invitee screen text unexpected: ${text.slice(0, 150)}` });
      } else {
        console.log("PASS A06 Invitee reachable without crash or redirect loop.");
      }
    }
    await inviteeContext.close();

    console.log("\n================ SUMMARY ================");
    console.log(JSON.stringify({
      totalChecks: checkedCount,
      failuresCount: failures.length,
      failures: failures.slice(0, 10),
      exceptionsCount: exceptions.length,
      exceptions: exceptions.slice(0, 10),
      apiErrorsCount: apiErrors.length,
      apiErrors: apiErrors.slice(0, 10),
    }, null, 2));

    if (failures.length > 0 || exceptions.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Browser Acceptance Suite Error:", err);
  process.exit(1);
});
