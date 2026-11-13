import { router } from "expo-router";
import { useState } from "react";
import { TextInput, View } from "react-native";
import type { PartyListRow, PartyPageSummary, PartyType } from "@repo/core";
import {
  Avatar,
  Balance,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  Icon,
  ListRow,
  Money,
  PagedView,
  Screen,
  Segmented,
  TabTitle,
  Txt,
} from "@/components";
import { usePartyPages } from "@/data/pagedQueries";
import { useDebounced } from "@/data/useDebounced";
import { colors, radius, space } from "@/theme";
import { useGstMode } from "@/data/gstMode";

type Tab = PartyType | "all";
type Sort = "balance" | "name";

export default function PartiesScreen() {
  const gst = useGstMode();
  const [tab, setTab] = useState<Tab>("customer");
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [withBalance, setWithBalance] = useState(false);
  const [sort, setSort] = useState<Sort>("balance");
  const query = useDebounced(search);
  const parties = usePartyPages({
    type: tab === "all" ? undefined : tab,
    search: query,
    overdue: overdueOnly,
    withBalance,
    sort,
  });

  return (
    <Screen
      header={
        <TabTitle
          title="Parties"
          right={
            <Button
              label="Add party"
              size="sm"
              icon="plus"
              onPress={() =>
                router.push(
                  `/party/new?type=${tab === "supplier" ? "supplier" : "customer"}`,
                )
              }
            />
          }
        />
      }
      onRefresh={() => parties.query.refetch()}
      refreshing={
        parties.query.isRefetching && !parties.query.isFetchingNextPage
      }
      onEndReached={parties.loadMore}
      contentStyle={{ gap: space.lg, paddingTop: space.xs }}
    >
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "customer", label: "Customers" },
          { value: "supplier", label: "Suppliers" },
          { value: "all", label: "All" },
        ]}
      />

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          minHeight: 44,
          paddingHorizontal: space.lg,
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceSoft,
        }}
      >
        <Icon name="search" size={18} color={colors.body} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={
            gst.on ? "Search name, phone or GSTIN" : "Search name or phone"
          }
          placeholderTextColor={colors.mute}
          accessibilityLabel="Search parties"
          style={{ flex: 1, fontSize: 14, minHeight: 40, color: colors.ink }}
        />
      </View>

      <ChipRow>
        <Chip
          label="Overdue"
          selected={overdueOnly}
          onPress={() => setOverdueOnly(!overdueOnly)}
        />
        <Chip
          label="Has balance"
          selected={withBalance}
          onPress={() => setWithBalance(!withBalance)}
        />
        <Chip
          label={sort === "balance" ? "Sort: Balance" : "Sort: Name"}
          selected
          onPress={() => setSort(sort === "balance" ? "name" : "balance")}
        />
      </ChipRow>

      <PagedView list={parties} noun="parties">
        {({ items, summary, total }) => (
          <PartyList rows={items} summary={summary} total={total} />
        )}
      </PagedView>
    </Screen>
  );
}

/** One page after another; filters, sorting and totals come from the server. */
function PartyList({
  rows: visible,
  summary,
  total,
}: {
  rows: PartyListRow[];
  summary: PartyPageSummary;
  total: number;
}) {
  const gst = useGstMode();
  const youGet = summary.receivable;
  const youGive = summary.payable;

  return (
    <>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <Card style={{ flex: 1, paddingVertical: space.md }}>
          <Txt variant="small" tone="body">
            You'll get
          </Txt>
          <Money value={youGet} variant="heading" tone="get" />
        </Card>
        <Card style={{ flex: 1, paddingVertical: space.md }}>
          <Txt variant="small" tone="body">
            You'll give
          </Txt>
          <Money value={youGive} variant="heading" tone="give" />
        </Card>
      </View>

      <Txt variant="small" tone="body" style={{ marginBottom: -space.sm }}>
        {total} {total === 1 ? "party" : "parties"}
      </Txt>

      {visible.length === 0 ? (
        <EmptyState
          icon="users"
          title="No parties match"
          message="Clear the search or filters to see everyone."
        />
      ) : (
        <View>
          {visible.map((r, i) => (
            <ListRow
              key={r.party.id}
              left={<Avatar name={r.party.name} />}
              title={r.party.name}
              subtitle={
                <Txt variant="small" tone="body" numberOfLines={1}>
                  {r.party.gstin || !gst.on
                    ? r.party.phone
                    : `Unregistered · ${r.party.phone}`}
                  {r.overdueAmount > 0 ? (
                    <Txt
                      variant="small"
                      tone="warn"
                    >{` · Overdue ${r.maxOverdueDays}d`}</Txt>
                  ) : null}
                </Txt>
              }
              right={<Balance value={r.balance} />}
              onPress={() => router.push(`/party/${r.party.id}`)}
              last={i === visible.length - 1}
            />
          ))}
        </View>
      )}
    </>
  );
}
