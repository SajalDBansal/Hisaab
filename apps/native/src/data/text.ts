const singular: Record<string, string> = {
  "{n} customers · {m} overdue": "{n} customer · {m} overdue",
  "{n} suppliers": "{n} supplier",
  "{n} invoices": "{n} invoice",
  "{n} items": "{n} item",
  "{amount} overdue · {n} days": "{amount} overdue · {n} day",
  "{n} days": "{n} day",
};

// Fill English count labels without a language preference or translation lookup.
export function formatText(
  text: string,
  values: Record<string, string | number>,
) {
  const template = values.n === 1 ? (singular[text] ?? text) : text;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}
