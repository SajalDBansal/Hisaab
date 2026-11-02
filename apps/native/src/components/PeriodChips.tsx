import type { PeriodKey } from "@repo/core";
import { Chip, ChipRow } from "./Chip";
import { REPORT_PERIODS } from "@/data/reportPeriods";

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
      {REPORT_PERIODS.map((p) => (
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
