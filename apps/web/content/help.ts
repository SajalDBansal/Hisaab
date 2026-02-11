export interface HelpArticle {
  id: string;
  category: string;
  question: string;
  answer: string[];
  href?: string;
  linkLabel?: string;
}

export const helpArticles: HelpArticle[] = [
  {
    id: "first-firm",
    category: "Getting started",
    question: "What should I set up in my first firm?",
    answer: [
      "Create or select the firm, then review its profile, GST registration setting, books-start date, financial year, invoice numbering and units. Check the active firm before entering business data.",
      "Add customers, suppliers, items and cash or bank accounts. Review opening balances against your previous books before approving them in Book controls. Begin with a purchase, sale and allocated receipt, then compare the stock and outstanding reports.",
    ],
    href: "/system#firms-and-roles",
    linkLabel: "Understand firms and roles",
  },
  {
    id: "parties-and-accounts",
    category: "Getting started",
    question: "Should I create a party, an account or an associate?",
    answer: [
      "Use customer and supplier parties for trading relationships and bill settlement. Use appropriately grouped accounts for capital, loans and other ledger balances. Cash and bank ledgers represent where money is held.",
      "Use a Business Associate for delivery, referral or commission activity. An associate can link to trading parties, but is not automatically an equity partner or a person authorized to log in.",
    ],
    href: "/accounting-principles#settlements",
    linkLabel: "Understand accounts and settlements",
  },
  {
    id: "stock-lots",
    category: "Inventory and billing",
    question: "How do I keep different purchase rates for the same item?",
    answer: [
      "Keep one item master. Each purchase line creates a stock lot carrying its quantity, cost and GST or Non-GST category. Opening stock can also have distinct lots.",
      "In a sale, select the stock lot to use. Add another line when selling from another lot of the same item. Updating the default purchase price does not change the historical cost of those lots.",
    ],
    href: "/accounting-principles#stock-cost",
    linkLabel: "Read about stock costing",
  },
  {
    id: "purchase-without-gst",
    category: "Inventory and billing",
    question: "How do I record a purchase without GST?",
    answer: [
      "Select Purchase without GST in the purchase form, then check the supplier, date, quantities and rates before saving. The resulting stock lot belongs to the Non-GST category and the entry carries no GST.",
      "The category describes how the purchase is recorded. It does not establish legal exemption or determine tax obligations. A saved bill keeps its category; changing it requires the supported cancellation and recreation workflow, subject to stock and settlement checks.",
    ],
    href: "/system#book-categories",
    linkLabel: "Understand book categories",
  },
  {
    id: "mixed-sale",
    category: "Inventory and billing",
    question: "Why does a sale ask to create two invoices?",
    answer: [
      "Selected GST and Non-GST stock cannot be combined into one category's invoice. Confirming the split creates two separately numbered invoices together. Each can then be printed, settled or returned independently.",
      "Each invoice is rounded separately. Payment received now settles the GST bill first, then the Non-GST bill. Extra charges on the mixed form go to its GST invoice; use separate sale forms when you need a different distribution.",
    ],
    href: "/accounting-principles#book-scopes",
    linkLabel: "Understand split bills and report scopes",
  },
  {
    id: "receipt-allocation",
    category: "Payments and corrections",
    question: "Why is a bill still outstanding after I receive money?",
    answer: [
      "Check that the receipt is posted, belongs to the correct customer and allocates the amount to that bill. An unallocated advance or a pending offline receipt does not settle a specific invoice.",
      "Check the report's date too: a receipt posted later does not clear an earlier as-at balance. Review the invoice's allocations before creating another receipt, especially after a connection failure.",
    ],
    href: "/accounting-principles#settlements",
    linkLabel: "Read about bill settlement",
  },
  {
    id: "returns-and-corrections",
    category: "Payments and corrections",
    question: "How should I handle a return or an incorrect entry?",
    answer: [
      "Use the relevant return linked to the original sale or purchase so quantity, stock cost and settlement checks can use that bill. Use supported edit, cancellation or reversal actions for other corrections; do not create an unrelated opposite bill just to hide the mistake.",
      "Dependent settlements, later stock use or closed periods may block a correction. Resolve the displayed dependency or ask the owner to review the period. The edit log retains the recorded history.",
    ],
    href: "/accounting-principles#history-and-periods",
    linkLabel: "Understand correction history",
  },
  {
    id: "loans-and-interest",
    category: "Accounts and associates",
    question: "How do I record a loan and its interest?",
    answer: [
      "Create a suitable dedicated loan account, then use the Loan register to record the direction, terms and schedule. A loan registration or scheduled amount does not itself post a principal movement or interest charge. Record actual movements using the appropriate financing workflow.",
      "Interest must be reviewed and explicitly confirmed before posting. Check whether interest was already accrued before recording its payment, and keep planned installments separate from actual ledger balances and linked repayment journals.",
    ],
    href: "/accounting-principles#loans-and-commissions",
    linkLabel: "Understand loans and interest",
  },
  {
    id: "delivery-and-commission",
    category: "Accounts and associates",
    question: "Can I track delivery people and commission partners?",
    answer: [
      "Create a Business Associate with the relevant delivery, referral or commission role. Select the associate on supported sale or delivery forms. Saved delivery details can appear on the bill; private commission details are not printed there.",
      "Eligible commission becomes payable when the sale is posted, based on discounted item value before GST and freight. Returns reduce the original commission. Use the payout workflow to clear commission payable without recording the expense twice.",
    ],
    href: "/accounting-principles#loans-and-commissions",
    linkLabel: "Read the commission calculation rules",
  },
  {
    id: "report-categories",
    category: "Reports and controls",
    question: "Which report category and dates should I choose?",
    answer: [
      "Choose GST or Non-GST for that category, or Mixed for the combined books. Keep the same category and date scope when comparing reports. Receipts allocated across categories are apportioned rather than counted in full in both.",
      "Profit and loss measures a period; the balance sheet and ageing show a position as at a date. These reports summarize entered books. GST summaries do not file returns or establish input-credit eligibility.",
    ],
    href: "/accounting-principles#book-scopes",
    linkLabel: "Read about report boundaries",
  },
  {
    id: "download-reports",
    category: "Reports and controls",
    question: "Where can I download accounting reports?",
    answer: [
      "Open Settings, then Download reports, or use the download action in Accounting. Select the report, dates, book category and any relevant account or party, then preview it before exporting.",
      "PDF and CSV options cover financial statements, daybook, journals, ledgers, cash and bank books, sales, purchases and other registers. Downloads use committed books, not pending offline entries. Large selections may require a narrower date range or CSV instead of PDF.",
    ],
    href: "/accounting-principles#posted-entries",
    linkLabel: "Understand posted report totals",
  },
  {
    id: "closed-period",
    category: "Reports and controls",
    question: "Why can I not edit an entry in a closed period?",
    answer: [
      "Period closing protects entries through the selected date, including backdated entries waiting to synchronize. Changing the entry date is not a way to bypass the lock.",
      "The owner can review the reason for a correction and reopen the relevant period in Book controls. After correcting and reconciling the books, close it again. Financial-year review continues the existing books; it does not create duplicate opening journals.",
    ],
    href: "/accounting-principles#history-and-periods",
    linkLabel: "Read about period controls",
  },
  {
    id: "backup-contents",
    category: "Backup and recovery",
    question: "Does a JSON book export include my bill photos?",
    answer: [
      "No. The owner's Backup and sync export includes supported business records, history and document metadata, but not image or PDF binaries. It also excludes authentication credentials, sessions and team memberships.",
      "The file remains sensitive financial data. A complete recovery plan needs separate database backups and independent document copies, including thumbnails. A download or device cache is not evidence that a complete backup has been verified.",
    ],
    href: "/privacy#exports-and-backups",
    linkLabel: "Understand exports and backups",
  },
  {
    id: "restore-books",
    category: "Backup and recovery",
    question: "What happens when I restore a book export?",
    answer: [
      "The current owner can inspect a supported export, review recovery and confirm creation of a new firm. This does not replace the original firm's books. Document metadata is retained, but missing files are not recovered from JSON.",
      "Recovery requires the original server, firm and the owner's authenticated access to remain available. Possessing the file alone cannot recover a lost server. Review recovered balances, team access and documents before using the new firm.",
    ],
    href: "/security#recovery-and-responsibility",
    linkLabel: "Read the recovery boundaries",
  },
  {
    id: "offline-work",
    category: "Offline and documents",
    question: "What can I do when the internet is unavailable?",
    answer: [
      "Download books while online and authorized. Supported cached views and entries can then work within the current offline access grant. A date range or filter that was not downloaded may be unavailable. Offline saves remain pending until accepted by the server.",
      "Authentication, team changes, file transfers, imports, exports and other online-only actions are not unlimited offline operations. The deployed browser application needs an initial online shell download; its development server does not provide offline cold starts. Keep the app open after reconnecting to synchronize.",
    ],
    href: "/system#offline-and-recovery",
    linkLabel: "Understand offline boundaries",
  },
  {
    id: "pending-entry",
    category: "Offline and documents",
    question: "What should I do with a pending or conflicted entry?",
    answer: [
      "Open Offline books under the same account, firm and role that created the request. Reconnect and let the app check access and resolve the original operation. A conflict stops later queued entries so the dependency can be reviewed.",
      "Use the displayed result lookup, review or cancellation action instead of re-entering the transaction. An unknown result may already be posted on the server. Do not clear storage or uninstall while unresolved work remains.",
    ],
    href: "/system#offline-and-recovery",
    linkLabel: "Understand pending and posted work",
  },
  {
    id: "attach-images",
    category: "Offline and documents",
    question: "Can I attach more than one photo to an entry?",
    answer: [
      "Yes. Supported entry forms allow multiple attachments from the camera, gallery or file picker, subject to file limits and device permissions. Photos are compressed, and confirmed images have separate stored thumbnails for previews.",
      "Open Documents to search and filter by party, account, dates or folders, then view, download or share a confirmed file. Keep original source documents separately when you need their original quality; a processed attachment is not a promise of an untouched archival copy.",
    ],
    href: "/system#documents",
    linkLabel: "Read about entry documents",
  },
  {
    id: "pending-uploads",
    category: "Offline and documents",
    question: "The bill saved but its photos did not upload. What next?",
    answer: [
      "Open Pending uploads in Settings or the saved entry's Documents section. Retry the retained files after reconnecting. File retry does not create another financial entry. An unresolved financial save must first be recovered using its original request.",
      "Pending copies are scoped to the original account and firm and can survive an app restart. Sign-out does not erase them. Missing or corrupt local copies may need separate recovery; deleting browser data or uninstalling can make recovery impossible.",
    ],
    href: "/privacy#local-storage",
    linkLabel: "Understand local recovery copies",
  },
  {
    id: "change-login-device",
    category: "Access and team",
    question: "How do I move my login to another device?",
    answer: [
      "Sign in on the new device. If an older session on the same platform is active, review the device shown and choose Log in here to replace it. The account supports one app session and one browser session together; takeover replaces the older session on that platform.",
      "Resolve pending entries and uploads on the original device first where possible: they do not move with the login. If sign-in reports a storage, cookie or rate-limit error, address that message rather than repeatedly submitting. Do not share passwords or verification codes.",
    ],
    href: "/security#authentication",
    linkLabel: "Understand sessions and device changes",
  },
  {
    id: "team-permissions",
    category: "Access and team",
    question: "Why can a colleague not see or change the same records?",
    answer: [
      "Check their active firm and assigned role in Team and roles. Owners manage access; accountants work with the books; sales staff have narrower billing and receipt permissions; viewers can read permitted reports but cannot post entries. Some actions, including recovery and period closing, remain owner-only.",
      "Ask the owner to review access instead of sharing an account. A delivery or commission profile does not create a login. Reconnect after access changes so the application can verify the current permissions.",
    ],
    href: "/security#firm-permissions",
    linkLabel: "Read about firm permissions",
  },
];
