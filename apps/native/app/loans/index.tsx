import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatDate, formatINR } from "@repo/core";
import {
  Button,
  EmptyState,
  Header,
  ListRow,
  PagedView,
  Screen,
  Segmented,
  Txt,
} from "@/components";
import { useLoanAccess, useLoanPages } from "@/data/loanHooks";
import { space } from "@/theme";

export default function LoanRegister() {
  const access = useLoanAccess();
  const query = useLoanPages();
  const [direction, setDirection] = useState<"all" | "borrowed" | "lent">(
    "all",
  );
  return (
    <Screen
      header={<Header title="Loan register" />}
      onRefresh={() => void query.query.refetch()}
      refreshing={query.query.isRefetching && !query.query.isFetchingNextPage}
      onEndReached={query.loadMore}
    >
      {!access.read ? (
        <EmptyState title="Loan register access denied" />
      ) : !access.connected ? (
        <EmptyState title="Sign in to a connected firm" />
      ) : (
        <>
          {access.write ? (
            <Button
              label="Register loan"
              icon="plus"
              variant="primary"
              onPress={() => router.push("/loans/new")}
            />
          ) : null}
          <Segmented
            value={direction}
            onChange={setDirection}
            options={[
              { value: "all", label: "All" },
              { value: "borrowed", label: "Borrowed" },
              { value: "lent", label: "Lent" },
            ]}
          />
          <PagedView list={query} noun="loans">
            {({ items: rows }) => {
              const filtered = rows.filter(
                (row) =>
                  direction === "all" || row.loan.direction === direction,
              );
              return filtered.length ? (
                <View>
                  {filtered.map((row) => (
                    <ListRow
                      key={row.loan.id}
                      title={row.loan.name}
                      subtitle={
                        <View style={{ gap: space.xs }}>
                          <Txt variant="small">
                            {row.loan.counterparty} | {row.loan.direction} |{" "}
                            {row.loan.status}
                          </Txt>
                          <Txt variant="caption">
                            Planned principal{" "}
                            {formatINR(row.loan.terms.principal)} | Maturity{" "}
                            {formatDate(row.loan.maturityDate)}
                          </Txt>
                          <Txt variant="small">
                            Posted balance{" "}
                            {formatINR(Math.abs(row.postedBalance))}{" "}
                            {row.postedBalance < 0 ? "Cr" : "Dr"}
                          </Txt>
                        </View>
                      }
                      onPress={() => router.push(`/loans/${row.loan.id}`)}
                      chevron
                    />
                  ))}
                </View>
              ) : (
                <EmptyState title="No loans registered" />
              );
            }}
          </PagedView>
        </>
      )}
    </Screen>
  );
}
