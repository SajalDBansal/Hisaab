import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import {
  altQtyText,
  formatINR,
  itemTaxType,
  taxTypeLabel,
  type ItemListRow,
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
  QueryView,
  Screen,
  TabTitle,
  TaxScopeFilter,
  Txt,
} from "@/components";
import { useItems, useStockLots } from "@/data/queries";
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
  const items = useItems();
  const stock = useStockLots();

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
      onRefresh={() => Promise.all([items.refetch(), stock.refetch()])}
      refreshing={items.isRefetching || stock.isRefetching}
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

      <QueryView query={items}>
        {(rows) => (
          <ItemList
            rows={rows}
            search={search}
            lowOnly={lowOnly}
            setLowOnly={setLowOnly}
            group={group}
            setGroup={setGroup}
          />
        )}
      </QueryView>
    </Screen>
  );
}

function ItemList({
  rows,
  search,
  lowOnly,
  setLowOnly,
  group,
  setGroup,
}: {
  rows: ItemListRow[];
  search: string;
  lowOnly: boolean;
  setLowOnly: (v: boolean) => void;
  group: string | null;
  setGroup: (g: string | null) => void;
}) {
  const gst = useGstMode();
  const groups = useMemo(
    () => [...new Set(rows.map((r) => r.item.group))].sort(),
    [rows],
  );
  const [scope, setScope] = useReportScope();
  const stock = useStockLots();
  const scopedRows = useMemo(
    () =>
      rows
        .map((row) => {
          const lots = (stock.data ?? []).filter(
            (lot) =>
              lot.itemId === row.item.id &&
              (scope === "all" || lot.bookScope === scope),
          );
          const qty =
            Math.round(lots.reduce((sum, lot) => sum + lot.qty, 0) * 1000) /
            1000;
          return {
            ...row,
            qty,
            value: lots.reduce((sum, lot) => sum + lot.value, 0),
            lowStock: qty < row.item.reorderLevel,
          };
        })
        .filter((row) => scope === "all" || row.qty !== 0),
    [rows, stock.data, scope],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedRows
      .filter(
        (r) =>
          !q ||
          `${r.item.name} ${r.item.code} ${r.item.hsn}`
            .toLowerCase()
            .includes(q),
      )
      .filter((r) => !lowOnly || r.lowStock)
      .filter((r) => !group || r.item.group === group);
  }, [scopedRows, search, lowOnly, group]);

  const totalValue = scopedRows.reduce((s, r) => s + r.value, 0);
  const lowCount = scopedRows.filter((r) => r.lowStock).length;
  if (!stock.data) return <QueryView query={stock}>{() => null}</QueryView>;

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
        <Summary
          label="Stock value"
          value={formatINR(totalValue, { decimals: false })}
          flex={1.4}
        />
        <Summary label="Items" value={String(scopedRows.length)} divider />
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
                    {altQtyText(r.item, r.qty)
                      ? `${altQtyText(r.item, r.qty)} · `
                      : ""}
                    {formatINR(r.value)}
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
