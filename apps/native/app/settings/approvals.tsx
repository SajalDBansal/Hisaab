import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import type { ApprovalSettingsView, ApprovalType } from "@repo/contracts";
import { APPROVAL_TYPES, can } from "@repo/core";
import {
  Button,
  Card,
  Checkbox,
  Header,
  QueryView,
  Screen,
  Txt,
  showError,
  showToast,
} from "@/components";
import { useData } from "@/data/DataProvider";
import { useApprovalSettings, useSaveApprovals } from "@/data/recurringHooks";
import { space } from "@/theme";

const NOTE: Record<ApprovalType, string> = {
  receipt: "Money received from customers",
  payment: "Money paid to suppliers",
  contra: "Cash deposits, withdrawals and transfers",
  expense: "Expenses paid",
  journal: "Journal entries",
};
const LABEL: Record<ApprovalType, string> = {
  receipt: "Receipts",
  payment: "Payments",
  contra: "Contra",
  expense: "Expenses",
  journal: "Journals",
};

/** Approvals (doc 37, T06): which entry types wait for the owner's approval. */
export default function ApprovalsScreen() {
  const saved = useApprovalSettings();
  return (
    <Screen
      header={
        <Header title="Approvals" subtitle="Entries that need approval" />
      }
    >
      <QueryView query={saved}>{(s) => <Form saved={s} />}</QueryView>
    </Screen>
  );
}

function Form({ saved }: { saved: ApprovalSettingsView }) {
  const { role } = useData();
  const canEdit = !!role && can(role, "team");
  const save = useSaveApprovals();
  const [types, setTypes] = useState<ApprovalType[]>(saved.types);
  useEffect(() => setTypes(saved.types), [saved.types]);
  const changed =
    types.length !== saved.types.length ||
    types.some((t) => !saved.types.includes(t));
  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <View style={{ gap: space.md }}>
          <Txt variant="heading">Need approval</Txt>
          {APPROVAL_TYPES.map((type) => (
            <Checkbox
              key={type}
              label={LABEL[type]}
              note={NOTE[type]}
              checked={types.includes(type)}
              onChange={(on) =>
                canEdit &&
                setTypes((prev) =>
                  on ? [...prev, type] : prev.filter((t) => t !== type),
                )
              }
            />
          ))}
        </View>
      </Card>
      <Txt variant="small" tone="body">
        When a type is on, a team member without the approve right sends the
        entry for approval instead of saving it. It stays out of the books,
        balances and reports, and gets its number only when the owner (or a role
        with the &quot;Approve entries&quot; right) approves it. The
        owner&apos;s own entries post directly. Sales and purchases never wait.
      </Txt>
      {canEdit ? (
        <Button
          label="Save"
          icon="check"
          variant="primary"
          block
          disabled={!changed}
          loading={save.isPending}
          onPress={async () => {
            try {
              await save.mutateAsync({ types, version: saved.version });
              showToast("Approvals saved");
            } catch (e) {
              showError("Couldn't save", e);
            }
          }}
        />
      ) : null}
      <Button
        label="Entries to review"
        icon="inbox"
        block
        onPress={() => router.push("/entries")}
      />
    </View>
  );
}
