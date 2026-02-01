import type { BookScope } from "@repo/core";
import { useState } from "react";
import { useGstMode } from "@/data/gstMode";
import { Segmented } from "./Chip";

export function useBookScope() {
  const gst = useGstMode();
  const [selection, setSelection] = useState<BookScope>();
  return [
    selection ?? (gst.mode === "off" ? "nongst" : "gst"),
    setSelection,
  ] as const;
}

/** Manual entries carry a category even when no goods are involved. */
export function BookScopeField({
  value,
  onChange,
}: {
  value: BookScope;
  onChange: (value: BookScope) => void;
}) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        { value: "gst", label: "GST books" },
        { value: "nongst", label: "Non-GST books" },
      ]}
    />
  );
}
