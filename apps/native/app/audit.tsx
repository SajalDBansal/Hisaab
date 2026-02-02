import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  AUDIT_ACTION_LABEL,
  type AuditAction,
  type AuditEntry,
} from "@repo/core";
import {
  Chip,
  ChipRow,
  EmptyState,
  Header,
  ListRow,
  QueryView,
  Screen,
  Txt,
} from "@/components";
import { formatDateTime } from "@/data/format";
import { voucherTypeLabel } from "@/data/labels";
import { useAuditLog } from "@/data/queries";
import { colors } from "@/theme";

type Filter = "all" | "edited" | "cancelled";

/**
 * Edit log (audit trail): every voucher created, edited, cancelled or converted, newest first.
 * Entries are only ever added — there is no way to switch the log off or delete from it.
 */
export default function AuditScreen() {
  const log = useAuditLog();
  const [filter, setFilter] = useState<Filter>("all");
  return (
    <Screen
      header={<Header title="Edit log" subtitle="Who changed what, and when" />}
      onRefresh={() => log.refetch()}
      refreshing={log.isRefetching}
    >
      <QueryView query={log}>
        {(entries) => {
          const changes = entries.filter((e) => e.action !== "created");
          const visible = entries.filter((e) =>
            filter === "all"
              ? true
              : filter === "edited"
                ? e.action !== "created" && e.action !== "cancelled"
                : e.action === "cancelled",
          );
          return (
            <>
              <ChipRow>
                <Chip
                  label={`All · ${entries.length}`}
                  selected={filter === "all"}
                  onPress={() => setFilter("all")}
                />
                <Chip
                  label={`Changes · ${changes.filter((e) => e.action !== "cancelled").length}`}
                  selected={filter === "edited"}
                  onPress={() => setFilter("edited")}
                />
                <Chip
                  label={`Cancelled · ${entries.filter((e) => e.action === "cancelled").length}`}
                  selected={filter === "cancelled"}
                  onPress={() => setFilter("cancelled")}
                />
              </ChipRow>
              {visible.length === 0 ? (
                <EmptyState icon="clock" title="Nothing here yet" />
              ) : (
                <View>
                  {visible.map((e, i) => (
                    <Row key={e.id} e={e} last={i === visible.length - 1} />
                  ))}
                </View>
              )}
              <Txt variant="caption" tone="body">
                The law asks accounting software to keep a log of every change
                that can't be switched off. Hisaab keeps it for every firm;
                nothing in it can be edited or deleted.
              </Txt>
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}

const ACTION_TONE: Partial<Record<AuditAction, string>> = {
  cancelled: colors.give,
  edited: colors.warn,
};

function Row({ e, last }: { e: AuditEntry; last: boolean }) {
  return (
    <ListRow
      title={`${AUDIT_ACTION_LABEL[e.action]} · ${voucherTypeLabel[e.voucherType]} ${e.number}`}
      subtitle={
        <View style={{ gap: 2 }}>
          <Txt variant="caption" tone="body">
            {formatDateTime(e.at)} · {e.userName}
            {e.note ? ` · ${e.note}` : ""}
          </Txt>
          {e.changes.slice(0, 3).map((c) => (
            <Txt
              key={c.field}
              variant="caption"
              tone="charcoal"
              numberOfLines={2}
            >
              {c.field}: {c.before} → {c.after}
            </Txt>
          ))}
        </View>
      }
      left={
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            marginTop: 6,
            backgroundColor: ACTION_TONE[e.action] ?? colors.hairlineStrong,
          }}
        />
      }
      onPress={() => router.push(`/voucher/${e.voucherId}`)}
      last={last}
    />
  );
}
