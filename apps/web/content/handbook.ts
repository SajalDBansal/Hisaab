export interface ArticleSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface HandbookPage {
  slug: string;
  eyebrow: string;
  title: string;
  description: string;
  sections: ArticleSection[];
  related: string[];
}

// Product behavior follows the implemented workflows, not a service or legal guarantee.
export const handbookPages: HandbookPage[] = [
  {
    slug: "system",
    eyebrow: "The product",
    title: "How Hisaab fits your business",
    description:
      "Understand the path from a business entry to stock, outstanding balances and reports, including what stays outside the system.",
    sections: [
      {
        id: "firms-and-roles",
        title: "Separate books for each firm",
        paragraphs: [
          "A firm brings together its profile, customers, suppliers, items, accounts and entries. Check the active firm before entering a transaction or downloading a report. Membership and permissions belong to that firm; access to one business does not grant access to another.",
          "Owners manage the team. Accountant, sales and viewer roles provide different levels of access. A business associate profile is not a team login.",
        ],
      },
      {
        id: "daily-work",
        title: "Follow the transaction through",
        paragraphs: [
          "Record a purchase, select its stock when billing a customer, then allocate the customer's receipt to the outstanding invoices. Posted entries feed the ledgers and reports. A bill and its payment are separate records, so a sale can remain unpaid or partly paid.",
        ],
        bullets: [
          "Use journals and financing entries for supported account movements.",
          "Use returns and settlement actions for corrections that affect existing bills.",
        ],
      },
      {
        id: "book-categories",
        title: "GST, Non-GST and Mixed views",
        paragraphs: [
          "Purchases can be recorded with or without GST. A sale drawing from both stock categories asks to create two separately numbered invoices. Reports and accounting views offer GST, Non-GST and Mixed selections, with Mixed showing the combined business.",
          "These are bookkeeping categories. They do not decide whether a transaction is legally exempt, establish input-credit eligibility or submit a GST return.",
        ],
      },
      {
        id: "inventory",
        title: "One item, distinct stock lots",
        paragraphs: [
          "The same product can have several purchase lots with different costs and book categories. Keep one item master, then choose the available lot on the sale. Stock counts, damage and landed-cost adjustments have dedicated workflows. This is a single stock register, not a multi-warehouse transfer system.",
        ],
      },
      {
        id: "documents",
        title: "Keep supporting documents with the entry",
        paragraphs: [
          "Attach multiple bill photos or supported documents to an entry. Documents can be found through party, account, date and folder filters. Image previews use separate thumbnails. The financial save and file transfer have separate results: a failed photo upload does not mean the bill must be entered again.",
        ],
      },
      {
        id: "offline-and-recovery",
        title: "Know what is saved and what is pending",
        paragraphs: [
          "Offline books can retain downloaded answers and queue supported entries on the current device. Pending entries are not posted balances or confirmed stock movements. Reconnect with the app open to check access and synchronize; conflicts require review.",
          "Owner-only JSON exports contain book data, not attached image files. Complete recovery also needs separately operated database and document backups. Hisaab's reports support review, not independent verification of the underlying business facts.",
        ],
      },
    ],
    related: ["accounting-principles", "architecture", "security"],
  },
  {
    slug: "architecture",
    eyebrow: "Behind the product",
    title: "How the parts work together",
    description:
      "A public product site, a signed-in accounting application and a separate API, with clear responsibilities for records, files and device storage.",
    sections: [
      {
        id: "product-and-application",
        title: "Product information and accounting are separate",
        paragraphs: [
          "Next.js provides the public product and help surface. Its role is to explain the product and direct people to the accounting application, not query customer databases. Public content is not a place to enter bills or inspect a firm's books.",
          "The signed-in application uses Expo and React Native, including a browser version. That application talks to the accounting API.",
        ],
      },
      {
        id: "api-and-rules",
        title: "One authoritative accounting API",
        paragraphs: [
          "Fastify handles API requests. Shared TypeScript packages define request shapes, permissions and accounting calculations used across the application. The server validates each operation and checks the active user's firm membership; hiding a button in the interface is not the authorization check.",
          "Repeated financial requests carry operation identities so supported retries can recover the original result instead of posting another entry.",
        ],
      },
      {
        id: "business-records",
        title: "PostgreSQL holds the books",
        paragraphs: [
          "Drizzle connects the API to PostgreSQL. Firms, accounts, vouchers, stock lots, allocations, document metadata and audit events live in the database. Related financial changes use transactions so a failed operation does not leave a partially posted bill.",
          "Saved document details and recorded history explain past entries even when a customer's current contact details change.",
        ],
      },
      {
        id: "background-work",
        title: "Queues support background work",
        paragraphs: [
          "Redis supports shared rate limits, caching and BullMQ job queues. Separate workers perform configured tasks such as voucher PDF generation and reminder preparation. A prepared reminder list is not proof that a message was sent. Queue results and caches do not replace the database as the source of financial records.",
        ],
      },
      {
        id: "file-storage",
        title: "Files stay outside the ledger database",
        paragraphs: [
          "Private Cloudflare R2 storage holds confirmed documents and image thumbnails. The API checks access before issuing temporary upload or download links. Document metadata connects each file to the correct firm and entry. Image processing creates smaller stored images and previews; a thumbnail is not a full-resolution archival original.",
        ],
      },
      {
        id: "device-and-recovery",
        title: "Device copies have a limited purpose",
        paragraphs: [
          "Downloaded book answers and pending requests use encrypted device storage. Native keys use Expo SecureStore; the browser uses Web Crypto and IndexedDB. The deployed Expo web application can cache its public application shell after an online visit. This is separate from the Next.js product site.",
          "Device caches, Redis and JSON exports are not complete disaster recovery. Recovery planning must include PostgreSQL and independently recoverable R2 documents, including thumbnails.",
        ],
      },
    ],
    related: ["system", "security", "privacy"],
  },
  {
    slug: "accounting-principles",
    eyebrow: "Understanding your books",
    title: "The accounting behind each entry",
    description:
      "How posted transactions, stock costs, settlements and report dates fit together. These are product rules, not tax filing or professional advice.",
    sections: [
      {
        id: "posted-entries",
        title: "Posting is different from saving a draft",
        paragraphs: [
          "Posted financial entries use balanced debit and credit lines. Drafts, cancelled entries and pending offline requests do not contribute to posted monetary totals. Estimates and orders are not sales revenue; delivery notes can move stock before invoicing.",
          "Amounts are calculated in integer paise. A balanced trial balance is a consistency check, not proof that every transaction is complete or correctly classified.",
        ],
      },
      {
        id: "book-scopes",
        title: "Read the category and date together",
        paragraphs: [
          "GST and Non-GST views separate the recorded categories; Mixed combines them. A receipt settling both categories contributes the appropriate portion to each view, not its full amount twice. Mixed sales create independently numbered and rounded invoices.",
          "Profit and loss covers a period. A balance sheet and ageing report describe the position as at a date. Later receipts do not clear an earlier outstanding balance. Tax reports are book estimates, not GST filings.",
        ],
      },
      {
        id: "stock-cost",
        title: "Keep the purchase cost with the stock",
        paragraphs: [
          "New sales use the selected stock lot's recorded cost and category. Changing an item's default buying price does not revalue past stock. Returns use the original lot and cost. Additional purchase charges are not automatically distributed into stock; use the explicit landed-cost workflow where appropriate.",
          "Legacy sales without lot selections use a compatibility costing calculation, not a reconstruction of the physical units originally sold.",
        ],
      },
      {
        id: "settlements",
        title: "A receipt settles a bill, not another sale",
        paragraphs: [
          "Allocate receipts and payments to the bills they settle. Cash movement, withholding and the amount settled are distinct values. An unallocated advance is not evidence that a particular invoice is paid. Capital introduced and borrowed principal belong to their account groups, not sales income.",
        ],
      },
      {
        id: "loans-and-commissions",
        title: "Separate schedules, accruals and payments",
        paragraphs: [
          "Loan schedules are plans. Interest requires review and explicit confirmation before posting; a due date alone creates no journal. Review existing accruals before paying interest so the expense is not recorded twice.",
          "Commission becomes payable when an eligible sale is posted, on discounted item value excluding GST, freight and round-off. Returns reduce the saved commission. A payout clears the payable rather than recording the expense again. A commission associate is not automatically an equity partner.",
        ],
      },
      {
        id: "history-and-periods",
        title: "Correct the books without hiding their history",
        paragraphs: [
          "Supported edits, cancellations and reversals retain audit history; audit records are not rewritten to hide a correction. Owners review opening balances and close periods. A closed period also blocks backdated offline replay. Reopening requires a recorded reason, and does not itself change amounts.",
          "Financial-year review uses continuous books rather than duplicating opening entries. Reconcile the underlying records before relying on a report.",
        ],
      },
    ],
    related: ["system", "security"],
  },
  {
    slug: "privacy",
    eyebrow: "Product data overview",
    title: "What information Hisaab handles",
    description:
      "A factual guide to application data and storage. This overview is pending owner legal review and is not a finalized privacy policy.",
    sections: [
      {
        id: "about-this-overview",
        title: "Read this as a product explanation",
        paragraphs: [
          "This page describes the current application design, not a promise of legal compliance. The deployment owner still needs to review the legal notice, operator identity, applicable obligations, retention decisions and a process for privacy requests. No retention period, deletion deadline or data-residency guarantee is established here.",
        ],
      },
      {
        id: "account-and-access",
        title: "Account and firm access information",
        paragraphs: [
          "Account records include a name, email address, mobile number, password authentication data and verification state. Sessions also record device and platform details. Firm membership determines access and role. Browser authentication uses a session cookie; native authentication stores its session material through the device's secure storage.",
          "Operational diagnostics can include request, user and firm identifiers alongside routes, status codes and errors.",
        ],
      },
      {
        id: "business-information",
        title: "Information inside the books",
        paragraphs: [
          "Firm profiles, bank details, customer and supplier contacts, invoices, purchases, receipts, loans and associate records can contain personal and financial information. Audit history includes who performed recorded actions. Team members can access records according to their role in that firm, not simply because they have a Hisaab account.",
        ],
      },
      {
        id: "documents-and-sharing",
        title: "Documents and copies you share",
        paragraphs: [
          "Supporting documents and image thumbnails use private Cloudflare R2 storage. Authorized requests receive temporary links. Anyone holding a valid signed link may be able to use it until expiry; keep it private. Downloading or sharing creates copies outside the application's access controls.",
          "Delivery contact details may appear on printed bills when selected for printing. Check documents and recipient details before sharing.",
        ],
      },
      {
        id: "local-storage",
        title: "Copies retained on a device",
        paragraphs: [
          "Downloaded books and pending financial requests use encrypted local storage. Pending attachment bytes use private app or browser storage; this is not a claim that every file is encrypted. Same-origin scripts or a compromised device remain a risk.",
          "Signing out hides access but does not erase pending requests and attachment recovery copies. Clearing storage or uninstalling can destroy unsynchronized work. Review pending work before changing devices.",
        ],
      },
      {
        id: "exports-and-backups",
        title: "Exports are sensitive business records",
        paragraphs: [
          "Owner-only JSON exports include business data, document metadata and historical actors, but exclude login credentials, sessions and image binaries. They are not anonymous files. Store and share them carefully.",
          "Complete backup and recovery also requires database and document copies managed by the deployment operator. This overview does not promise automatic backups or removal of copies already downloaded, shared or retained independently.",
        ],
      },
    ],
    related: ["security", "architecture", "system"],
  },
  {
    slug: "security",
    eyebrow: "Controls and responsibilities",
    title: "Protecting access to your books",
    description:
      "Understand the application's access controls and their limits. Secure deployment, device care and recovery checks remain essential.",
    sections: [
      {
        id: "authentication",
        title: "A verified account and a current session",
        paragraphs: [
          "Email verification is required for password sign-in. Browser sessions use HttpOnly cookies, while native session material uses secure device storage. Password attempts and verification requests have separate limits. A confirmed device takeover replaces an older session on the same platform; one app session and one browser session can coexist.",
          "Use separate accounts for team members rather than sharing a password.",
        ],
      },
      {
        id: "firm-permissions",
        title: "Permissions are checked on the server",
        paragraphs: [
          "The API checks firm membership and the permission required for the requested action. Owners manage team access. Accountants work with books without managing the team; sales staff have narrower billing and receipt access; viewers cannot post changes. Owner-only controls include book recovery and period closing.",
          "An associate profile alone does not grant access to the application.",
        ],
      },
      {
        id: "private-files",
        title: "Private storage, temporary access",
        paragraphs: [
          "Document storage is designed for a private R2 bucket. Upload confirmation validates files before they become available as confirmed documents. Downloads and thumbnails require authorized requests for temporary links. Keep those links private, and remember that a downloaded copy is outside the firm's application permissions.",
          "File-type checks and image processing are not a claim of antivirus scanning.",
        ],
      },
      {
        id: "device-storage",
        title: "Encryption has boundaries",
        paragraphs: [
          "Downloaded books and queued financial requests use AES-GCM encryption. Native keys use device-only secure storage; web keys are non-extractable Web Crypto keys in IndexedDB. This does not protect against a compromised device or malicious code running within the same web origin.",
          "Offline access needs a recently verified identity and membership. Revocation cannot be discovered while fully disconnected; access is checked again before synchronization.",
        ],
      },
      {
        id: "financial-integrity",
        title: "Changes are checked and recorded",
        paragraphs: [
          "Server validation, transaction boundaries, version checks and supported retry identities protect financial saves against conflicting or repeated requests. Closed-period controls also apply to offline submissions. Audit and book-control events retain correction history rather than being rewritten as though an earlier action never happened.",
          "These checks cannot establish that a receipt, invoice or opening balance reflects a genuine business event.",
        ],
      },
      {
        id: "recovery-and-responsibility",
        title: "Backups need an operator and a restore check",
        paragraphs: [
          "JSON book exports exclude image files and do not recover a lost server by themselves. The operator must arrange database and document backups, protect keys, deploy with HTTPS and verify restoration separately. No uptime, certification or guaranteed recovery time is claimed here.",
          "Before clearing app or browser data, review pending entries and uploads. Device caches are working copies, not an independent backup.",
        ],
      },
    ],
    related: ["privacy", "architecture", "accounting-principles"],
  },
];
