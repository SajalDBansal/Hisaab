/**
 * Units of measure. Each unit maps to a GST "UQC" (unit quantity code),
 * which GSTR-1's HSN summary needs.
 */
import type { UnitDef } from "./types";

/** GST unit quantity codes the portal accepts. */
export const UQC_CODES: { code: string; label: string }[] = [
  { code: "NOS", label: "Numbers" },
  { code: "PCS", label: "Pieces" },
  { code: "KGS", label: "Kilograms" },
  { code: "GMS", label: "Grams" },
  { code: "QTL", label: "Quintal" },
  { code: "TON", label: "Tonnes" },
  { code: "MTS", label: "Metric ton" },
  { code: "LTR", label: "Litres" },
  { code: "MLT", label: "Millilitre" },
  { code: "KLR", label: "Kilolitre" },
  { code: "MTR", label: "Metres" },
  { code: "KME", label: "Kilometre" },
  { code: "SQF", label: "Square feet" },
  { code: "SQM", label: "Square metres" },
  { code: "BOX", label: "Box" },
  { code: "PAC", label: "Packs" },
  { code: "BAG", label: "Bags" },
  { code: "BTL", label: "Bottles" },
  { code: "CAN", label: "Cans" },
  { code: "CTN", label: "Cartons" },
  { code: "BDL", label: "Bundles" },
  { code: "ROL", label: "Rolls" },
  { code: "DOZ", label: "Dozens" },
  { code: "PRS", label: "Pairs" },
  { code: "SET", label: "Sets" },
  { code: "TBS", label: "Tablets" },
  { code: "UNT", label: "Units" },
  { code: "OTH", label: "Others" },
];

const unit = (name: string, uqc: string, enabled: boolean): UnitDef => ({
  name,
  uqc,
  enabled,
  builtIn: true,
});

/** Units every new firm starts with. The common ones are switched on. */
export const DEFAULT_UNITS: UnitDef[] = [
  unit("Nos", "NOS", true),
  unit("Pcs", "PCS", true),
  unit("Kg", "KGS", true),
  unit("Ltr", "LTR", true),
  unit("Mtr", "MTR", true),
  unit("Box", "BOX", true),
  unit("Pack", "PAC", true),
  unit("Dozen", "DOZ", true),
  unit("Gm", "GMS", false),
  unit("Ml", "MLT", false),
  unit("Bag", "BAG", false),
  unit("Bottle", "BTL", false),
  unit("Carton", "CTN", false),
  unit("Pair", "PRS", false),
  unit("Set", "SET", false),
  unit("Quintal", "QTL", false),
  unit("Ton", "TON", false),
  unit("Sq ft", "SQF", false),
];

/** GST code for a unit name; "OTH" if the unit isn't known. */
export function uqcFor(
  unitName: string,
  units: UnitDef[] = DEFAULT_UNITS,
): string {
  return (
    units.find((u) => u.name.toLowerCase() === unitName.toLowerCase())?.uqc ??
    "OTH"
  );
}

/** New unit form. Returns the first problem, or null. */
export function checkUnit(
  input: { name: string; uqc: string },
  units: UnitDef[],
): string | null {
  const name = input.name.trim();
  if (!name) return "Enter a unit name, e.g. Tray.";
  if (name.length > 12) return "Keep the unit name short (12 letters or less).";
  if (!/^[A-Za-z][A-Za-z .]*$/.test(name))
    return "Use letters only, e.g. Tray or Sq ft.";
  if (units.some((u) => u.name.toLowerCase() === name.toLowerCase()))
    return `${name} is already in the list.`;
  if (!UQC_CODES.some((c) => c.code === input.uqc))
    return "Pick a GST unit code.";
  return null;
}
