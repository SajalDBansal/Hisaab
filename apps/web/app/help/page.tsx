import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { HelpBrowser } from "@/components/help-browser";
import { PageHeading } from "@/components/page-heading";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Help",
  "Practical answers about Hisaab bills, inventory, reports, documents, offline work and recovery.",
  "/help",
);

export default function HelpPage() {
  return (
    <div className="container">
      <PageHeading
        eyebrow="A little help with the everyday"
        title="Good questions. Clear answers."
        description="Find your way around the books, understand a transaction or pick up where you left off."
      />
      <HelpBrowser />
      <section className="support-band">
        <div>
          <h2>Still have a question?</h2>
          <p>Keep your firm, the affected entry and the error message handy.</p>
        </div>
        <Link href="/contact" className="button button-light">
          Contact & support <ArrowUpRight size={17} />
        </Link>
      </section>
    </div>
  );
}
