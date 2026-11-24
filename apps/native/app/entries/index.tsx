import { View } from "react-native";
import { router } from "expo-router";
import type { PendingEntry } from "@repo/contracts";
import { formatDate } from "@repo/core";
import {
  Badge,
  Card,
  EmptyState,
  Header,
  ListRow,
  Money,
  QueryView,
  Screen,
  SectionHeader,
  Txt,
} from "@/components";
import { ENTRY_STATUS, usePendingEntries } from "@/data/recurringHooks";
import { voucherTypeLabel } from "@/data/labels";
import { space } from "@/theme";

/**
 * Entries to review (doc 37, T03/T06): drafts from recurring schedules,
 * entries waiting for approval and ones sent back. None of them are in the
 * books until saved or approved.
 */
export default function EntriesScreen() {
  const list = usePendingEntries();
  return (
    <Screen
      header={
        <Header title="Entries to review" subtitle="Drafts and approvals" />
      }
    >
      <QueryView query={list}>
        {(data) => {
          const groups: [string, PendingEntry["status"]][] = [
            [
              data.canApprove
                ? "Waiting for your approval"
                : "Sent for approval",
              "submitted",
            ],
            ["Sent back", "rejected"],
            ["Recurring drafts", "draft"],
          ];
          if (!data.entries.length)
            return (
              <EmptyState
                icon="check-circle"
                title="Nothing to review"
                message="Recurring drafts and entries sent for approval show up here."
              />
            );
          return (
            <View style={{ gap: space.lg }}>
              <Txt variant="small" tone="body">
                These are not in the books yet: balances and reports leave them
                out until they are saved or approved.
              </Txt>
              {groups.map(([title, status]) => {
                const rows = data.entries.filter((e) => e.status === status);
                if (!rows.length) return null;
                return (
                  <View key={status} style={{ gap: space.sm }}>
                    <SectionHeader title={`${title} (${rows.length})`} />
                    <Card>
                      {rows.map((e, i) => (
                        <ListRow
                          key={e.id}
                          title={`${voucherTypeLabel[e.voucherType]}${e.partyName ? ` · ${e.partyName}` : ""}`}
                          subtitle={`${formatDate(e.date)}${e.scheduleName ? ` · ${e.scheduleName}` : ""}${e.submittedByName && status !== "draft" ? ` · by ${e.submittedByName}` : ""}`}
                          right={
                            <View style={{ alignItems: "flex-end", gap: 2 }}>
                              <Money value={e.amount} />
                              <Badge
                                label={ENTRY_STATUS[e.status].label}
                                tone={ENTRY_STATUS[e.status].tone}
                              />
                            </View>
                          }
                          chevron
                          last={i === rows.length - 1}
                          onPress={() => router.push(`/entries/${e.id}`)}
                        />
                      ))}
                    </Card>
                  </View>
                );
              })}
            </View>
          );
        }}
      </QueryView>
    </Screen>
  );
}
