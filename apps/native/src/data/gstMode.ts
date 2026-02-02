/**
 * The open firm's GST mode, for screens:
 *   const gst = useGstMode();
 *   gst.on        → show GST at all (rates, HSN, GSTIN)  — false when GST is switched off
 *   gst.regular   → GST returns (GSTR-1/3B), tax invoices, input tax
 *   gst.composition → bills of supply, CMP-08
 */
import { gstModeOf, type GstMode } from "@repo/core";
import { useFirm } from "./queries";

export function useGstMode() {
  const firm = useFirm();
  const mode: GstMode = firm.data ? gstModeOf(firm.data) : "regular";
  return {
    mode,
    on: mode !== "off",
    regular: mode === "regular",
    composition: mode === "composition",
    off: mode === "off",
    loaded: !!firm.data,
  };
}
