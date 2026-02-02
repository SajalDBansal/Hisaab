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
  QueryView,
  Screen,
  TaxScopeFilter,
  Txt,
} from "@/components";
import { voucherTypeLabel } from "@/data/labels";
import { useLedgerStatement } from "@/data/queries";
import { space } from "@/theme";

/** Cash book or bank book: every movement with the running balance. */
export default function LedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const statement = useLedgerStatement(id);
  const ledger = statement.data?.ledger;

  return (
    <Screen
      header={
        <Header
          title={ledger?.name ?? "Account"}
          subtitle={ledger?.kind === "cash" ? "Cash book" : "Bank book"}
        />
      }
      onRefresh={() => statement.refetch()}
      refreshing={statement.isRefetching}
    >
      <TaxScopeFilter />
      <QueryView query={statement}>
        {(st) => (
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

            {st.rows.length === 0 ? (
              <EmptyState icon="list" title="No entries yet" />
            ) : (
              <View>
                <Txt variant="heading" style={{ marginBottom: space.xs }}>
                  Entries · newest first
                </Txt>
                {st.rows.map((r, i) => (
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
                    last={i === st.rows.length - 1}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </QueryView>
      <VoucherAttachments key={id} accountKey={`ledger:${id}`} />
    </Screen>
  );
}
