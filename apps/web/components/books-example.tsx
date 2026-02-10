"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";

const views = {
  Mixed: {
    sales: 15000,
    tax: 1800,
    total: 16800,
    lines: [
      ["GST sale", "10,000", "1,800"],
      ["Non-GST sale", "5,000", "0"],
    ],
  },
  GST: {
    sales: 10000,
    tax: 1800,
    total: 11800,
    lines: [["GST sale", "10,000", "1,800"]],
  },
  "Non-GST": {
    sales: 5000,
    tax: 0,
    total: 5000,
    lines: [["Non-GST sale", "5,000", "0"]],
  },
} as const;
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

export function BooksExample() {
  const [selected, setSelected] = useState<keyof typeof views>("Mixed");
  const view = views[selected];
  return (
    <div className="books-example" aria-label="Illustrative sales report">
      <div className="example-header">
        <div>
          <p className="eyebrow">An illustrative business</p>
          <h3>Sales at a glance</h3>
        </div>
        <span className="sample-label">Sample books</span>
      </div>
      <div className="segmented" aria-label="Report view">
        {(Object.keys(views) as (keyof typeof views)[]).map((key) => (
          <button
            key={key}
            aria-pressed={selected === key}
            onClick={() => setSelected(key)}
          >
            {key}
          </button>
        ))}
      </div>
      <div className="example-totals" aria-live="polite">
        <div>
          <span>Sales value</span>
          <strong>{money(view.sales)}</strong>
        </div>
        <div>
          <span>GST amount</span>
          <strong>{money(view.tax)}</strong>
        </div>
        <div>
          <span>Bill total</span>
          <strong>{money(view.total)}</strong>
        </div>
      </div>
      <table>
        <caption className="sr-only">{selected} illustrative sales</caption>
        <thead>
          <tr>
            <th>Entry</th>
            <th>Sales value</th>
            <th>GST</th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map(([name, amount, tax]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{amount}</td>
              <td>{tax}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="example-footer">
        <p>
          Two bills. Separate views. One combined picture.
          <br />
          Example excludes discounts, freight and rounding.
        </p>
        <Link
          href="/accounting-principles"
          className="icon-link"
          aria-label="Read the accounting principles"
          title="Accounting principles"
        >
          <ArrowUpRight size={20} />
        </Link>
      </div>
    </div>
  );
}
