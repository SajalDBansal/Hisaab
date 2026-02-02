import { InvoiceList } from "@/lists/InvoiceList";

/** All sales invoices with status filters. */
export default function SalesScreen() {
  return <InvoiceList kind="sale" />;
}
