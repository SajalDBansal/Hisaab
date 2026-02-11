export const featureCategories = [
  "All features",
  "Trading",
  "Inventory",
  "Accounting",
  "People & records",
] as const;
export type FeatureCategory = (typeof featureCategories)[number];
export const features = [
  {
    id: "sales",
    category: "Trading",
    icon: "receipt",
    title: "From a sale to a settled bill",
    description:
      "Create sales and purchase bills, record receipts and payments, and see what is still outstanding. Returns and corrections stay connected to the original entry.",
    detail: "Sales · Purchases · Receipts · Returns",
  },
  {
    id: "books",
    category: "Accounting",
    icon: "books",
    title: "Three views. One business.",
    description:
      "Read your GST, non-GST and mixed books separately. Stock from different tax categories stays identifiable, with separate bills when a sale includes both.",
    detail: "GST · Non-GST · Mixed reports",
  },
  {
    id: "stock",
    category: "Inventory",
    icon: "stock",
    title: "Know which stock you are selling",
    description:
      "Keep one item with multiple purchase lots, costs and tax categories. Choose the stock lot when selling and follow quantity, returns and historical cost.",
    detail: "Stock lots · Cost history · Stock counts",
  },
  {
    id: "orders",
    category: "Trading",
    icon: "truck",
    title: "Keep the next delivery in sight",
    description:
      "Move from estimates and orders to deliveries and invoices. Follow remaining quantities and partial fulfillment without counting the same stock twice.",
    detail: "Estimates · Orders · Challans",
  },
  {
    id: "reports",
    category: "Accounting",
    icon: "chart",
    title: "A clearer close to the day",
    description:
      "Review the day book, trial balance, balance sheet, profit and loss, cash and bank books. Select the dates and book view, then export the report.",
    detail: "Financial statements · Ledgers · Exports",
  },
  {
    id: "journals",
    category: "Accounting",
    icon: "journal",
    title: "Accounts beyond sales and purchases",
    description:
      "Create capital, loan and other ledger accounts. Post balanced journals, record transfers, and review calculated loan interest before posting it.",
    detail: "Journals · Capital · Loans · Interest",
  },
  {
    id: "partners",
    category: "People & records",
    icon: "people",
    title: "The people behind every transaction",
    description:
      "Keep customers, suppliers, delivery associates and commission partners connected to their work. Follow statements, delivery details and partner payouts.",
    detail: "Parties · Delivery profiles · Commissions",
  },
  {
    id: "documents",
    category: "People & records",
    icon: "files",
    title: "The bill and its proof, together",
    description:
      "Attach multiple compressed photos to an entry. Find documents by party, ledger, date or folder, with smaller thumbnails for browsing.",
    detail: "Camera & gallery · Folders · Private documents",
  },
  {
    id: "offline",
    category: "People & records",
    icon: "sync",
    title: "Room for an interrupted connection",
    description:
      "Use previously downloaded records and queue supported entries while offline. Review pending work and reconnect to sync, without silently posting a duplicate.",
    detail: "Encrypted local records · Pending work · Reconnect",
  },
  {
    id: "controls",
    category: "Accounting",
    icon: "shield",
    title: "Keep responsibility visible",
    description:
      "Separate firms, assign team roles, review changes and protect closed periods. Corrections retain a history instead of quietly rewriting issued records.",
    detail: "Roles · Audit history · Period controls",
  },
] as const;

export function matchingFeatures(query: string, category: FeatureCategory) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return features.filter(
    (feature) =>
      (category === "All features" || feature.category === category) &&
      words.every((word) =>
        `${feature.title} ${feature.description} ${feature.detail}`
          .toLowerCase()
          .includes(word),
      ),
  );
}
