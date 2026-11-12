import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  formatDate,
  formatINR,
  altQtyText,
  itemTaxType,
  taxTypeLabel,
  formatQty,
  type ItemDetail,
} from "@repo/core";
import {
  Avatar,
  Badge,
  Card,
  Header,
  IconButton,
  KeyValue,
  ListRow,
  QueryView,
  Screen,
  Segmented,
  Txt,
} from "@/components";
import { useItem, useItemParties, useStockLots } from "@/data/queries";
import { TradeRateList } from "@/lists/TradeRateList";
import { space } from "@/theme";
import { useGstMode } from "@/data/gstMode";

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useItem(id);
  return (
    <Screen
      header={
        <Header
          title="Item"
          right={
            <IconButton
              icon="edit-2"
              label="Edit item"
              onPress={() => router.push(`/item/edit/${id}`)}
            />
          }
        />
      }
      onRefresh={() => item.refetch()}
      refreshing={item.isRefetching}
    >
      <QueryView query={item}>{(d) => <ItemBody d={d} />}</QueryView>
    </Screen>
  );
}

function ItemBody({ d }: { d: ItemDetail }) {
  const stock = useStockLots();
  const gst = useGstMode();
  const { item } = d;
  const margin =
    d.profit.salesValue > 0
      ? ((d.profit.profit / d.profit.salesValue) * 100).toFixed(1)
      : "0.0";
  return (
    <>
      <View style={{ flexDirection: "row", gap: 14 }}>
        <Avatar icon="package" size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="title">{item.name}</Txt>
          <Txt variant="small" tone="body">
            {item.group}
          </Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Badge label={item.code} />
            {gst.on && item.hsn ? <Badge label={`HSN ${item.hsn}`} /> : null}
            {gst.on ? (
              <Badge
                label={
                  itemTaxType(item) === "taxable"
                    ? `GST ${item.gstRate}%`
                    : taxTypeLabel(itemTaxType(item))
                }
              />
            ) : null}
            {d.lowStock ? <Badge label="Low stock" tone="warn" /> : null}
          </View>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: space.md }}>
        <Card style={{ flex: 1 }}>
          <Txt variant="small" tone="body">
            In stock
          </Txt>
          <Txt variant="title" num tone={d.lowStock ? "warn" : "ink"}>
            {d.qty} {item.unit}
          </Txt>
          {altQtyText(item, d.qty) ? (
            <Txt variant="caption" tone="body" num>
              {altQtyText(item, d.qty)}
            </Txt>
          ) : null}
          <Txt variant="caption" tone="body">
            Reorder at {item.reorderLevel}
          </Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Txt variant="small" tone="body">
            Stock value
          </Txt>
          <Txt variant="title" num adjustsFontSizeToFit numberOfLines={1}>
            {formatINR(d.value, { decimals: false })}
          </Txt>
          <Txt variant="caption" tone="body">
            at historical lot cost
          </Txt>
        </Card>
      </View>

      <ItemPartiesSection itemId={item.id} unit={item.unit} />

      <View>
        <Txt variant="heading">Stock lots</Txt>
        <QueryView query={stock}>
          {(lots) => (
            <>
              {lots
                .filter((l) => l.itemId === item.id && l.qty !== 0)
                .map((lot) => (
                  <ListRow
                    key={lot.id}
                    title={`${lot.bookScope === "gst" ? "GST" : "Non-GST"} | ${lot.number}`}
                    subtitle={`${lot.qty} ${item.unit} | Cost ${formatINR(Math.round(lot.unitCost))} / ${item.unit}`}
                    right={<Txt>{formatINR(lot.value)}</Txt>}
                  />
                ))}
            </>
          )}
        </QueryView>
      </View>
      <View>
        <Txt variant="heading" style={{ marginBottom: space.xs }}>
          Prices and units
        </Txt>
        <KeyValue
          label="Purchase price"
          value={formatINR(item.purchasePrice)}
        />
        <KeyValue label="Sale price" value={formatINR(item.salePrice)} />
        <KeyValue label="MRP" value={formatINR(item.mrp)} />
        <KeyValue
          label="Unit"
          value={
            item.altUnit
              ? `${item.unit} · 1 ${item.altUnit.name} = ${item.altUnit.factor} ${item.unit}`
              : item.unit
          }
        />
        <KeyValue label="Stock in units" value={formatQty(item, d.qty)} />
        {item.batch ? (
          <KeyValue
            label={`Batch ${item.batch.number}`}
            value={`Expires ${formatDate(item.batch.expiry)}`}
          />
        ) : null}
      </View>

      <Card style={{ gap: space.xs }}>
        <Txt variant="heading">Profit so far</Txt>
        <KeyValue label="Sold" value={`${d.profit.soldQty} ${item.unit}`} />
        <KeyValue label="Sales value" value={formatINR(d.profit.salesValue)} />
        <KeyValue
          label="Historical cost of goods sold"
          value={formatINR(d.profit.cost)}
        />
        <KeyValue
          label="Gross profit"
          value={`${formatINR(d.profit.profit)} · ${margin}%`}
          strong
        />
      </Card>

      <View>
        <Txt variant="heading" style={{ marginBottom: space.xs }}>
          Stock movements
        </Txt>
        {d.movements.length === 0 ? (
          <Txt variant="small" tone="body">
            No movements yet.
          </Txt>
        ) : (
          d.movements.slice(0, 20).map((m, i, list) => (
            <ListRow
              key={`${m.voucherId}-${i}`}
              title={m.number}
              subtitle={`${m.type === "sale" ? "Sale" : "Purchase"} · ${formatDate(m.date)}${m.entered ? ` · billed as ${m.entered}` : ""}`}
              onPress={() => router.push(`/voucher/${m.voucherId}`)}
              right={
                <Txt
                  variant="bodyStrong"
                  num
                  tone={m.qty > 0 ? "get" : "give"}
                  style={{ fontWeight: "600" }}
                >
                  {m.qty > 0 ? "+" : "−"}
                  {Math.abs(m.qty)} {item.unit}
                </Txt>
              }
              last={i === list.length - 1}
            />
          ))
        )}
      </View>
    </>
  );
}

/** Who supplies this product (rate, stock left from each) and who buys it. */
function ItemPartiesSection({
  itemId,
  unit,
}: {
  itemId: string;
  unit: string;
}) {
  const parties = useItemParties(itemId);
  const [tab, setTab] = useState<"supplier" | "customer">("supplier");
  return (
    <View style={{ gap: space.md }}>
      <Txt variant="heading">Suppliers and customers</Txt>
      <QueryView query={parties}>
        {({ suppliers, customers, openingStock }) => {
          // Sales staff don't see purchase rates: customers only.
          const shown = suppliers ? tab : "customer";
          return (
            <>
              {suppliers && customers ? (
                <Segmented
                  options={[
                    {
                      value: "supplier",
                      label: `Suppliers · ${suppliers.length}`,
                    },
                    {
                      value: "customer",
                      label: `Customers · ${customers.length}`,
                    },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
              ) : null}
              {shown === "supplier" && openingStock && openingStock.qty > 0 ? (
                <Txt variant="caption" tone="body">
                  {`Opening stock, no supplier: ${openingStock.qty} ${unit} on hand.`}
                </Txt>
              ) : null}
              <TradeRateList
                key={shown}
                rows={(shown === "supplier" ? suppliers : customers) ?? []}
                type={shown}
                view="item"
                emptyTitle={
                  shown === "supplier" ? "No purchases yet" : "No sales yet"
                }
                emptyMessage={
                  shown === "supplier"
                    ? "Suppliers appear here after the first purchase bill with this product."
                    : "Customers appear here after the first sale invoice with this product."
                }
              />
            </>
          );
        }}
      </QueryView>
    </View>
  );
}
