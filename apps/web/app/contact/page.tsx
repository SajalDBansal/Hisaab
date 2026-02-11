import Link from "next/link";
import { ArrowUpRight, Mail, ShieldCheck } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata(
  "Contact",
  "Find the right route for Hisaab account access, product help and privacy or security concerns.",
  "/contact",
);
export default function ContactPage() {
  return (
    <div className="container">
      <PageHeading
        eyebrow="Contact & support"
        title="Get the right help."
        description="Account access, a question about your books or a concern about your data. Start with the right person."
      />
      <div className="contact-layout">
        <section>
          <Mail size={28} strokeWidth={1.5} />
          <h2>Product and account support</h2>
          {site.supportEmail ? (
            <>
              <p>
                Send the affected page, approximate time and error message. A
                redacted screenshot can help explain the issue.
              </p>
              <a className="text-link" href={`mailto:${site.supportEmail}`}>
                {site.supportEmail}
                <ArrowUpRight size={18} />
              </a>
            </>
          ) : (
            <p>
              Contact the owner or administrator who gave you access to Hisaab.
              They can check your deployment, firm membership and support
              arrangements.
            </p>
          )}
          <p>
            For a firm permission or opening-balance question, start with your
            firm owner or accountant.
          </p>
          <Link className="text-link" href="/help">
            Browse the help centre <ArrowUpRight size={18} />
          </Link>
        </section>
        <section>
          <ShieldCheck size={28} strokeWidth={1.5} />
          <h2>Privacy and security concerns</h2>
          <p>
            Contact your deployment owner through a private channel. Describe
            what happened without sending passwords, verification codes, secret
            keys or unredacted financial exports.
          </p>
          <p>
            For access, correction or deletion requests, include the account and
            firm involved, but do not attach business documents unless a secure
            process has been agreed.
          </p>
          <Link className="text-link" href="/privacy">
            Read the product data overview <ArrowUpRight size={18} />
          </Link>
        </section>
      </div>
      <section className="support-band">
        <div>
          <h2>Is an entry stuck or pending?</h2>
          <p>
            Do not clear device storage or re-enter the transaction before
            checking its result.
          </p>
        </div>
        <Link href="/help#pending-entry" className="button button-light">
          Pending entry help <ArrowUpRight size={17} />
        </Link>
      </section>
    </div>
  );
}
