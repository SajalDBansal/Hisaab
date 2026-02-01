import type { PeriodKey } from "@repo/core";
import { Chip, ChipRow } from "./Chip";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "quarter", label: "Last 3 months" },
  { key: "fy", label: "This FY" },
];

/** Period filter used on report screens. */
export function PeriodChips({
  value,
  onChange,
}: {
  value: PeriodKey;
  onChange: (p: PeriodKey) => void;
}) {
  return (
    <ChipRow>
      {PERIODS.map((p) => (
        <Chip
          key={p.key}
          label={p.label}
          selected={value === p.key}
          onPress={() => onChange(p.key)}
        />
      ))}
    </ChipRow>
  );
}
