import Link from "next/link";
import { ArrowUpRight, Database, Files, Monitor, Server } from "lucide-react";
import { handbookPages, type HandbookPage } from "@/content/handbook";
import { PageHeading } from "./page-heading";

function ArchitectureFlow() {
  return (
    <div className="architecture-flow" aria-label="Application architecture">
      {[
        {
          Icon: Monitor,
          name: "Accounting app",
          detail: "Expo / React Native",
        },
        {
          Icon: Server,
          name: "Accounting API",
          detail: "Fastify / shared rules",
        },
        {
          Icon: Database,
          name: "Business records",
          detail: "PostgreSQL / Drizzle",
        },
        { Icon: Files, name: "Private documents", detail: "Cloudflare R2" },
      ].map(({ Icon, name, detail }) => (
        <div key={name}>
          <Icon size={24} strokeWidth={1.5} />
          <strong>{name}</strong>
          <span>{detail}</span>
        </div>
      ))}
    </div>
  );
}

export function ArticlePage({ page }: { page: HandbookPage }) {
  const related = handbookPages.filter((item) =>
    page.related.includes(item.slug),
  );
  return (
    <div className="container article-container">
      <PageHeading
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
      />
      {page.slug === "architecture" && <ArchitectureFlow />}
      <div className="article-layout">
        <aside className="article-sidebar">
          <nav aria-label="On this page">
            <p className="eyebrow">On this page</p>
            {page.sections.map((section, index) => (
              <a href={`#${section.id}`} key={section.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {section.title}
              </a>
            ))}
          </nav>
        </aside>
        <article className="article-body">
          {page.sections.map((section) => (
            <section id={section.id} key={section.id}>
              <h2>{section.title}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets && (
                <ul>
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <div className="article-related">
            <p className="eyebrow">Continue exploring</p>
            {related.map((item) => (
              <Link
                className="text-link"
                href={`/${item.slug}`}
                key={item.slug}
              >
                {item.title}
                <ArrowUpRight size={18} />
              </Link>
            ))}
            <Link className="text-link" href="/help">
              Find a practical answer <ArrowUpRight size={18} />
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
}
