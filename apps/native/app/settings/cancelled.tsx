import { router } from "expo-router";
import { View } from "react-native";
import { formatDate, formatINR, type CancelledEntry } from "@repo/core";
import {
  Button,
  EmptyState,
  Header,
  ListRow,
  QueryView,
  Screen,
  Txt,
  showError,
} from "@/components";
import { confirmAction } from "@/data/confirm";
import { formatDateTime } from "@/data/format";
import { voucherTypeLabel } from "@/data/labels";
import { useCancelledVouchers, useRestoreVoucher } from "@/data/queries";

/**
 * Cancelled entries the owner can put back (doc 37, T47). Hisaab never deletes
 * a voucher: a cancelled one keeps its number and can be restored exactly as it
 * was, unless something since depends on it being gone.
 */
export default function CancelledEntriesScreen() {
  const list = useCancelledVouchers();
  return (
    <Screen
      header={
        <Header
          close
          title="Cancelled entries"
          subtitle="Restore an entry cancelled by mistake"
        />
      }
      onRefresh={() => list.refetch()}
      refreshing={list.isRefetching}
    >
      <QueryView query={list}>
        {(page) =>
          page.items.length === 0 ? (
            <EmptyState icon="rotate-ccw" title="No cancelled entries" />
          ) : (
            <View>
              {page.items.map((entry, i) => (
                <Row
                  key={entry.id}
                  entry={entry}
                  last={i === page.items.length - 1}
                />
              ))}
            </View>
          )
        }
      </QueryView>
      <Txt variant="caption" tone="body">
        A restored entry keeps its number and counts again in balances, stock,
        GST and reports. The edit log keeps both the cancellation and the
        restore.
      </Txt>
    </Screen>
  );
}

function Row({ entry, last }: { entry: CancelledEntry; last: boolean }) {
  const restore = useRestoreVoucher();
  const label = `${voucherTypeLabel[entry.type]} ${entry.number}`;
  const run = () =>
    confirmAction(
      `Restore ${label}?`,
      "It will count again everywhere, as it did before it was cancelled.",
      "Restore",
      async () => {
        try {
          await restore.mutateAsync({ id: entry.id, version: entry.version });
        } catch (e) {
          showError("Couldn't restore", e);
        }
      },
    );
  return (
    <ListRow
      title={label}
      last={last}
      subtitle={
        <View style={{ gap: 2 }}>
          <Txt variant="caption" tone="body" num>
            {formatDate(entry.date)}
            {entry.partyName ? ` · ${entry.partyName}` : ""} ·{" "}
            {formatINR(entry.amount)}
          </Txt>
          <Txt variant="caption" tone="body">
            Cancelled
            {entry.cancelledAt ? ` ${formatDateTime(entry.cancelledAt)}` : ""}
            {entry.reason ? ` · ${entry.reason}` : ""}
          </Txt>
          {entry.restoreBlocker && (
            <Txt variant="caption" tone="give">
              {entry.restoreBlocker}
            </Txt>
          )}
        </View>
      }
      // The row itself isn't pressable: a button can't sit inside another on web.
      right={
        <View style={{ gap: 6 }}>
          <Button
            label="Restore"
            size="sm"
            onPress={run}
            loading={restore.isPending}
            disabled={!!entry.restoreBlocker}
          />
          <Button
            label="View"
            size="sm"
            onPress={() => router.push(`/voucher/${entry.id}`)}
          />
        </View>
      }
    />
  );
}
