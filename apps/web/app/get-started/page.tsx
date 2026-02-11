import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Download } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { site } from "@/lib/site";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Get started",
  "Set up your Hisaab firm and follow your first purchase, sale and receipt through to reports.",
  "/get-started",
);
const steps = [
  {
    title: "Start with the right firm",
    text: "Create your account in the accounting app, verify your email and create or join the right firm. Check its profile, books-start date, GST setting and invoice series.",
    href: "/help#first-firm",
    label: "First-firm checklist",
  },
  {
    title: "Bring in your opening details",
    text: "Add customers, suppliers, accounts and items. Review opening balances and stock lots with your accountant before approval.",
    href: "/accounting-principles#stock-cost",
    label: "How stock costs work",
  },
  {
    title: "Follow one complete transaction",
    text: "Record a purchase, select that stock on a sale, and allocate a receipt to the invoice. Compare the resulting stock, customer balance and report totals.",
    href: "/system#daily-work",
    label: "The connected workflow",
  },
  {
    title: "Make the books part of your day",
    text: "Set appropriate team access, attach supporting documents and review pending work. Agree on a backup and recovery process with your deployment owner.",
    href: "/security#recovery-and-responsibility",
    label: "Recovery responsibilities",
  },
];

export default function GetStartedPage() {
  return (
    <div className="container">
      <PageHeading
        eyebrow="Your first entries"
        title="Start with clear foundations."
        description="A few carefully checked details now make the rest of your books easier to trust."
      />
      <section className="start-access">
        <div>
          <h2>
            {site.appUrl
              ? "Open your accounting workspace."
              : "Find your accounting workspace."}
          </h2>
          <p>
            {site.appUrl
              ? "Your books live in the signed-in application, separate from this product website."
              : "Ask your workspace owner for the accounting app address and access to your firm. This product website does not collect account or business details."}
          </p>
        </div>
        {site.appUrl ? (
          <a className="button button-dark" href={site.appUrl}>
            Open Hisaab <ArrowUpRight size={18} />
          </a>
        ) : (
          <Link className="button button-dark" href="/contact">
            Access & support <ArrowUpRight size={18} />
          </Link>
        )}
      </section>
      <Link className="text-link" href="/downloads">
        <Download size={17} aria-hidden="true" /> Android downloads
      </Link>
      <ol className="setup-steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="step-number">0{index + 1}</span>
            <div>
              <h2>{step.title}</h2>
              <p>{step.text}</p>
              <Link href={step.href} className="text-link">
                {step.label}
                <ArrowRight size={17} />
              </Link>
            </div>
          </li>
        ))}
      </ol>
      <section className="support-band">
        <div>
          <h2>Before you rely on a report</h2>
          <p className="check-line">
            <Check size={18} /> Confirm the firm, date range and book category.
          </p>
          <p className="check-line">
            <Check size={18} /> Resolve pending entries and reconcile opening
            balances.
          </p>
        </div>
        <Link className="text-link" href="/accounting-principles">
          Read the accounting principles <ArrowUpRight size={18} />
        </Link>
      </section>
    </div>
  );
}
