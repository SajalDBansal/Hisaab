import Link from "next/link";
import { ArrowUpRight, BookOpen, Package, Users } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { NextStep } from "@/components/next-step";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "About",
  "Hisaab brings everyday trading, stock and accounting into one connected business record.",
  "/about",
);
export default function AboutPage() {
  return (
    <>
      <div className="container">
        <PageHeading
          eyebrow="About Hisaab"
          title="Good business deserves clear books."
          description="Hisaab brings the practical details of running a business into the same place as its accounting."
        />
        <div className="about-intro">
          <p>
            A sale is more than an amount. It belongs to a customer, draws from
            a particular stock lot, may involve a delivery person and needs to
            be settled. Keeping those connections is what Hisaab is built
            around.
          </p>
          <p>
            The goal is straightforward: less disconnected record keeping, a
            clearer view of what is owed and a reliable path from an entry to
            its reports.
          </p>
        </div>
        <section className="section">
          <div className="essentials about-pillars">
            {[
              {
                Icon: BookOpen,
                title: "Books with context",
                text: "Keep the document, its payment and the resulting accounting connected.",
              },
              {
                Icon: Package,
                title: "Stock with a cost",
                text: "Preserve purchase lots, quantities and book categories under one item.",
              },
              {
                Icon: Users,
                title: "A business with people",
                text: "Keep customers, suppliers, associates and team access distinct.",
              },
            ].map(({ Icon, title, text }) => (
              <div className="essential" key={title}>
                <Icon size={28} strokeWidth={1.5} />
                <h2>{title}</h2>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="support-band">
          <div>
            <h2>Useful accounting. Clear boundaries.</h2>
            <p>
              Hisaab supports bookkeeping and business management. It is not a
              GST filing service or a substitute for professional review.
            </p>
          </div>
          <Link href="/system" className="text-link">
            Understand the system <ArrowUpRight size={18} />
          </Link>
        </section>
      </div>
      <NextStep />
    </>
  );
}
