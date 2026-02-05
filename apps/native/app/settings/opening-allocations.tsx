import { useState } from "react";
import { View } from "react-native";
import { formatINR, parseRupees } from "@repo/core";
import type { OpeningAllocationView } from "@repo/contracts";
import {
  AmountField,
  Button,
  Header,
  Notice,
  QueryView,
  Screen,
  TextField,
  Txt,
  showError,
} from "@/components";
import {
  useAllocateOpenings,
  useOpeningAllocations,
} from "@/data/bookReviewQueries";
import { confirmAction } from "@/data/confirm";
import { space, colors } from "@/theme";

export default function OpeningAllocationsScreen() {
  const query = useOpeningAllocations();
  return (
    <Screen
      header={<Header title="Opening allocations" />}
      onRefresh={() => query.refetch()}
      refreshing={query.isRefetching}
    >
      <QueryView query={query}>
        {(view) => (
          <AllocationEditor
            key={`${view.version}:${view.digest}`}
            view={view}
          />
        )}
      </QueryView>
    </Screen>
  );
}

function AllocationEditor({ view }: { view: OpeningAllocationView }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const update = useAllocateOpenings();
  const row = view.rows.find((r) => `${r.kind}:${r.key}` === selected);
  const magnitude = parseRupees(amount) ?? 0;
  const gst = magnitude * (row && row.total < 0 ? -1 : 1);
  const valid =
    !!row &&
    /^\d+(\.\d{1,2})?$/.test(amount) &&
    Number.isSafeInteger(magnitude) &&
    magnitude <= Math.abs(row.total);
  const save = async (reset: boolean) => {
    if (!row) return;
    try {
      await update.mutateAsync({
        version: view.version,
        digest: view.digest,
        reason,
        kind: row.kind,
        key: row.key,
        gst: reset ? null : gst,
      });
    } catch (error) {
      showError("Couldn't allocate opening", error);
    }
  };
  return (
    <>
      {!view.canEdit ? (
        <Notice
          tone="warn"
          text="Only the owner can change allocations, with opening balances and all periods reopened."
        />
      ) : null}
      <TextField label="Find account" value={search} onChangeText={setSearch} />
      {!view.rows.length ? (
        <Txt variant="small">No opening balances.</Txt>
      ) : null}
      {view.rows
        .filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
        .map((r) => (
          <View
            key={`${r.kind}:${r.key}`}
            style={{
              gap: space.sm,
              paddingVertical: space.md,
              borderBottomWidth: 1,
              borderBottomColor: colors.hairline,
            }}
          >
            <Txt variant="bodyStrong">{r.name}</Txt>
            <Txt variant="small">
              {r.kind} / {r.total < 0 ? "Cr" : "Dr"}{" "}
              {formatINR(Math.abs(r.total))}
            </Txt>
            <Txt variant="small">
              GST {formatINR(Math.abs(r.gst))} / Non-GST{" "}
              {formatINR(Math.abs(r.total - r.gst))}
            </Txt>
            {view.canEdit ? (
              <Button
                label="Allocate"
                icon="edit-3"
                onPress={() => {
                  setSelected(`${r.kind}:${r.key}`);
                  setAmount((Math.abs(r.gst) / 100).toFixed(2));
                }}
              />
            ) : null}
            {selected === `${r.kind}:${r.key}` ? (
              <>
                <AmountField
                  label={`GST opening (${r.total < 0 ? "Cr" : "Dr"})`}
                  value={amount}
                  onChangeText={setAmount}
                />
                <Txt variant="small">
                  Non-GST {valid ? formatINR(Math.abs(r.total - gst)) : "-"}
                </Txt>
                <TextField
                  label="Reason"
                  value={reason}
                  onChangeText={setReason}
                  maxLength={500}
                />
                <Button
                  label="Save allocation"
                  icon="check"
                  disabled={
                    !valid || reason.trim().length < 10 || update.isPending
                  }
                  onPress={() =>
                    confirmAction(
                      "Save opening allocation?",
                      "Past GST and non-GST statements will reflect this allocation. The combined opening balance stays unchanged.",
                      "Save",
                      () => save(false),
                    )
                  }
                />
                <Button
                  label="Restore default book"
                  icon="rotate-ccw"
                  disabled={
                    !r.explicit || reason.trim().length < 10 || update.isPending
                  }
                  onPress={() =>
                    confirmAction(
                      "Restore default allocation?",
                      "This opening balance will belong to the firm's default book again.",
                      "Restore",
                      () => save(true),
                    )
                  }
                />
              </>
            ) : null}
          </View>
        ))}
    </>
  );
}
