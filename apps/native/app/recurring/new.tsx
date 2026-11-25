import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  Button,
  Card,
  FooterBar,
  Header,
  KeyValue,
  QueryView,
  Screen,
  Txt,
  showError,
  showToast,
} from "@/components";
import { formatINR } from "@repo/core";
import { useVoucher } from "@/data/queries";
import { useScheduleFromVoucher } from "@/data/recurringHooks";
import { voucherTypeLabel } from "@/data/labels";
import {
  ScheduleFields,
  planDraft,
  planInput,
  type PlanDraft,
} from "@/forms/ScheduleFields";
import { space } from "@/theme";

/** Repeat a saved entry on a schedule (doc 37, T03). Open with ?voucherId=… */
export default function NewScheduleScreen() {
  const { voucherId = "" } = useLocalSearchParams<{ voucherId?: string }>();
  const voucher = useVoucher(voucherId);
  return (
    <QueryView query={voucher}>
      {(detail) => <Editor detail={detail} />}
    </QueryView>
  );
}

function Editor({
  detail,
}: {
  detail: NonNullable<ReturnType<typeof useVoucher>["data"]>;
}) {
  const v = detail.voucher;
  const party = detail.party?.name;
  const create = useScheduleFromVoucher(v.id);
  const [draft, setDraft] = useState<PlanDraft>(
    planDraft(
      party
        ? `${voucherTypeLabel[v.type]} · ${party}`
        : voucherTypeLabel[v.type],
    ),
  );
  const [showErrors, setShowErrors] = useState(false);
  const save = async () => {
    setShowErrors(true);
    const { plan, problem } = planInput(draft);
    if (problem) return;
    try {
      await create.mutateAsync({ ...plan, active: true });
      showToast("Schedule saved. Drafts appear under Entries to review.");
      router.replace("/settings/recurring");
    } catch (e) {
      showError("Couldn't save", e);
    }
  };
  return (
    <Screen
      header={<Header close title="Repeat this entry" subtitle={v.number} />}
      footer={
        <FooterBar>
          <Button
            label="Save schedule"
            icon="repeat"
            variant="primary"
            block
            loading={create.isPending}
            onPress={save}
          />
        </FooterBar>
      }
    >
      <View style={{ gap: space.lg }}>
        <Card>
          <KeyValue
            label="Entry"
            value={`${voucherTypeLabel[v.type]} ${v.number}`}
          />
          {party ? <KeyValue label="Party" value={party} /> : null}
          <KeyValue label="Amount" value={formatINR(v.amount)} />
        </Card>
        <Txt variant="small" tone="body">
          On each date a draft of this entry is made for you to check and save.
          Nothing is posted by itself. Bills it settled are not repeated.
        </Txt>
        <ScheduleFields
          draft={draft}
          onChange={setDraft}
          showErrors={showErrors}
        />
      </View>
    </Screen>
  );
}
