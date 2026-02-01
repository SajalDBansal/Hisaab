import type { TaxScope } from "@repo/core";
import { Segmented } from "./Chip";
import { useReportScope } from "@/data/reportScope";

/** One shared bookkeeping category across reports and their account drilldowns. */
export function TaxScopeFilter({
  value,
  onChange,
}: {
  value?: TaxScope;
  onChange?: (scope: TaxScope) => void;
} = {}) {
  const [scope, setScope] = useReportScope();
  return (
    <Segmented
      value={value ?? scope}
      onChange={onChange ?? setScope}
      options={[
        { value: "all", label: "Mixed" },
        { value: "gst", label: "GST" },
        { value: "nongst", label: "Non-GST" },
      ]}
    />
  );
}
