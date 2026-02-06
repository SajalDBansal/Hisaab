import { router, useLocalSearchParams } from "expo-router";
import { formatDate, formatINR } from "@repo/core";
import {
  Button,
  EmptyState,
  Header,
  ListRow,
  QueryView,
  Screen,
  Txt,
} from "@/components";
import { useSettlementAccess, useSettlements } from "@/data/settlementHooks";

export default function Settlements() {
  const { loanId } = useLocalSearchParams<{ loanId?: string }>();
  const access = useSettlementAccess(),
    query = useSettlements();
  return (
    <Screen
      header={<Header title="Settlements" />}
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      {!access.read ? (
        <EmptyState title="Settlement access denied" />
      ) : !access.connected ? (
        <EmptyState title="Sign in to a connected firm" />
      ) : (
        <>
          {access.write ? (
            <>
              <Button
                label="New settlement"
                icon="plus"
                variant="primary"
                onPress={() => router.push("/settlements/new")}
              />
              <Button
                label="Loan interest"
                icon="percent"
                onPress={() =>
                  router.push(
                    loanId
                      ? `/settlements/interest?loanId=${loanId}`
                      : "/settlements/interest",
                  )
                }
              />
            </>
          ) : null}
          <QueryView query={query}>
            {(allRows) => {
              const rows = allRows.filter(
                (row) => !loanId || row.loanId === loanId,
              );
              return rows.length ? (
                rows
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <ListRow
                      key={entry.id}
                      title={entry.kind.replaceAll("-", " ")}
                      subtitle={`${formatDate(entry.date)} | ${entry.bookScope.toUpperCase()} | ${entry.reason}`}
                      right={<Txt>{formatINR(entry.amount)}</Txt>}
                      chevron
                      onPress={() => router.push(`/settlements/${entry.id}`)}
                    />
                  ))
              ) : (
                <EmptyState title="No settlements" />
              );
            }}
          </QueryView>
        </>
      )}
    </Screen>
  );
}
