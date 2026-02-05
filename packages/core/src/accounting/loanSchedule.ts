/** Contractual projection only. This module never creates accounting postings. */
export interface LoanScheduleTerms {
  principal: number;
  annualRateBps: number;
  installments: number;
  startDate: string;
  firstDueDate: string;
  scheduleModel: "fixed-principal-monthly-v1" | "fixed-principal-v2" | "emi-v1";
  interestBasis?: "monthly" | "actual-365" | "actual-360";
  rateChanges?: { effectiveDate: string; annualRateBps: number }[];
}

export interface LoanInstallment {
  number: number;
  dueDate: string;
  openingPrincipal: number;
  principal: number;
  interest: number;
  total: number;
  closingPrincipal: number;
  periodStart: string;
  days: number;
  annualRateBps: number;
  rateSegments: { from: string; to: string; annualRateBps: number }[];
}

function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= "1900-01-01" &&
    value <= "9999-12-31" &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  );
}

/** Anchor every installment to the original day, clamping short months without drift. */
function dueDate(first: string, offset: number) {
  const [year, month, day] = first.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const monthIndex = year * 12 + month - 1 + offset;
  const y = Math.floor(monthIndex / 12);
  const m = monthIndex % 12;
  if (y > 9999) throw new Error("Maturity must be on or before 9999-12-31.");
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

function safe(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("The schedule total is too large.");
  return Number(value);
}

const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86400000,
  );
const validRate = (rate: number) =>
  Number.isInteger(rate) && rate >= 0 && rate <= 10000;
type Factor = { numerator: bigint; denominator: bigint };
const roundedInterest = (principal: bigint, factor: Factor) =>
  (principal * factor.numerator * 2n + factor.denominator) /
  (factor.denominator * 2n);

function periodFactor(
  terms: LoanScheduleTerms,
  from: string,
  to: string,
  assumedRate?: number,
) {
  const changes = assumedRate === undefined ? (terms.rateChanges ?? []) : [];
  let rate = assumedRate ?? terms.annualRateBps;
  for (const change of changes)
    if (change.effectiveDate <= from) rate = change.annualRateBps;
  let cursor = from;
  const segments: LoanInstallment["rateSegments"] = [];
  for (const change of changes.filter(
    (r) => r.effectiveDate > from && r.effectiveDate < to,
  )) {
    segments.push({
      from: cursor,
      to: change.effectiveDate,
      annualRateBps: rate,
    });
    cursor = change.effectiveDate;
    rate = change.annualRateBps;
  }
  segments.push({ from: cursor, to, annualRateBps: rate });
  const days = daysBetween(from, to);
  const basis = terms.interestBasis ?? "monthly";
  const numerator = segments.reduce(
    (sum, s) =>
      sum + BigInt(s.annualRateBps) * BigInt(daysBetween(s.from, s.to)),
    0n,
  );
  const denominator =
    basis === "monthly"
      ? BigInt(days) * 120000n
      : BigInt(basis === "actual-365" ? 365 : 360) * 10000n;
  return { numerator, denominator, segments, days, rate };
}

/** Minimal whole-paise installment that amortizes the remaining term without float rounding. */
function emiPayment(principal: bigint, factors: Factor[]) {
  let low = 1n;
  let high = principal + roundedInterest(principal, factors[0]!);
  while (low < high) {
    const payment = (low + high) / 2n;
    let balance = principal;
    for (const factor of factors) {
      balance += roundedInterest(balance, factor) - payment;
      if (balance <= 0n) break;
    }
    if (balance > 0n) low = payment + 1n;
    else high = payment;
  }
  return low;
}

/** Future rate revisions may not restate any protected contractual period. */
export function loanRateUpdateAllowed(
  before: LoanScheduleTerms,
  after: LoanScheduleTerms,
  protectedThrough: string,
) {
  if (before.scheduleModel === "fixed-principal-monthly-v1") return false;
  if (
    before.scheduleModel !== after.scheduleModel ||
    before.principal !== after.principal ||
    before.annualRateBps !== after.annualRateBps ||
    before.installments !== after.installments ||
    before.startDate !== after.startDate ||
    before.firstDueDate !== after.firstDueDate ||
    (before.interestBasis ?? "monthly") !== (after.interestBasis ?? "monthly")
  )
    return false;
  const protectedRates = (terms: LoanScheduleTerms) =>
    (terms.rateChanges ?? []).filter(
      (r) => r.effectiveDate <= protectedThrough,
    );
  return (
    JSON.stringify(protectedRates(before)) ===
    JSON.stringify(protectedRates(after))
  );
}

export function loanSchedule(terms: LoanScheduleTerms) {
  if (
    !["fixed-principal-monthly-v1", "fixed-principal-v2", "emi-v1"].includes(
      terms.scheduleModel,
    )
  )
    throw new Error("Unsupported loan schedule model.");
  if (!Number.isSafeInteger(terms.principal) || terms.principal <= 0)
    throw new Error("Enter principal in positive whole paise.");
  if (!validRate(terms.annualRateBps))
    throw new Error(
      "Annual interest must be between 0 and 100 percent, in basis points.",
    );
  if (
    !Number.isInteger(terms.installments) ||
    terms.installments < 1 ||
    terms.installments > 600 ||
    terms.installments > terms.principal
  )
    throw new Error(
      "Use 1 to 600 installments, each with at least one paise of principal.",
    );
  if (
    !validDate(terms.startDate) ||
    !validDate(terms.firstDueDate) ||
    terms.firstDueDate <= terms.startDate
  )
    throw new Error("First repayment must be after the loan start date.");

  if (
    terms.interestBasis !== undefined &&
    !["monthly", "actual-365", "actual-360"].includes(terms.interestBasis)
  )
    throw new Error("Unsupported interest basis.");
  if (
    terms.scheduleModel === "fixed-principal-monthly-v1" &&
    ((terms.interestBasis && terms.interestBasis !== "monthly") ||
      terms.rateChanges?.length)
  )
    throw new Error(
      "Legacy schedules use one fixed rate and equal monthly periods.",
    );
  const dates = Array.from({ length: terms.installments }, (_, index) =>
    dueDate(terms.firstDueDate, index),
  );
  const maturity = dates[dates.length - 1]!;
  if ((terms.rateChanges?.length ?? 0) > 600)
    throw new Error("Use at most 600 reviewed rate changes.");
  let previous = terms.startDate;
  for (const change of terms.rateChanges ?? []) {
    if (
      !validDate(change.effectiveDate) ||
      change.effectiveDate <= previous ||
      change.effectiveDate >= maturity ||
      !validRate(change.annualRateBps)
    )
      throw new Error(
        "Rate changes must have valid rates and unique ascending dates after start and before maturity.",
      );
    previous = change.effectiveDate;
  }

  const rows: LoanInstallment[] = [];
  const regular = Math.floor(terms.principal / terms.installments);
  let opening = terms.principal;
  let interestTotal = 0n;
  let payment = 0n;
  let lastRateRevision = -1;
  for (let index = 0; index < terms.installments; index++) {
    const from = index === 0 ? terms.startDate : dates[index - 1]!;
    const to = dates[index]!;
    const factor = periodFactor(terms, from, to);
    const interest = safe(roundedInterest(BigInt(opening), factor));
    const rateRevision = (terms.rateChanges ?? []).filter(
      (r) => r.effectiveDate < to,
    ).length;
    if (terms.scheduleModel === "emi-v1" && rateRevision !== lastRateRevision) {
      const future = dates
        .slice(index)
        .map((date, offset) =>
          offset === 0
            ? factor
            : periodFactor(
                terms,
                dates[index + offset - 1]!,
                date,
                factor.rate,
              ),
        );
      payment = emiPayment(BigInt(opening), future);
      lastRateRevision = rateRevision;
    }
    const regularPrincipal =
      terms.scheduleModel === "emi-v1"
        ? payment - BigInt(interest)
        : BigInt(regular);
    if (index < terms.installments - 1 && regularPrincipal <= 0n)
      throw new Error(
        "These EMI terms require unpaid-interest capitalization. Change the dates or tenor.",
      );
    const principal =
      index === terms.installments - 1 ? opening : safe(regularPrincipal);
    if (
      principal <= 0 ||
      (index < terms.installments - 1 && principal >= opening)
    )
      throw new Error(
        "These EMI terms require unpaid-interest capitalization or early whole-paise payoff. Change the tenor, dates or principal.",
      );
    const total = safe(BigInt(principal) + BigInt(interest));
    rows.push({
      number: index + 1,
      dueDate: to,
      openingPrincipal: opening,
      principal,
      interest,
      total,
      closingPrincipal: opening - principal,
      periodStart: from,
      days: factor.days,
      annualRateBps: factor.rate,
      rateSegments: factor.segments,
    });
    opening -= principal;
    interestTotal += BigInt(interest);
  }
  return {
    installments: rows,
    maturityDate: rows[rows.length - 1]!.dueDate,
    totalPrincipal: terms.principal,
    totalInterest: safe(interestTotal),
    totalRepayment: safe(BigInt(terms.principal) + interestTotal),
  };
}
