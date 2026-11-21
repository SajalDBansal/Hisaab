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
import { drCr, voucherTypeLabel } from "@/data/labels";
import { useAccountMasters } from "@/data/queries";
import { useAccountStatementPages } from "@/data/pagedQueries";
import { useReportScope } from "@/data/reportScope";
import { space } from "@/theme";

/** Statement of any account (Sales, Rent, Output CGST, Capital…) with the running balance. */
export default function AccountStatementScreen() {
  const { key: raw } = useLocalSearchParams<{ key: string }>();
  const key = raw ?? "";
  const masters = useAccountMasters();
  const master = masters.data?.find((a) => `account:${a.id}` === key);
  const [tax] = useReportScope();
  const statement = useAccountStatementPages(key, tax);
  const st = statement.summary;

  return (
    <Screen
      header={
        <Header title={st?.name ?? "Account"} subtitle={st?.group ?? ""} />
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
              <KeyValue label="Opening balance" value={drCr(st.opening)} />
              <KeyValue label="Debits" value={formatINR(st.totalDebit)} />
              <KeyValue label="Credits" value={formatINR(st.totalCredit)} />
              <KeyValue
                label="Closing balance"
                value={drCr(st.closing)}
                strong
              />
            </Card>
            {master ? (
              <View>
                {master.contactName ? (
                  <KeyValue label="Contact" value={master.contactName} />
                ) : null}
                {master.phone ? (
                  <KeyValue label="Phone" value={master.phone} />
                ) : null}
                {master.note ? (
                  <KeyValue label="Agreed terms" value={master.note} />
                ) : null}
              </View>
            ) : null}

            {rows.length === 0 ? (
              <EmptyState
                icon="list"
                title="No entries yet"
                message="Only the opening balance is on this account."
              />
            ) : (
              <View>
                <Txt variant="heading" style={{ marginBottom: space.xs }}>
                  Entries · newest first
                </Txt>
                {rows.map((r, i) => (
                  <ListRow
                    key={
                      r.kind === "opening"
                        ? `opening:${r.partyId}`
                        : `${r.voucher.id}-${i}`
                    }
                    title={
                      r.kind === "opening"
                        ? "Opening balance"
                        : r.voucher.narration ||
                          r.voucher.expenseHead ||
                          `${voucherTypeLabel[r.voucher.type]} ${r.voucher.number}`
                    }
                    subtitle={
                      r.kind === "opening"
                        ? `${r.counterName} · ${formatDate(r.date)}`
                        : `${voucherTypeLabel[r.voucher.type]} · ${r.voucher.number} · ${formatDate(r.date)}`
                    }
                    onPress={
                      r.kind === "voucher"
                        ? () => router.push(`/voucher/${r.voucher.id}`)
                        : undefined
                    }
                    right={
                      <View style={{ alignItems: "flex-end" }}>
                        <Txt
                          variant="bodyStrong"
                          num
                          style={{ fontWeight: "600" }}
                        >
                          {r.debit
                            ? `${formatINR(r.debit)} Dr`
                            : `${formatINR(r.credit)} Cr`}
                        </Txt>
                        <Txt variant="caption" tone="body" num>
                          Bal {drCr(r.balance)}
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
      <VoucherAttachments key={key} accountKey={key} />
    </Screen>
  );
}
