/**
 * Products and rates between the firm and its parties: a party's products, or
 * a product's suppliers and customers. Rates are per base unit, after the line
 * discount and before GST. Filters run on the device; the lists are small.
 */
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import {
  formatDate,
  formatINR,
  today,
  type PartyType,
  type TradeRate,
} from "@repo/core";
import { Chip, ChipRow, EmptyState, Icon, ListRow, Txt } from "@/components";
import { useGstMode } from "@/data/gstMode";
import {
  NO_TRADE_FILTERS,
  TRADE_PERIODS,
  TRADE_SORTS,
  filterTradeRates,
  rateChange,
  tradeGroups,
  type TradeFilters,
  type TradeView,
} from "@/data/tradeFilters";
import { colors, radius, space } from "@/theme";

export const rateText = (row: Pick<TradeRate, "rate" | "unit">) =>
  `${formatINR(row.rate)} / ${row.unit}`;

const qtyText = (qty: number, unit: string) =>
  `${Math.round(qty * 1000) / 1000} ${unit}`;

/** Search, sort and filters, then the rows. */
export function TradeRateList({
  rows,
  type,
  view,
  emptyTitle,
  emptyMessage,
}: {
  rows: TradeRate[];
  type: PartyType;
  view: TradeView;
  emptyTitle: string;
  emptyMessage: string;
}) {
  const [filters, setFilters] = useState<TradeFilters>(NO_TRADE_FILTERS);
  const set = (patch: Partial<TradeFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  const visible = useMemo(
    () => filterTradeRates(rows, filters, view, today()),
    [rows, filters, view],
  );
  const groups = useMemo(
    () => (view === "party" ? tradeGroups(rows) : []),
    [rows, view],
  );
  const supplier = type === "supplier";

  if (!rows.length)
    return (
      <EmptyState icon="package" title={emptyTitle} message={emptyMessage} />
    );

  return (
    <View style={{ gap: space.md }}>
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
          value={filters.search}
          onChangeText={(search) => set({ search })}
          placeholder={
            view === "party" ? "Search product, code or group" : "Search name"
          }
          placeholderTextColor={colors.mute}
          accessibilityLabel={
            view === "party" ? "Search products" : "Search parties"
          }
          style={{ flex: 1, fontSize: 14, minHeight: 40, color: colors.ink }}
        />
      </View>
      <ChipRow>
        {TRADE_SORTS.map((s) => (
          <Chip
            key={s.key}
            label={s.label}
            selected={filters.sort === s.key}
            onPress={() => set({ sort: s.key })}
          />
        ))}
      </ChipRow>
      <ChipRow>
        {TRADE_PERIODS.map((p) => (
          <Chip
            key={p.key}
            label={p.label}
            selected={filters.period === p.key}
            onPress={() => set({ period: p.key })}
          />
        ))}
        {supplier ? (
          <Chip
            label="In stock"
            selected={filters.inStock}
            onPress={() => set({ inStock: !filters.inStock })}
          />
        ) : null}
      </ChipRow>
      {groups.length > 1 ? (
        <ChipRow>
          <Chip
            label="All groups"
            selected={!filters.group}
            onPress={() => set({ group: null })}
          />
          {groups.map((g) => (
            <Chip
              key={g}
              label={g}
              selected={filters.group === g}
              onPress={() => set({ group: filters.group === g ? null : g })}
            />
          ))}
        </ChipRow>
      ) : null}
      <Txt variant="caption" tone="body">
        {visible.length === rows.length
          ? `${rows.length} ${view === "party" ? "products" : supplier ? "suppliers" : "customers"}`
          : `${visible.length} of ${rows.length} shown`}
        {" · rates per unit, after discount, before GST"}
      </Txt>
      {visible.length === 0 ? (
        <EmptyState
          icon="search"
          title="Nothing matches"
          message="Try a shorter search or clear the filters."
        />
      ) : (
        <View>
          {visible.map((row, i) => (
            <TradeRateRow
              key={`${row.partyId}:${row.itemId}`}
              row={row}
              type={type}
              view={view}
              last={i === visible.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export function TradeRateRow({
  row,
  type,
  view,
  last,
}: {
  row: TradeRate;
  type: PartyType;
  view: TradeView;
  last?: boolean;
}) {
  const gst = useGstMode();
  const supplier = type === "supplier";
  const change = rateChange(row);
  // Two short lines, so a phone shows the stock left without cutting it off.
  const amounts = [
    row.stockQty !== null
      ? `${qtyText(row.stockQty, row.unit)} in stock`
      : null,
    `${qtyText(row.qty, row.unit)} ${supplier ? "bought" : "sold"}`,
  ].filter(Boolean);
  const when = [
    `Last ${formatDate(row.lastDate)}`,
    row.typedRate !== row.rate ? `billed at ${formatINR(row.typedRate)}` : null,
  ].filter(Boolean);
  return (
    <ListRow
      title={view === "party" ? row.itemName : row.partyName}
      subtitle={
        <View>
          <Txt variant="small" tone="body" numberOfLines={1}>
            {amounts.join(" · ")}
          </Txt>
          <Txt variant="caption" tone="body" numberOfLines={1}>
            {when.join(" · ")}
          </Txt>
        </View>
      }
      onPress={() =>
        router.push({
          pathname: "/party/rates/[id]",
          params: { id: row.partyId, itemId: row.itemId },
        })
      }
      right={
        <View style={{ alignItems: "flex-end" }}>
          <Txt variant="bodyStrong" num style={{ fontWeight: "600" }}>
            {rateText(row)}
          </Txt>
          <Txt variant="caption" tone="body" num>
            {gst.on ? `GST ${row.gstRate}%` : ""}
            {change ? (
              <Txt
                variant="caption"
                num
                // A supplier's rise costs us; a customer's rise earns us more.
                tone={change.up === supplier ? "give" : "get"}
              >
                {`${gst.on ? " · " : ""}${change.text}`}
              </Txt>
            ) : null}
          </Txt>
        </View>
      }
      last={last}
    />
  );
}
