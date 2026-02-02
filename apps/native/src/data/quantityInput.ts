// Keep the decimal point while limiting quantities to the database's three decimals.
export function quantityInput(value: string) {
  const [whole = "", ...parts] = value.replace(/[^0-9.]/g, "").split(".");
  return whole + (parts.length ? `.${parts.join("").slice(0, 3)}` : "");
}
