/**
 * Mock data for "Shree Krishna Traders", Mathura.
 *
 * Dates are relative to today (e.g. 52 days ago) so overdue bills, due dates
 * and "today's sales" always look realistic whenever you open the app.
 *
 * Vouchers are created by replaying business events through the same
 * functions the app uses (createSale, createReceipt …), so totals, GST,
 * numbering and bill allocation are always consistent.
 */
import { autoAllocate, partyBalance, partyBills } from "../accounting/bills";
import { acc } from "../accounting/accounts";
import { calcTds } from "../accounting/tds";
import { addDays, financialYear, today } from "../dates";
import { DEFAULT_UNITS } from "../units";
import { stateName } from "../states";
import { rupees } from "../money";
import type {
  ExtraCharge,
  Firm,
  InvoiceLine,
  Item,
  Ledger,
  NewFirmInput,
  Party,
  PaymentMode,
} from "../types";
import {
  DEFAULT_BILL_OF_SUPPLY_PREFIX,
  DEFAULT_PREFIXES,
  DEFAULT_REMINDERS,
  createExpense,
  createNote,
  createContra,
  createOrder,
  createJournal,
  createPayment,
  createPurchase,
  createReceipt,
  createSale,
  findParty,
  type Db,
} from "./db";

export function buildSeed(asOf: string = today()): Db {
  const fy = financialYear(asOf);
  const daysAgo = (n: number) => addDays(asOf, -n);

  const firm: Firm = {
    id: "firm_skt",
    name: "Shree Krishna Traders",
    city: "Mathura",
    state: "Uttar Pradesh",
    stateCode: "09",
    gstin: "09AAAAA0000A1Z0",
    gstRegistration: "regular",
    fyStart: fy.start,
    address: "12, Holi Gate Bazaar",
    phone: "98370 45120",
    email: "accounts@shreekrishnatraders.in",
    pan: "AAAAA0000A",
  };

  // Opening balances are dated about six months back so they show up in ageing.
  const opening = daysAgo(185);

  const ledgers: Ledger[] = [
    {
      id: "cash",
      name: "Cash-in-hand",
      kind: "cash",
      shortName: "Cash",
      openingBalance: rupees(25000),
    },
    {
      id: "sbi",
      name: "SBI Current ··7782",
      kind: "bank",
      shortName: "SBI ··7782",
      openingBalance: rupees(350000),
    },
    {
      id: "hdfc",
      name: "HDFC Current ··4521",
      kind: "bank",
      shortName: "HDFC ··4521",
      openingBalance: rupees(180000),
    },
  ];

  const customer = (p: Omit<Party, "type" | "openingDate">): Party => ({
    ...p,
    type: "customer",
    openingDate: opening,
  });
  const supplier = (p: Omit<Party, "type" | "openingDate">): Party => ({
    ...p,
    type: "supplier",
    openingDate: opening,
  });

  const parties: Party[] = [
    customer({
      id: "c1",
      name: "Gupta Kirana Store",
      phone: "98370 41226",
      city: "Mathura",
      stateCode: "09",
      gstin: "09ABCPG1234K1ZW",
      creditDays: 30,
      creditLimit: rupees(50000),
      openingBalance: rupees(14500),
    }),
    customer({
      id: "c2",
      name: "Radhe Shyam Sweets",
      phone: "94120 77310",
      city: "Mathura",
      stateCode: "09",
      gstin: "09AADFR5678L1ZH",
      creditDays: 30,
      creditLimit: rupees(60000),
      openingBalance: 0,
    }),
    customer({
      id: "c3",
      name: "Sharma Electricals",
      phone: "94140 22318",
      city: "Jaipur",
      stateCode: "08",
      gstin: "08AAKFS4321P1ZP",
      creditDays: 15,
      creditLimit: rupees(100000),
      openingBalance: 0,
    }),
    customer({
      id: "c4",
      name: "Agarwal & Sons",
      phone: "99271 30458",
      city: "Mathura",
      stateCode: "09",
      gstin: "09AAGFA7788Q1ZE",
      creditDays: 30,
      creditLimit: rupees(75000),
      openingBalance: rupees(8000),
    }),
    customer({
      id: "c5",
      name: "Bansal Provision Store",
      phone: "97600 18842",
      city: "Mathura",
      stateCode: "09",
      gstin: "09ABNPB2211C1ZC",
      creditDays: 30,
      creditLimit: rupees(40000),
      openingBalance: 0,
    }),
    customer({
      id: "c6",
      name: "Mahalaxmi General Store",
      phone: "88591 20376",
      city: "Mathura",
      stateCode: "09",
      gstin: "09AAMFM4410D1ZI",
      creditDays: 15,
      creditLimit: 0,
      openingBalance: 0,
    }),
    customer({
      id: "c7",
      name: "Vrindavan Dairy",
      phone: "90454 66120",
      city: "Vrindavan",
      stateCode: "09",
      gstin: "09AAVFV1203E1Z5",
      creditDays: 15,
      creditLimit: rupees(30000),
      openingBalance: 0,
    }),
    customer({
      id: "c8",
      name: "Ramesh Chand",
      phone: "93590 04127",
      city: "Mathura",
      stateCode: "09",
      creditDays: 7,
      creditLimit: rupees(10000),
      openingBalance: 0,
    }),
    customer({
      id: "c9",
      name: "Hotel Brijwasi",
      phone: "70178 55093",
      city: "Mathura",
      stateCode: "09",
      gstin: "09AAHFB9087F1Z3",
      creditDays: 30,
      creditLimit: rupees(50000),
      openingBalance: 0,
    }),
    customer({
      id: "c10",
      name: "Krishna Medical Hall",
      phone: "95571 82064",
      city: "Mathura",
      stateCode: "09",
      gstin: "09AAKPK3345G1ZN",
      creditDays: 30,
      creditLimit: 0,
      openingBalance: 0,
    }),
    supplier({
      id: "s1",
      name: "Jain Wholesale",
      phone: "98970 11024",
      city: "Agra",
      stateCode: "09",
      gstin: "09AAJFJ4521M1Z1",
      creditDays: 30,
      creditLimit: 0,
      openingBalance: -rupees(25000),
    }),
    supplier({
      id: "s2",
      name: "Mathura Oil Mills",
      phone: "94123 88710",
      city: "Mathura",
      stateCode: "09",
      gstin: "09AAEFM2210K1ZH",
      creditDays: 21,
      creditLimit: 0,
      openingBalance: -rupees(12000),
    }),
    supplier({
      id: "s3",
      name: "Shiv Electricals",
      phone: "98110 45672",
      city: "Delhi",
      stateCode: "07",
      gstin: "07AAQFS6672H1ZK",
      creditDays: 30,
      creditLimit: 0,
      openingBalance: 0,
    }),
    supplier({
      id: "s4",
      name: "Agarwal Packaging",
      phone: "93190 22145",
      city: "Mathura",
      stateCode: "09",
      gstin: "09AAHFA1123J1ZQ",
      creditDays: 45,
      creditLimit: 0,
      openingBalance: -rupees(9440),
    }),
    supplier({
      id: "s5",
      name: "Kanha Dairy Distributors",
      phone: "97191 30027",
      city: "Mathura",
      stateCode: "09",
      gstin: "09AAKFK8890L1ZD",
      creditDays: 15,
      creditLimit: 0,
      openingBalance: 0,
    }),
  ];

  const box = { name: "Box", factor: 12 };
  const items: Item[] = [
    {
      id: "i1",
      name: "Fortune Mustard Oil 1 L",
      code: "FMO-1L",
      hsn: "1514",
      group: "Edible Oils",
      taxType: "taxable",
      gstRate: 5,
      unit: "Nos",
      altUnit: box,
      purchasePrice: rupees(165),
      salePrice: rupees(195),
      mrp: rupees(195),
      reorderLevel: 36,
      openingStock: 60,
    },
    {
      id: "i2",
      name: "Aashirvaad Atta 10 kg",
      code: "AAT-10",
      hsn: "1101",
      group: "Staples",
      taxType: "taxable",
      gstRate: 5,
      unit: "Nos",
      purchasePrice: rupees(410),
      salePrice: rupees(499),
      mrp: rupees(499),
      reorderLevel: 15,
      openingStock: 40,
    },
    {
      id: "i3",
      name: "India Gate Basmati 25 kg",
      code: "IGB-25",
      hsn: "1006",
      group: "Staples",
      taxType: "taxable",
      gstRate: 5,
      unit: "Nos",
      purchasePrice: rupees(2050),
      salePrice: rupees(2490),
      mrp: rupees(2600),
      reorderLevel: 5,
      openingStock: 10,
    },
    {
      id: "i4",
      name: "Tata Salt 1 kg",
      code: "TS-1",
      hsn: "2501",
      group: "Staples",
      taxType: "nil",
      gstRate: 0,
      unit: "Nos",
      altUnit: box,
      purchasePrice: rupees(27),
      salePrice: rupees(32),
      mrp: rupees(32),
      reorderLevel: 60,
      openingStock: 240,
    },
    {
      id: "i5",
      name: "Amul Pure Ghee 1 L",
      code: "AMG-1L",
      hsn: "0405",
      group: "Dairy",
      taxType: "taxable",
      gstRate: 5,
      unit: "Nos",
      purchasePrice: rupees(580),
      salePrice: rupees(665),
      mrp: rupees(665),
      reorderLevel: 10,
      openingStock: 24,
      batch: { number: "AG2608", expiry: addDays(asOf, 45) },
    },
    {
      id: "i6",
      name: "Philips LED Bulb 9W",
      code: "PLB-9",
      hsn: "8539",
      group: "Electricals",
      taxType: "taxable",
      gstRate: 18,
      unit: "Nos",
      altUnit: box,
      purchasePrice: rupees(65),
      salePrice: rupees(99),
      mrp: rupees(110),
      reorderLevel: 48,
      openingStock: 120,
    },
    {
      id: "i7",
      name: "Havells Wire 1.5 sq mm 90 m",
      code: "HW-15",
      hsn: "8544",
      group: "Electricals",
      taxType: "taxable",
      gstRate: 18,
      unit: "Nos",
      purchasePrice: rupees(1400),
      salePrice: rupees(1790),
      mrp: rupees(1890),
      reorderLevel: 15,
      openingStock: 12,
    },
    {
      id: "i8",
      name: "Coca-Cola 750 ml",
      code: "CC-750",
      hsn: "2202",
      group: "Beverages",
      taxType: "taxable",
      gstRate: 40,
      unit: "Nos",
      altUnit: box,
      purchasePrice: rupees(35),
      salePrice: rupees(45),
      mrp: rupees(45),
      reorderLevel: 24,
      openingStock: 72,
    },
    {
      id: "i9",
      name: "Colgate Strong Teeth 200 g",
      code: "CST-200",
      hsn: "3306",
      group: "Personal Care",
      taxType: "taxable",
      gstRate: 5,
      unit: "Nos",
      purchasePrice: rupees(101),
      salePrice: rupees(128),
      mrp: rupees(136),
      reorderLevel: 36,
      openingStock: 30,
    },
    {
      id: "i10",
      name: "Sugar (loose)",
      code: "SUG-KG",
      hsn: "1701",
      group: "Staples",
      taxType: "taxable",
      gstRate: 5,
      unit: "Kg",
      purchasePrice: rupees(40),
      salePrice: rupees(46),
      mrp: rupees(48),
      reorderLevel: 100,
      openingStock: 500,
    },
    {
      id: "i11",
      name: "Anchor Switch 6A",
      code: "AS-6",
      hsn: "8536",
      group: "Electricals",
      taxType: "taxable",
      gstRate: 18,
      unit: "Nos",
      purchasePrice: rupees(22),
      salePrice: rupees(36),
      mrp: rupees(38),
      reorderLevel: 50,
      openingStock: 200,
    },
    {
      id: "i12",
      name: "Bisleri Water 1 L",
      code: "BIS-1",
      hsn: "2201",
      group: "Beverages",
      taxType: "taxable",
      gstRate: 18,
      unit: "Nos",
      altUnit: box,
      purchasePrice: rupees(15),
      salePrice: rupees(20),
      mrp: rupees(20),
      reorderLevel: 48,
      openingStock: 96,
    },
    {
      id: "i13",
      name: "Fresh Milk 500 ml",
      code: "MILK-500",
      hsn: "0401",
      group: "Dairy",
      taxType: "exempt",
      gstRate: 0,
      unit: "Nos",
      purchasePrice: rupees(26),
      salePrice: rupees(28),
      mrp: rupees(28),
      reorderLevel: 40,
      openingStock: 80,
    },
    {
      id: "i14",
      name: "Diesel (loose)",
      code: "HSD",
      hsn: "", // non-GST goods need no HSN
      group: "Fuel",
      taxType: "nongst",
      gstRate: 0,
      unit: "Ltr",
      purchasePrice: rupees(88),
      salePrice: rupees(92),
      mrp: 0,
      reorderLevel: 50,
      openingStock: 200,
    },
  ];

  const db: Db = {
    firm,
    parties,
    items: items.map((i) => ({
      ...i,
      openingCost: i.purchasePrice,
      openingBookScope: i.taxType === "nongst" ? "nongst" : "gst",
    })),
    ledgers,
    vouchers: [],
    openingAccounts: [
      { account: acc.asset("Furniture & Fixtures"), amount: rupees(240000) },
      { account: acc.asset("Computers"), amount: rupees(45000) },
    ],
    counters: {},
    invoiceSettings: {
      template: "classic",
      terms:
        "Goods once sold will not be taken back. Interest @18% p.a. on bills unpaid after the due date. Subject to Mathura jurisdiction.",
      showBankDetails: true,
      bankLedgerId: "hdfc",
      // Demo account details (not a real account)
      bankAccount: {
        accountName: "Shree Krishna Traders",
        accountNumber: "50200012344521",
        ifsc: "HDFC0001234",
        upiId: "shreekrishna@hdfcbank",
      },
      prefixes: { ...DEFAULT_PREFIXES },
      billOfSupplyPrefix: DEFAULT_BILL_OF_SUPPLY_PREFIX,
    },
    team: [
      {
        id: "u1",
        name: "Sajal Bansal",
        phone: "9837045120",
        role: "owner",
        active: true,
        lastActive: asOf,
      },
      {
        id: "u2",
        name: "Neha Gupta",
        phone: "9412311876",
        role: "accountant",
        active: true,
        lastActive: daysAgo(1),
      },
      {
        id: "u3",
        name: "Ravi Kumar",
        phone: "9719088234",
        role: "sales",
        active: true,
        lastActive: asOf,
      },
      {
        id: "u4",
        name: "CA Mehta & Co.",
        phone: "9810066543",
        role: "viewer",
        active: false,
      },
    ],
    currentUserId: "u1",
    documents: [],
    units: DEFAULT_UNITS.map((u) => ({ ...u })),
    reminders: { ...DEFAULT_REMINDERS },
    remindedOn: {},
    readNotices: [],
    auditLog: [],
  };
  const item = (id: string) => items.find((i) => i.id === id)!;

  /**
   * [itemId, qty, discount%?, "box"?] → invoice line at the item's sale or purchase price.
   * With "box" the quantity is in the item's second unit and the rate is per box.
   */
  type Row = [string, number, number?, "box"?];
  const toLines = (
    rows: Row[],
    priceKey: "salePrice" | "purchasePrice",
  ): InvoiceLine[] =>
    rows.map(([id, qty, disc, inBox]) => {
      const alt = item(id).altUnit;
      const per =
        inBox && alt ? { unit: alt.name, factor: alt.factor } : undefined;
      return {
        itemId: id,
        qty,
        rate: item(id)[priceKey] * (per?.factor ?? 1),
        gstRate: item(id).gstRate,
        discountPercent: disc,
        per,
      };
    });

  const sale = (
    partyId: string,
    ago: number,
    rows: Row[],
    extra: {
      charges?: ExtraCharge[];
      status?: "posted" | "cancelled" | "draft";
      paidNow?: PaymentMode;
    } = {},
  ) =>
    createSale(
      db,
      {
        partyId,
        date: daysAgo(ago),
        lines: toLines(rows, "salePrice"),
        charges: extra.charges ?? [],
        paidNow: extra.paidNow
          ? {
              amount: Number.MAX_SAFE_INTEGER,
              mode: extra.paidNow,
              ledgerId: extra.paidNow === "cash" ? "cash" : "hdfc",
            }
          : undefined,
      },
      { status: extra.status, legacyStock: true },
    );

  const purchase = (
    partyId: string,
    ago: number,
    rows: Row[],
    supplierInvoiceNo: string,
  ) =>
    createPurchase(db, {
      partyId,
      date: daysAgo(ago),
      lines: toLines(rows, "purchasePrice"),
      charges: [],
      supplierInvoiceNo,
    });

  /** Receive money from a customer. "all" = clear the full balance. Allocated oldest bill first. */
  const receive = (
    partyId: string,
    ago: number,
    amount: number | "all",
    mode: PaymentMode,
    ledgerId: string,
    reference?: string,
  ) => {
    const party = findParty(db, partyId);
    const date = daysAgo(ago);
    const value =
      amount === "all" ? partyBalance(party, db.vouchers) : rupees(amount);
    if (value <= 0) return;
    const { allocations } = autoAllocate(
      value,
      partyBills(party, db.vouchers, date),
    );
    createReceipt(db, {
      partyId,
      date,
      amount: value,
      mode,
      ledgerId,
      reference,
      allocations,
    });
  };

  /** Pay a supplier. "all" = clear everything we owe them. */
  const pay = (
    partyId: string,
    ago: number,
    amount: number | "all",
    mode: PaymentMode,
    ledgerId: string,
    tds?: { section: string; rate: number },
  ) => {
    const party = findParty(db, partyId);
    const date = daysAgo(ago);
    // `settle` is the bill value cleared; TDS is kept back, the rest is paid out.
    const settle =
      amount === "all" ? -partyBalance(party, db.vouchers) : rupees(amount);
    if (settle <= 0) return;
    const tdsAmount = tds ? calcTds(settle, tds.rate) : 0;
    const { allocations } = autoAllocate(
      settle,
      partyBills(party, db.vouchers, date),
    );
    createPayment(db, {
      partyId,
      date,
      amount: settle - tdsAmount,
      mode,
      ledgerId,
      allocations,
      tds: tds ? { ...tds, amount: tdsAmount } : undefined,
    });
  };

  const expense = (
    ago: number,
    head: string,
    amount: number,
    ledgerId: string,
    pendingSync = false,
  ) =>
    createExpense(
      db,
      {
        date: daysAgo(ago),
        expenseHead: head,
        amount: rupees(amount),
        mode: ledgerId === "cash" ? "cash" : "bank",
        ledgerId,
      },
      { pendingSync },
    );

  /** Journal with [accountKey, name, debit, credit] lines in rupees. */
  const journal = (
    ago: number,
    narration: string,
    lines: [string, string, number, number][],
  ) =>
    createJournal(db, {
      date: daysAgo(ago),
      narration,
      lines: lines.map(([account, name, debit, credit]) => ({
        account,
        name,
        debit: rupees(debit),
        credit: rupees(credit),
      })),
    });

  const freight = (amount: number): ExtraCharge[] => [
    { name: "Freight", amount: rupees(amount), gstRate: 18 },
  ];

  // ---- Six months of business, oldest first ---------------------------------
  purchase(
    "s1",
    180,
    [
      ["i2", 20],
      ["i4", 120],
      ["i6", 96],
    ],
    "JW/0712",
  );
  sale("c1", 178, [
    ["i2", 6],
    ["i4", 48],
  ]);
  sale("c4", 172, [
    ["i6", 24],
    ["i11", 40],
  ]);
  sale("c2", 165, [
    ["i10", 80],
    ["i5", 4],
  ]);
  receive("c1", 160, "all", "upi", "hdfc");
  purchase("s2", 155, [["i1", 48]], "MOM/401");
  sale("c6", 150, [
    ["i1", 24],
    ["i8", 24],
  ]);
  receive("c4", 145, "all", "bank", "sbi", "NEFT");
  sale("c3", 140, [
    ["i7", 4],
    ["i6", 24],
  ]);
  pay("s1", 135, "all", "bank", "sbi");
  sale("c9", 128, [
    ["i8", 24],
    ["i12", 48],
  ]);
  sale("c5", 120, [
    ["i2", 4],
    ["i4", 24],
  ]);
  receive("c2", 115, "all", "cash", "cash");
  expense(110, "Rent", 12000, "sbi");
  sale("c10", 105, [["i9", 6]]);
  receive("c6", 100, "all", "cash", "cash");
  purchase(
    "s5",
    97,
    [
      ["i8", 24],
      ["i5", 6],
    ],
    "KD/2101",
  );
  purchase(
    "s1",
    90,
    [
      ["i2", 40],
      ["i3", 6],
      ["i4", 240],
    ],
    "JW/0980",
  );
  sale("c1", 88, [
    ["i1", 12],
    ["i2", 6],
  ]);
  sale("c4", 86, [
    ["i6", 48],
    ["i11", 60],
  ]);
  receive("c1", 85, "all", "bank", "hdfc", "NEFT");
  purchase("s2", 84, [["i1", 8, undefined, "box"]], "MOM/512");
  sale("c2", 82, [
    ["i5", 10],
    ["i10", 100],
  ]);
  sale(
    "c3",
    80,
    [
      ["i7", 8],
      ["i6", 48],
    ],
    { charges: freight(600) },
  );
  sale("c6", 78, [
    ["i8", 48],
    ["i12", 48],
    ["i9", 12],
  ]);
  expense(76, "Freight Inward", 1800, "cash");
  receive("c4", 75, "all", "upi", "hdfc");
  purchase(
    "s5",
    74,
    [
      ["i8", 144],
      ["i12", 144],
    ],
    "KD/2231",
  );
  purchase(
    "s3",
    72,
    [
      ["i7", 20],
      ["i6", 240],
      ["i11", 200],
    ],
    "SE/861",
  );
  sale("c5", 70, [
    ["i2", 8],
    ["i4", 60],
    ["i10", 50],
  ]);
  sale("c9", 68, [
    ["i8", 72],
    ["i12", 96],
  ]);
  receive("c3", 66, "all", "bank", "sbi", "RTGS");
  pay("s1", 65, "all", "bank", "sbi");
  sale("c7", 63, [
    ["i5", 6],
    ["i10", 40],
  ]);
  purchase("s1", 62, [["i9", 72]], "JW/1034");
  // Non-GST goods (diesel) and exempt goods (milk): billed by the same rules as the app
  purchase("s2", 61, [["i14", 400]], "MOM/566");
  sale("c10", 60, [
    ["i9", 12],
    ["i12", 24],
  ]);
  receive("c6", 58, "all", "cash", "cash");
  sale("c9", 57, [["i14", 60]]);
  purchase("s5", 56, [["i5", 24]], "KD/2290");
  sale("c2", 55, [
    ["i5", 12],
    ["i10", 120],
    ["i1", 12],
  ]);
  sale("c1", 52, [
    ["i1", 24, 2],
    ["i2", 10],
    ["i3", 2],
  ]);
  sale("c8", 50, [
    ["i4", 24],
    ["i10", 20],
  ]);
  receive("c9", 48, "all", "upi", "hdfc");
  pay("s2", 47, "all", "bank", "hdfc");
  sale("c4", 46, [
    ["i6", 72],
    ["i11", 40],
    ["i7", 2],
  ]);
  sale("c5", 44, [
    ["i2", 6],
    ["i3", 1],
    ["i9", 12],
  ]);
  expense(42, "Electricity", 4230, "hdfc");
  sale("c1", 40, [
    ["i8", 48],
    ["i9", 24],
    ["i6", 24],
  ]);
  sale("c2", 38, [
    ["i5", 8],
    ["i10", 100],
  ]);
  purchase(
    "s1",
    36,
    [
      ["i2", 40],
      ["i1", 8, undefined, "box"],
      ["i4", 20, undefined, "box"],
      ["i3", 4],
    ],
    "JW/1182",
  );
  receive("c10", 35, "all", "cash", "cash");
  pay("s3", 34, 30000, "bank", "sbi");
  purchase("s5", 33, [["i13", 160]], "KD/2388");
  sale(
    "c3",
    32,
    [
      ["i7", 10],
      ["i11", 100],
    ],
    { charges: freight(800) },
  );
  purchase("s1", 30, [["i10", 400]], "JW/1240");
  expense(30, "Rent", 12000, "sbi");
  sale("c6", 28, [
    ["i1", 24],
    ["i8", 24],
    ["i12", 24],
  ]);
  receive("c5", 27, "all", "upi", "hdfc");
  sale("c7", 25, [
    ["i5", 4],
    ["i10", 60],
  ]);
  sale("c10", 24, [["i9", 24]]);
  sale("c1", 24, [
    ["i13", 40],
    ["i2", 2],
  ]);
  purchase("s4", 23, [["i11", 100]], "AP/778");
  purchase(
    "s5",
    22,
    [
      ["i8", 96],
      ["i12", 96],
    ],
    "KD/2402",
  );
  purchase("s1", 20, [["i9", 48]], "JW/1301");
  sale("c9", 20, [
    ["i8", 48],
    ["i12", 48],
  ]);
  receive("c4", 18, 15000, "upi", "hdfc");
  sale("c8", 17, [
    ["i13", 20],
    ["i4", 10],
  ]);
  sale("c5", 16, [
    ["i2", 8],
    ["i4", 48],
    ["i10", 40],
  ]);
  pay("s5", 14, "all", "bank", "hdfc");
  pay("s4", 11, "all", "bank", "sbi", { section: "194C", rate: 2 });
  journal(35, "Depreciation on furniture for the half year", [
    [acc.expense("Depreciation"), "Depreciation", 6000, 0],
    [acc.asset("Furniture & Fixtures"), "Furniture & Fixtures", 0, 6000],
  ]);
  journal(5, "Salary for last month, to be paid on the 7th", [
    [acc.expense("Salary"), "Salary", 24000, 0],
    [acc.provision("Salary Payable"), "Salary Payable", 0, 24000],
  ]);
  sale("c4", 12, [
    ["i6", 48],
    ["i7", 3],
  ]);
  sale("c8", 10, [
    ["i10", 30],
    ["i4", 24],
  ]);
  sale("c2", 8, [
    ["i1", 1, undefined, "box"],
    ["i5", 6],
  ]);
  sale("c1", 6, [
    ["i1", 1, undefined, "box"],
    ["i4", 4, undefined, "box"],
    ["i8", 24],
  ]);
  purchase(
    "s3",
    5,
    [
      ["i7", 10],
      ["i6", 120],
    ],
    "SE/889",
  );
  expense(4, "Freight Inward", 1500, "cash");
  sale("c3", 3, [["i7", 6]]);
  sale("c3", 3, [["i14", 100]]);
  sale("c9", 3, [["i8", 24]], { status: "cancelled" });
  receive("c2", 2, 15000, "cheque", "sbi", "Cheque 004512");
  sale("c9", 2, [["i14", 40]], { paidNow: "cash" });
  sale("c6", 1, [
    ["i9", 12],
    ["i12", 24],
  ]);
  sale("c5", 0, [
    ["i2", 4],
    ["i4", 24],
  ]);
  sale("c10", 0, [["i9", 12]], { paidNow: "cash" });
  receive("c4", 0, 5000, "upi", "hdfc");
  sale("c7", 0, [["i10", 25]], { status: "draft" });
  expense(0, "Freight Inward", 1800, "cash", true);

  // Returns: a damaged coil of wire from Sharma Electricals, one wrong item sent back to Shiv Electricals
  const lastBill = (type: "sale" | "purchase", partyId: string) =>
    [...db.vouchers]
      .reverse()
      .find(
        (v) =>
          v.type === type && v.partyId === partyId && v.status === "posted",
      )!;
  createNote(db, "credit-note", {
    againstId: lastBill("sale", "c3").id,
    date: daysAgo(1),
    lines: [{ index: 0, qty: 1 }],
    reason: "Damaged",
  });
  createNote(db, "debit-note", {
    againstId: lastBill("purchase", "s3").id,
    date: daysAgo(2),
    lines: [{ index: 0, qty: 1 }],
    reason: "Wrong item",
  });

  // Money between cash and bank
  createContra(db, {
    date: daysAgo(9),
    fromLedgerId: "cash",
    toLedgerId: "hdfc",
    amount: rupees(20000),
    reference: "Deposit slip 4471",
  });
  createContra(db, {
    date: daysAgo(3),
    fromLedgerId: "sbi",
    toLedgerId: "cash",
    amount: rupees(5000),
    reference: "ATM",
  });

  // Estimates and orders: one quote turned into an order and then billed, the rest still open
  const quote = createOrder(db, "estimate", {
    partyId: "c9",
    date: daysAgo(12),
    lines: toLines(
      [
        ["i3", 2],
        ["i2", 4],
      ],
      "salePrice",
    ),
    charges: [],
  });
  const order = createOrder(db, "sales-order", {
    partyId: "c9",
    date: daysAgo(10),
    lines: toLines(
      [
        ["i3", 2],
        ["i2", 4],
      ],
      "salePrice",
    ),
    charges: [],
    sourceId: quote.id,
  });
  createSale(
    db,
    {
      partyId: "c9",
      date: daysAgo(8),
      lines: toLines(
        [
          ["i3", 2],
          ["i2", 4],
        ],
        "salePrice",
      ),
      charges: [],
      sourceId: order.id,
    },
    { legacyStock: true },
  );
  createOrder(db, "estimate", {
    partyId: "c6",
    date: daysAgo(2),
    lines: toLines(
      [
        ["i7", 5],
        ["i9", 24],
      ],
      "salePrice",
    ),
    charges: [],
  });
  createOrder(db, "estimate", {
    partyId: "c5",
    date: daysAgo(30),
    lines: toLines([["i1", 2, undefined, "box"]], "salePrice"),
    charges: [],
  });
  createOrder(db, "sales-order", {
    partyId: "c3",
    date: daysAgo(1),
    lines: toLines(
      [
        ["i8", 50],
        ["i7", 4],
      ],
      "salePrice",
    ),
    charges: [],
  });
  createOrder(
    db,
    "delivery-note",
    {
      partyId: "c7",
      date: daysAgo(1),
      lines: toLines([["i4", 2, undefined, "box"]], "salePrice"),
      charges: [],
    },
    { legacyStock: true },
  );
  createOrder(db, "purchase-order", {
    partyId: "s1",
    date: daysAgo(4),
    lines: toLines(
      [
        ["i2", 20],
        ["i3", 5],
      ],
      "purchasePrice",
    ),
    charges: [],
  });

  // Documents: scans of the latest supplier bills, plus firm papers.
  const purchases = db.vouchers.filter((v) => v.type === "purchase").slice(-3);
  db.documents = [
    ...purchases.reverse().map((v, i) => ({
      id: `doc${i + 1}`,
      name: `Bill ${v.supplierInvoiceNo ?? v.number}.jpg`,
      kind: "bill" as const,
      sizeKb: 640 + i * 85,
      uploadedOn: v.date,
      partyId: v.partyId,
      voucherId: v.id,
    })),
    {
      id: "doc4",
      name: "Cheque 004512 deposit slip.jpg",
      kind: "receipt",
      sizeKb: 410,
      uploadedOn: daysAgo(2),
      partyId: "c2",
    },
    {
      id: "doc5",
      name: "GST registration certificate.pdf",
      kind: "certificate",
      sizeKb: 230,
      uploadedOn: daysAgo(170),
    },
    {
      id: "doc6",
      name: "Shop rent agreement 2026.pdf",
      kind: "agreement",
      sizeKb: 1240,
      uploadedOn: daysAgo(150),
      note: "Valid till 31-03-2027",
    },
    {
      id: "doc7",
      name: "Udyam certificate.pdf",
      kind: "certificate",
      sizeKb: 180,
      uploadedOn: daysAgo(160),
    },
  ];

  // Bank reconciliation demo: bank entries older than 4 days already show in the
  // bank statement (a day or two later); the latest ones are still uncleared.
  const banks = new Set(["sbi", "hdfc"]);
  db.vouchers.forEach((v, i) => {
    const touchesBank =
      banks.has(v.ledgerId ?? "") || banks.has(v.toLedgerId ?? "");
    if (!touchesBank || v.status !== "posted" || v.date > daysAgo(5)) return;
    if (i % 9 === 4) return; // a few old cheques never cleared
    v.clearedOn = addDays(v.date, 1 + (i % 2));
  });
  db.remindedOn = { c1: daysAgo(2) };

  return db;
}

/**
 * Empty books for a new firm: cash account, default settings, the owner as the only member.
 * A second demo firm uses this so "Switch firm" has something to switch to.
 */
export function blankBooks(
  input: NewFirmInput & { id: string },
  asOf: string = today(),
): Db {
  const fy = financialYear(asOf);
  return {
    firm: {
      id: input.id,
      name: input.name.trim(),
      city: input.city.trim(),
      state: stateName(input.stateCode),
      stateCode: input.stateCode,
      gstin: (input.gstin ?? "").trim().toUpperCase(),
      gstRegistration: input.gstRegistration,
      compositionType:
        input.gstRegistration === "composition"
          ? (input.compositionType ?? "trader")
          : undefined,
      fyStart: fy.start,
    },
    parties: [],
    items: [],
    ledgers: [
      {
        id: "cash",
        name: "Cash-in-hand",
        kind: "cash",
        shortName: "Cash",
        openingBalance: 0,
      },
    ],
    vouchers: [],
    openingAccounts: [],
    counters: {},
    invoiceSettings: {
      template: "classic",
      terms: "Goods once sold will not be taken back.",
      showBankDetails: false,
      bankLedgerId: "",
      prefixes: { ...DEFAULT_PREFIXES },
      billOfSupplyPrefix: DEFAULT_BILL_OF_SUPPLY_PREFIX,
    },
    team: [
      {
        id: "u1",
        name: "Sajal Bansal",
        phone: "9837045120",
        role: "owner",
        active: true,
        lastActive: asOf,
      },
    ],
    currentUserId: "u1",
    documents: [],
    units: DEFAULT_UNITS.map((u) => ({ ...u })),
    reminders: { ...DEFAULT_REMINDERS },
    remindedOn: {},
    readNotices: [],
    auditLog: [],
  };
}

/** Second demo firm: a small shop with a little opening money and two parties. */
export function secondDemoFirm(asOf: string = today()): Db {
  const db = blankBooks(
    {
      id: "firm_kha",
      name: "Krishna Hardware",
      city: "Agra",
      stateCode: "09",
      gstin: "09BBBBB1111B1ZL",
      gstRegistration: "composition",
    },
    asOf,
  );
  db.ledgers[0].openingBalance = rupees(8000);
  db.ledgers.push({
    id: "pnb",
    name: "PNB Current ··3310",
    kind: "bank",
    shortName: "PNB ··3310",
    openingBalance: rupees(42000),
  });
  const opening = addDays(asOf, -30);
  db.parties.push(
    {
      id: "c1",
      name: "Verma Builders",
      type: "customer",
      phone: "98971 20044",
      city: "Agra",
      stateCode: "09",
      gstin: "",
      creditDays: 15,
      creditLimit: rupees(30000),
      openingBalance: rupees(6200),
      openingDate: opening,
    },
    {
      id: "s1",
      name: "Agra Steel Traders",
      type: "supplier",
      phone: "94120 55611",
      city: "Agra",
      stateCode: "09",
      gstin: "09CCCCC2222C1Z6",
      creditDays: 30,
      creditLimit: 0,
      openingBalance: -rupees(12500),
      openingDate: opening,
    },
  );
  return db;
}
