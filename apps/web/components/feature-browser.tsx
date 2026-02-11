"use client";

import { useState } from "react";
import {
  BookOpen,
  ChartNoAxesCombined,
  Files,
  NotebookPen,
  Package,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  Users,
  X,
} from "lucide-react";
import {
  featureCategories,
  matchingFeatures,
  type FeatureCategory,
} from "@/content/features";

const icons = {
  books: BookOpen,
  chart: ChartNoAxesCombined,
  files: Files,
  journal: NotebookPen,
  stock: Package,
  receipt: Receipt,
  sync: RefreshCw,
  shield: ShieldCheck,
  truck: Truck,
  people: Users,
};

export function FeatureBrowser() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FeatureCategory>("All features");
  const rows = matchingFeatures(query, category);
  return (
    <section className="feature-browser" aria-label="Explore features">
      <div className="filter-bar">
        <div className="filter-options" aria-label="Feature categories">
          {featureCategories.map((value) => (
            <button
              key={value}
              className="filter-option"
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search features"
            placeholder="Find a feature"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="icon-button"
              aria-label="Clear feature search"
              title="Clear search"
              onClick={() => setQuery("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <p className="result-count" role="status">
        {rows.length} {rows.length === 1 ? "feature" : "features"}
      </p>
      {rows.length ? (
        <div className="feature-grid">
          {rows.map((feature) => {
            const Icon = icons[feature.icon];
            return (
              <article
                className="feature-item"
                key={feature.id}
                id={feature.id}
              >
                <Icon size={26} strokeWidth={1.5} aria-hidden="true" />
                <div>
                  <p className="eyebrow">{feature.category}</p>
                  <h2>{feature.title}</h2>
                  <p>{feature.description}</p>
                  <p className="feature-detail">{feature.detail}</p>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <h2>No matching features</h2>
          <p>Try a different word or category.</p>
          <button
            className="button button-light"
            onClick={() => {
              setQuery("");
              setCategory("All features");
            }}
          >
            Reset filters
          </button>
        </div>
      )}
    </section>
  );
}
