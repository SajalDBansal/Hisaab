import Image from "next/image";
import { PageHeading } from "@/components/page-heading";
import { FeatureBrowser } from "@/components/feature-browser";
import { NextStep } from "@/components/next-step";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Features",
  "Explore Hisaab sales, purchases, inventory lots, accounts, reports, partners and document features.",
  "/features",
);
export default function FeaturesPage() {
  return (
    <>
      <div className="container">
        <PageHeading
          eyebrow="The Hisaab toolkit"
          title="Built around your working day."
          description="The everyday entries and the bigger picture, connected in one accounting system."
        />
        <FeatureBrowser />
        <section className="section product-gallery">
          <div className="section-heading">
            <p className="eyebrow">Inside Hisaab</p>
            <h2>The record, with its context.</h2>
            <p>
              An actual sale from sample books, including its separate non-GST
              bill.
            </p>
          </div>
          <figure>
            <Image
              src="/images/hisaab-sale.webp"
              width={1280}
              height={900}
              alt="Hisaab sample sales bill with GST breakdown and link to the separately numbered non-GST bill"
              sizes="(max-width: 800px) 100vw, 1100px"
            />
            <figcaption>
              Illustrative test records. The issued bill retains its original
              details.
            </figcaption>
          </figure>
        </section>
      </div>
      <NextStep />
    </>
  );
}
