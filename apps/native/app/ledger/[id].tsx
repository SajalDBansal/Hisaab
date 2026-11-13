import { router, useLocalSearchParams } from "expo-router";
import { VoucherAttachments } from "@/documents/VoucherAttachments";
import { View } from "react-native";
import { formatDate, formatINR } from "@repo/core";
import {
  Card,
  EmptyState,
  Header,
  KeyValue,
  ListRow,
  PagedView,
  Screen,
  TaxScopeFilter,
  Txt,
} from "@/components";
import { voucherTypeLabel } from "@/data/labels";
import { useLedgerStatementPages } from "@/data/pagedQueries";
import { useReportScope } from "@/data/reportScope";
import { space } from "@/theme";

/** Cash book or bank book: every movement with the running balance. */
export default function LedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tax] = useReportScope();
  const statement = useLedgerStatementPages(id, tax);
  const ledger = statement.summary?.ledger;

  return (
    <Screen
      header={
        <Header
          title={ledger?.name ?? "Account"}
          subtitle={ledger?.kind === "cash" ? "Cash book" : "Bank book"}
        />
      }
      onRefresh={() => statement.query.refetch()}
      refreshing={
        statement.query.isRefetching && !statement.query.isFetchingNextPage
      }
      onEndReached={statement.loadMore}
    >
      <TaxScopeFilter />
      <PagedView list={statement} noun="entries">
        {({ items: rows, summary: st }) => (
          <>
            <Card style={{ gap: 0 }}>
              <KeyValue label="Opening balance" value={formatINR(st.opening)} />
              <KeyValue label="Money in" value={`+${formatINR(st.totalIn)}`} />
              <KeyValue
                label="Money out"
                value={`−${formatINR(st.totalOut)}`}
              />
              <KeyValue
                label="Closing balance"
                value={formatINR(st.closing)}
                strong
              />
            </Card>

            {rows.length === 0 ? (
              <EmptyState icon="list" title="No entries yet" />
            ) : (
              <View>
                <Txt variant="heading" style={{ marginBottom: space.xs }}>
                  Entries · newest first
                </Txt>
                {rows.map((r, i) => (
                  <ListRow
                    key={r.voucher.id}
                    title={r.particulars || voucherTypeLabel[r.voucher.type]}
                    subtitle={`${voucherTypeLabel[r.voucher.type]} · ${r.voucher.number} · ${formatDate(r.voucher.date)}`}
                    onPress={() => router.push(`/voucher/${r.voucher.id}`)}
                    right={
                      <View style={{ alignItems: "flex-end" }}>
                        <Txt
                          variant="bodyStrong"
                          num
                          tone={r.moneyIn ? "get" : "ink"}
                          style={{ fontWeight: "600" }}
                        >
                          {r.moneyIn
                            ? `+${formatINR(r.moneyIn)}`
                            : `−${formatINR(r.moneyOut)}`}
                        </Txt>
                        <Txt variant="caption" tone="body" num>
                          Bal {formatINR(r.balance)}
                        </Txt>
                      </View>
                    }
                    last={i === rows.length - 1}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </PagedView>
      <VoucherAttachments key={id} accountKey={`ledger:${id}`} />
    </Screen>
  );
}
