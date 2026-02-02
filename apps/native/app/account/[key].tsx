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
import { drCr, voucherTypeLabel } from "@/data/labels";
import { useAccountStatement, useAccountMasters } from "@/data/queries";
import { space } from "@/theme";

/** Statement of any account (Sales, Rent, Output CGST, Capital…) with the running balance. */
export default function AccountStatementScreen() {
  const { key: raw } = useLocalSearchParams<{ key: string }>();
  const key = raw ?? "";
  const masters = useAccountMasters();
  const master = masters.data?.find((a) => `account:${a.id}` === key);
  const statement = useAccountStatement(key);
  const st = statement.data;

  return (
    <Screen
      header={
        <Header title={st?.name ?? "Account"} subtitle={st?.group ?? ""} />
      }
      onRefresh={() => statement.refetch()}
      refreshing={statement.isRefetching}
    >
      <TaxScopeFilter />
      <QueryView query={statement}>
        {(st) => (
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

            {st.rows.length === 0 ? (
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
                {st.rows.map((r, i) => (
                  <ListRow
                    key={`${r.voucher.id}-${i}`}
                    title={
                      r.voucher.narration ||
                      r.voucher.expenseHead ||
                      `${voucherTypeLabel[r.voucher.type]} ${r.voucher.number}`
                    }
                    subtitle={`${voucherTypeLabel[r.voucher.type]} · ${r.voucher.number} · ${formatDate(r.voucher.date)}`}
                    onPress={() => router.push(`/voucher/${r.voucher.id}`)}
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
                    last={i === st.rows.length - 1}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </QueryView>
      <VoucherAttachments key={key} accountKey={key} />
    </Screen>
  );
}
