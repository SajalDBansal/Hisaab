"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Search, X } from "lucide-react";
import { helpArticles } from "@/content/help";

const categories = [
  "All topics",
  ...new Set(helpArticles.map((item) => item.category)),
];

export function HelpBrowser() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All topics");
  useEffect(() => {
    let frame = 0;
    const openLinkedAnswer = () => {
      const id = window.location.hash.slice(1);
      if (!helpArticles.some((item) => item.id === id)) return;
      setQuery("");
      setCategory("All topics");
      // Deep links open the answer as well as scrolling to its question.
      frame = requestAnimationFrame(() => {
        const answer = document.getElementById(id);
        if (answer instanceof HTMLDetailsElement) {
          answer.open = true;
          answer.scrollIntoView();
        }
      });
    };
    openLinkedAnswer();
    window.addEventListener("hashchange", openLinkedAnswer);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", openLinkedAnswer);
    };
  }, []);
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const results = helpArticles.filter(
    (item) =>
      (category === "All topics" || item.category === category) &&
      words.every((word) =>
        `${item.question} ${item.answer.join(" ")} ${item.category}`
          .toLowerCase()
          .includes(word),
      ),
  );

  return (
    <section className="help-browser" aria-label="Help topics">
      <div className="search-field help-search">
        <Search size={20} aria-hidden="true" />
        <input
          type="search"
          aria-label="Search help"
          placeholder="Search bills, stock, reports..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            className="icon-button"
            aria-label="Clear help search"
            title="Clear search"
            onClick={() => setQuery("")}
          >
            <X size={18} />
          </button>
        )}
      </div>
      <div className="help-layout">
        <nav className="help-categories" aria-label="Help categories">
          {categories.map((value) => (
            <button
              key={value}
              onClick={() => setCategory(value)}
              aria-pressed={category === value}
            >
              {value}
            </button>
          ))}
        </nav>
        <div>
          <p className="result-count" role="status">
            {results.length} {results.length === 1 ? "answer" : "answers"}
          </p>
          <div className="faq-list">
            {results.map((item) => (
              <details key={item.id} id={item.id}>
                <summary>
                  <span>{item.question}</span>
                  <ChevronDown size={20} aria-hidden="true" />
                </summary>
                <div className="faq-answer">
                  <p className="eyebrow">{item.category}</p>
                  {item.answer.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {item.href && (
                    <Link className="text-link" href={item.href}>
                      {item.linkLabel}
                      <ArrowUpRight size={16} />
                    </Link>
                  )}
                </div>
              </details>
            ))}
          </div>
          {!results.length && (
            <div className="empty-state">
              <h2>No matching answers</h2>
              <p>Try a different word or look through all topics.</p>
              <button
                className="button button-light"
                onClick={() => {
                  setQuery("");
                  setCategory("All topics");
                }}
              >
                Reset filters
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
