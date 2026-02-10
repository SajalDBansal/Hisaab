import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Files,
  Package,
  Receipt,
  ShieldCheck,
  Users,
} from "lucide-react";
import { BooksExample } from "@/components/books-example";
import { NextStep } from "@/components/next-step";
import { HeroArtwork } from "@/components/hero-artwork";

const essentials = [
  {
    icon: Receipt,
    title: "Everyday transactions",
    text: "Sales, purchases and payments that stay connected.",
    href: "/features#sales",
  },
  {
    icon: Package,
    title: "Stock with its story",
    text: "Every purchase lot, quantity and cost in view.",
    href: "/features#stock",
  },
  {
    icon: BookOpen,
    title: "Books that add up",
    text: "From a balanced journal to your final accounts.",
    href: "/accounting-principles",
  },
  {
    icon: Users,
    title: "People, not just balances",
    text: "Customers, suppliers and the partners you work with.",
    href: "/features#partners",
  },
];

export default function Home() {
  return (
    <>
      <section className="home-hero" aria-labelledby="home-title">
        <HeroArtwork />
        <div className="hero-copy">
          <p className="eyebrow">Accounting & business management</p>
          <h1 id="home-title">
            Hisaab<span>.</span>
          </h1>
          <p>
            Every entry. Every stock lot.
            <br />
            One clear view of your business.
          </p>
          <div className="hero-actions">
            <Link href="/get-started" className="button button-dark">
              Explore Hisaab <ArrowUpRight size={18} />
            </Link>
            <a href="#everyday" className="button button-plain">
              Take a closer look <ArrowDown size={16} />
            </a>
          </div>
        </div>
        <p className="hero-caption">
          Actual Hisaab workspace · Sample business records
        </p>
      </section>
      <section className="section container" id="everyday">
        <div className="section-heading">
          <p className="eyebrow">The everyday, brought together</p>
          <h2>A place for the whole business.</h2>
          <p>
            From the first purchase to the last payment of the day.
            <br className="desktop-break" /> Keep your transactions, stock and
            accounts connected.
          </p>
        </div>
        <div className="essentials">
          {essentials.map(({ icon: Icon, ...item }) => (
            <Link href={item.href} key={item.title} className="essential">
              <Icon strokeWidth={1.4} size={28} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <ArrowUpRight size={18} className="essential-arrow" />
            </Link>
          ))}
        </div>
      </section>
      <section className="section soft-band">
        <div className="container books-layout">
          <div className="section-heading">
            <p className="eyebrow">Different books. The same clarity.</p>
            <h2>
              GST. Non-GST.
              <br />
              And the full picture.
            </h2>
            <p>
              Record each purchase in the right category. Keep separate bill
              series and view either side of your business, or both together.
            </p>
            <Link href="/features#books" className="text-link">
              Explore the three book views <ArrowRight size={17} />
            </Link>
            <p className="small-note">
              Bookkeeping and normal GST summaries.
              <br />
              Not a GST filing service.
            </p>
          </div>
          <BooksExample />
        </div>
      </section>
      <section className="section container" id="workflow">
        <div className="section-heading">
          <p className="eyebrow">A connected working day</p>
          <h2>The entry is just the beginning.</h2>
          <p>One real workflow, with the details carried through.</p>
        </div>
        <ol className="workflow">
          {[
            [
              "Set up your firm",
              "Add the people, items and accounts you work with.",
            ],
            [
              "Bring in the stock",
              "Record the purchase, its cost and its book category.",
            ],
            [
              "Sell and settle",
              "Choose a stock lot, issue a bill and record the receipt.",
            ],
            [
              "See where you stand",
              "Review stock, outstanding amounts and balanced reports.",
            ],
          ].map(([title, text], index) => (
            <li key={title}>
              <span className="step-number">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              {index < 3 && <ArrowRight className="step-arrow" size={20} />}
            </li>
          ))}
        </ol>
        <Link className="text-link" href="/system">
          Follow the system from entry to report <ArrowRight size={17} />
        </Link>
      </section>
      <section className="dark-band">
        <div className="container dark-inner">
          <div>
            <p className="eyebrow">The details deserve a record</p>
            <h2>
              A bill is more
              <br />
              than a number.
            </h2>
          </div>
          <div>
            <div className="dark-point">
              <Files size={24} />
              <div>
                <h3>Keep the original close</h3>
                <p>
                  Attach bill photos and supporting documents to their entry.
                  Find them again by party, ledger, date or folder.
                </p>
              </div>
            </div>
            <div className="dark-point">
              <ShieldCheck size={24} />
              <div>
                <h3>Keep the history intact</h3>
                <p>
                  Follow changes, control team access and review corrections
                  without losing the record of what happened.
                </p>
              </div>
            </div>
            <Link href="/security" className="text-link">
              How your records are protected <ArrowUpRight size={17} />
            </Link>
          </div>
        </div>
      </section>
      <section className="section container resource-section">
        <div className="section-heading">
          <p className="eyebrow">A little understanding goes a long way</p>
          <h2>Know the system behind your books.</h2>
        </div>
        <div className="resource-grid">
          {[
            [
              "/accounting-principles",
              "01",
              "Accounting principles",
              "How entries, stock costs and report views fit together.",
            ],
            [
              "/help",
              "02",
              "A useful answer, close by",
              "Practical help for your firm, your entries and your records.",
            ],
            [
              "/architecture",
              "03",
              "Under the surface",
              "The boundaries between your app, the API and stored records.",
            ],
          ].map(([href, number, title, text]) => (
            <Link href={href!} key={href} className="resource-link">
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
              <ArrowUpRight size={22} />
            </Link>
          ))}
        </div>
      </section>
      <NextStep />
    </>
  );
}
