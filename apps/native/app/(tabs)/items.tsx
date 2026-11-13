import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import {
  altQtyText,
  canSeeCosts,
  formatINR,
  itemTaxType,
  taxTypeLabel,
  type ItemListRow,
  type ItemPageSummary,
  type TaxScope,
} from "@repo/core";
import {
  Avatar,
  Badge,
  Button,
  Chip,
  ChipRow,
  EmptyState,
  Icon,
  ListRow,
  PagedView,
  Screen,
  TabTitle,
  TaxScopeFilter,
  Txt,
} from "@/components";
import { useData } from "@/data/DataProvider";
import { useItemPages } from "@/data/pagedQueries";
import { useDebounced } from "@/data/useDebounced";
import { useReportScope } from "@/data/reportScope";
import { colors, radius, space } from "@/theme";
import { useGstMode } from "@/data/gstMode";

export default function ItemsScreen() {
  const gst = useGstMode();
  // Home's "Low stock" card opens this tab with ?filter=low
  const params = useLocalSearchParams<{ filter?: string }>();
  const [lowOnly, setLowOnly] = useState(params.filter === "low");
  const [group, setGroup] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useReportScope();
  const query = useDebounced(search);
  const items = useItemPages({
    search: query,
    group: group ?? undefined,
    low: lowOnly,
    scope,
  });

  useEffect(() => {
    if (params.filter === "low") setLowOnly(true);
  }, [params.filter]);

  return (
    <Screen
      header={
        <TabTitle
          title="Items"
          right={
            <Button
              label="Add item"
              size="sm"
              icon="plus"
              onPress={() => router.push("/item/new")}
            />
          }
        />
      }
      onRefresh={() => items.query.refetch()}
      refreshing={items.query.isRefetching && !items.query.isFetchingNextPage}
      onEndReached={items.loadMore}
      contentStyle={{ gap: space.lg, paddingTop: space.xs }}
    >
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View
          style={{
            flex: 1,
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
              gst.on ? "Search name, code or HSN" : "Search name or code"
            }
            placeholderTextColor={colors.mute}
            accessibilityLabel="Search items"
            style={{ flex: 1, fontSize: 14, minHeight: 40, color: colors.ink }}
          />
        </View>
      </View>

      <PagedView list={items} noun="items">
        {({ items: rows, summary }) => (
          <ItemList
            rows={rows}
            summary={summary}
            scope={scope}
            setScope={setScope}
            lowOnly={lowOnly}
            setLowOnly={setLowOnly}
            group={group}
            setGroup={setGroup}
          />
        )}
      </PagedView>
    </Screen>
  );
}

function ItemList({
  rows: visible,
  summary,
  scope,
  setScope,
  lowOnly,
  setLowOnly,
  group,
  setGroup,
}: {
  rows: ItemListRow[];
  summary: ItemPageSummary;
  scope: TaxScope;
  setScope: (scope: TaxScope) => void;
  lowOnly: boolean;
  setLowOnly: (v: boolean) => void;
  group: string | null;
  setGroup: (g: string | null) => void;
}) {
  const gst = useGstMode();
  // Stock is valued at purchase cost, which sales staff don't see.
  const { role } = useData();
  const showCosts = canSeeCosts(role);
  const groups = summary.groups;
  const totalValue = summary.value;
  const lowCount = summary.lowCount;

  return (
    <>
      <View
        style={{
          flexDirection: "row",
          borderWidth: 1,
          borderColor: colors.hairline,
          borderRadius: radius.card,
        }}
      >
        {showCosts ? (
          <Summary
            label="Stock value"
            value={formatINR(totalValue, { decimals: false })}
            flex={1.4}
          />
        ) : null}
        <Summary
          label="Items"
          value={String(summary.count)}
          divider={showCosts}
        />
        <Summary
          label="Low stock"
          value={String(lowCount)}
          divider
          warn={lowCount > 0}
        />
      </View>

      <TaxScopeFilter value={scope} onChange={setScope} />

      <ChipRow>
        <Chip
          label="All"
          selected={!lowOnly && !group}
          onPress={() => {
            setLowOnly(false);
            setGroup(null);
          }}
        />
        <Chip
          label={`Low stock · ${lowCount}`}
          selected={lowOnly}
          onPress={() => setLowOnly(!lowOnly)}
        />
        {groups.map((g) => (
          <Chip
            key={g}
            label={g}
            selected={group === g}
            onPress={() => setGroup(group === g ? null : g)}
          />
        ))}
      </ChipRow>

      {visible.length === 0 ? (
        <EmptyState
          icon="package"
          title="No items match"
          message="Try a shorter search or clear the filters."
        />
      ) : (
        <View>
          {visible.map((r, i) => (
            <ListRow
              key={r.item.id}
              left={<Avatar icon="package" />}
              title={r.item.name}
              subtitle={
                <View style={{ gap: 4 }}>
                  <Txt variant="caption" tone="body">
                    {gst.on
                      ? `${r.item.hsn ? `HSN ${r.item.hsn} · ` : ""}${
                          itemTaxType(r.item) === "taxable"
                            ? `GST ${r.item.gstRate}%`
                            : taxTypeLabel(itemTaxType(r.item))
                        } · `
                      : ""}
                    {r.item.group}
                  </Txt>
                  {r.lowStock ? <Badge label="Low stock" tone="warn" /> : null}
                  {r.item.batch ? (
                    <Badge label={`Batch ${r.item.batch.number}`} />
                  ) : null}
                </View>
              }
              right={
                <View style={{ alignItems: "flex-end" }}>
                  <Txt
                    variant="bodyStrong"
                    num
                    tone={r.lowStock ? "warn" : "ink"}
                    style={{ fontWeight: "600" }}
                  >
                    {r.qty} {r.item.unit}
                  </Txt>
                  <Txt variant="caption" tone="body" num>
                    {[
                      altQtyText(r.item, r.qty),
                      showCosts ? formatINR(r.value) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Txt>
                </View>
              }
              onPress={() => router.push(`/item/${r.item.id}`)}
              last={i === visible.length - 1}
            />
          ))}
        </View>
      )}
    </>
  );
}

function Summary({
  label,
  value,
  divider,
  warn,
  flex = 1,
}: {
  label: string;
  value: string;
  divider?: boolean;
  warn?: boolean;
  flex?: number;
}) {
  return (
    <View
      style={{
        flex,
        padding: 12,
        borderLeftWidth: divider ? 1 : 0,
        borderLeftColor: colors.hairline,
      }}
    >
      <Txt variant="caption" tone="body">
        {label}
      </Txt>
      <Txt
        variant="heading"
        num
        tone={warn ? "warn" : "ink"}
        adjustsFontSizeToFit
        numberOfLines={1}
      >
        {value}
      </Txt>
    </View>
  );
}
