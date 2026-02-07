export interface PrintableDelivery {
  name: string;
  vehicle: string;
  reference: string;
  printPhone: boolean;
  phone?: string;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

/** Render only the issued public delivery snapshot, never a current profile or commission. */
export function associateDeliveryHtml(delivery?: PrintableDelivery): string {
  if (!delivery) return "";
  const details = [
    delivery.name,
    delivery.vehicle,
    delivery.printPhone ? delivery.phone : undefined,
    delivery.reference,
  ]
    .filter((v): v is string => !!v)
    .map(escape);
  return `<div class="delivery-details"><strong>Delivery</strong>: ${details.join(" | ")}</div>`;
}
