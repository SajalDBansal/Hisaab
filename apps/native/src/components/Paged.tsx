import { ActivityIndicator, View } from "react-native";
import type { ServicePages } from "@/data/scopedHooks";
import { colors, space } from "@/theme";
import { Button } from "./Button";
import { ErrorState, LoadingList } from "./States";
import { Txt } from "./Txt";

/**
 * A paged list: loading and error states like QueryView, then the rows, then
 * what comes next: a spinner while the next page loads, "Load more" when the
 * screen hasn't asked yet, a retry when a page failed, or the end of the list.
 * The screen passes `list.loadMore` to `Screen onEndReached`.
 */
export function PagedView<T, S>({
  list,
  children,
  noun = "rows",
}: {
  list: ServicePages<T, S>;
  children: (page: {
    items: T[];
    summary: S;
    total: number;
  }) => React.ReactNode;
  /** "invoices", "parties"…, for "All 120 invoices shown". */
  noun?: string;
}) {
  const { query } = list;
  if (query.isPending) return <LoadingList />;
  if (list.summary === undefined)
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return (
    <>
      {children({
        items: list.items,
        summary: list.summary,
        total: list.total,
      })}
      <PageFooter list={list} noun={noun} />
    </>
  );
}

function PageFooter<T, S>({
  list,
  noun,
}: {
  list: ServicePages<T, S>;
  noun: string;
}) {
  const { query, items, total } = list;
  if (query.isFetchingNextPage)
    return (
      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          gap: space.sm,
          paddingVertical: space.md,
        }}
      >
        <ActivityIndicator color={colors.body} />
        <Txt variant="small" tone="body">
          Loading more…
        </Txt>
      </View>
    );
  if (query.isFetchNextPageError)
    return (
      <View style={{ gap: space.sm, alignItems: "center" }}>
        <Txt variant="small" tone="body" center>
          {query.error instanceof Error
            ? query.error.message
            : "The next page didn't load."}
        </Txt>
        <Button
          label="Try again"
          size="sm"
          onPress={() => void query.fetchNextPage()}
        />
      </View>
    );
  // A total of -1 means the server doesn't count this list.
  if (query.hasNextPage)
    return (
      <View style={{ gap: space.xs, alignItems: "center" }}>
        {total >= 0 ? (
          <Txt variant="caption" tone="body">
            {`Showing ${items.length} of ${total}`}
          </Txt>
        ) : null}
        <Button label="Load more" size="sm" onPress={list.loadMore} />
      </View>
    );
  return total < 0 || total > items.length || total <= 10 ? null : (
    <Txt variant="caption" tone="body" center>
      {`All ${total} ${noun} shown`}
    </Txt>
  );
}
