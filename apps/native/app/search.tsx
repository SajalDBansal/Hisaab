import { router, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { formatDate, type SearchHit } from "@repo/core";
import {
  Avatar,
  Badge,
  EmptyState,
  ErrorState,
  Header,
  ListRow,
  LoadingList,
  Money,
  Screen,
  TextField,
  Txt,
} from "@/components";
import { voucherTypeIcon, voucherTypeLabel } from "@/data/labels";
import { useSearch } from "@/data/queries";

import { space } from "@/theme";

/** Where tapping a result goes. */
const hrefFor = (h: SearchHit): Href =>
  h.kind === "party"
    ? `/party/${h.id}`
    : h.kind === "item"
      ? `/item/${h.id}`
      : h.kind === "ledger"
        ? `/ledger/${h.id}`
        : `/voucher/${h.id}`;

/** Wait until the user stops typing for a moment before searching. */
function useDebounced(value: string, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** One search box for parties, items, bills and vouchers, and cash/bank accounts. */
export default function SearchScreen() {
  const [text, setText] = useState("");
  const query = useDebounced(text);
  const results = useSearch(query);
  const tooShort = query.trim().length < 2;
  const r = results.data;
  const total = r
    ? r.parties.length + r.items.length + r.vouchers.length + r.ledgers.length
    : 0;

  return (
    <Screen header={<Header title={"Search"} />}>
      <View style={{ flexDirection: "row" }}>
        <TextField
          label={"Search"}
          hideLabel
          value={text}
          onChangeText={setText}
          placeholder="Party, item, bill no., phone, GSTIN or amount"
          autoFocus
        />
      </View>

      {tooShort ? (
        <View style={{ gap: space.xs }}>
          <Txt variant="small" tone="body">
            Try:
          </Txt>
          <Txt variant="caption" tone="body">
            Sharma · 0025 · 98370 · 09AAAAA · 1,208 · cement
          </Txt>
        </View>
      ) : results.isLoading ? (
        <LoadingList rows={4} />
      ) : results.isError ? (
        <ErrorState onRetry={() => void results.refetch()} />
      ) : !r || total === 0 ? (
        <EmptyState
          icon="search"
          title={`Nothing found for “${query.trim()}”`}
          message="Check the spelling, or search a bill number, phone or amount."
        />
      ) : (
        <>
          <Section title="Parties" hits={r.parties} />
          <Section title="Items" hits={r.items} />
          <Section title="Bills and vouchers" hits={r.vouchers} />
          <Section title="Cash and bank" hits={r.ledgers} />
        </>
      )}
    </Screen>
  );
}

function Section({ title, hits }: { title: string; hits: SearchHit[] }) {
  if (hits.length === 0) return null;
  return (
    <View>
      <Txt variant="label" tone="body" style={{ marginBottom: space.xs }}>
        {title} · {hits.length}
      </Txt>
      {hits.map((h, i) => (
        <ListRow
          key={`${h.kind}-${h.id}`}
          left={
            h.kind === "voucher" && h.voucherType ? (
              <Avatar icon={voucherTypeIcon[h.voucherType]} />
            ) : h.kind === "item" ? (
              <Avatar icon="package" />
            ) : h.kind === "ledger" ? (
              <Avatar icon="credit-card" />
            ) : (
              <Avatar name={h.title} />
            )
          }
          title={h.title}
          subtitle={
            h.kind === "voucher" && h.voucherType
              ? [
                  voucherTypeLabel[h.voucherType],
                  h.date ? formatDate(h.date) : "",
                  h.subtitle,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : h.subtitle
          }
          onPress={() => router.push(hrefFor(h))}
          right={
            h.amount !== undefined ? (
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Money
                  value={Math.abs(h.amount)}
                  variant="small"
                  style={
                    h.cancelled ? { textDecorationLine: "line-through" } : null
                  }
                />
                {h.cancelled ? <Badge label="Cancelled" tone="bad" /> : null}
              </View>
            ) : undefined
          }
          last={i === hits.length - 1}
        />
      ))}
    </View>
  );
}
