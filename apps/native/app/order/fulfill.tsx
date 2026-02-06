import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatINR, today } from "@repo/core";
import {
  OrderFulfillmentInput,
  type OrderFulfillmentDetail,
  type OrderFulfillmentResult,
} from "@repo/contracts/src/orderFulfillment";
import {
  Button,
  Checkbox,
  DateField,
  EmptyState,
  Header,
  IconButton,
  PickerSheet,
  QueryView,
  Screen,
  Segmented,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import {
  useFulfillOrder,
  useOrderFulfillment,
  useOrderFulfillmentAccess,
} from "@/data/orderFulfillmentHooks";
import { quantityInput } from "@/data/quantityInput";
import {
  useApproveOrderCredit,
  useSettlementAccess,
} from "@/data/settlementHooks";
import { ApiFailure } from "@/auth/api";
import { colors, space } from "@/theme";

const labels = {
  sale: "Sale invoice",
  purchase: "Purchase bill",
  "sales-order": "Sales order",
  "delivery-note": "Delivery note",
};

export default function FulfillOrder() {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const access = useOrderFulfillmentAccess();
  const query = useOrderFulfillment(id);
  const [result, setResult] = useState<OrderFulfillmentResult | null>(null);
  return (
    <Screen header={<Header close title="Fulfill order" />}>
      {!access.connected ? (
        <EmptyState title="Sign in to a connected firm" />
      ) : !id ? (
        <EmptyState title="Choose an order" />
      ) : (
        <QueryView query={query}>
          {(detail) => (
            <View style={{ gap: space.xl }}>
              {result ? (
                <View style={{ gap: space.sm }}>
                  <Txt variant="heading">Entries saved</Txt>
                  {result.vouchers.map((v) => (
                    <View
                      key={v.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.sm,
                      }}
                    >
                      <Txt style={{ flex: 1 }}>{v.number}</Txt>
                      <IconButton
                        key={v.id}
                        icon="arrow-up-right"
                        label={`Open ${v.number}`}
                        onPress={() => router.push(`/voucher/${v.id}`)}
                      />
                    </View>
                  ))}
                </View>
              ) : null}
              <OrderForm
                key={`${detail.source.id}:${detail.source.version}`}
                detail={detail}
                writable={
                  detail.source.type === "purchase-order"
                    ? access.purchase
                    : access.sales
                }
                onSaved={setResult}
                reload={() => {
                  void query.refetch();
                }}
              />
            </View>
          )}
        </QueryView>
      )}
    </Screen>
  );
}

function OrderForm({
  detail,
  writable,
  onSaved,
  reload,
}: {
  detail: OrderFulfillmentDetail;
  writable: boolean;
  onSaved: (result: OrderFulfillmentResult) => void;
  reload: () => void;
}) {
  const [target, setTarget] = useState<OrderFulfillmentInput["target"]>(
    detail.targets[0] ?? "sale",
  );
  const [date, setDate] = useState(today());
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<string | null>(null);
  const [narration, setNarration] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creditRequest, setCreditRequest] = useState<string | null>(null);
  const [creditReason, setCreditReason] = useState("");
  const approveCredit = useApproveOrderCredit();
  const settlementAccess = useSettlementAccess();
  const mutation = useFulfillOrder(detail.source.id);
  const needsStock =
    (target === "sale" || target === "delivery-note") &&
    detail.source.type !== "delivery-note";
  const selected = detail.lines.filter(
    (row) => Number(quantities[row.id] || 0) > 0,
  );
  const candidates = (itemId: string) =>
    detail.lots.filter((lot) => lot.itemId === itemId && lot.date <= date);
  const lotFor = (row: OrderFulfillmentDetail["lines"][number]) =>
    lots[row.id] ??
    row.line.stockLotId ??
    (candidates(row.line.itemId).length === 1
      ? candidates(row.line.itemId)[0].id
      : undefined);
  const parsed = OrderFulfillmentInput.safeParse({
    version: detail.source.version,
    target,
    date,
    narration,
    ...(target === "purchase" ? { supplierInvoiceNo } : {}),
    lines: selected.map((row) => ({
      sourceLineId: row.id,
      qty: Number(quantities[row.id]),
      ...(needsStock && lotFor(row) ? { stockLotId: lotFor(row) } : {}),
    })),
  });
  const tooMuch = selected.some(
    (row) => Number(quantities[row.id]) > row.remainingQty,
  );
  const missingLot = needsStock && selected.some((row) => !lotFor(row));
  const canSave =
    writable &&
    detail.targets.length > 0 &&
    !detail.blockedReason &&
    parsed.success &&
    !tooMuch &&
    !missingLot;
  const pickerLine = detail.lines.find((row) => row.id === picker);
  const requestKey = parsed.success ? JSON.stringify(parsed.data) : null;
  const needsApproval =
    target === "sale" && !!requestKey && creditRequest === requestKey;
  const save = async () => {
    if (
      !canSave ||
      !parsed.success ||
      mutation.isPending ||
      approveCredit.isPending
    )
      return;
    setError(null);
    try {
      const approval =
        needsApproval && settlementAccess.owner
          ? await approveCredit.mutateAsync({
              sourceId: detail.source.id,
              fulfillment: parsed.data,
              reason: creditReason.trim(),
            })
          : undefined;
      onSaved(
        await mutation.mutateAsync({
          ...parsed.data,
          ...(approval ? { creditOverrideId: approval.id } : {}),
        }),
      );
    } catch (failure) {
      if (
        failure instanceof ApiFailure &&
        failure.code === "CREDIT_LIMIT_EXCEEDED"
      )
        setCreditRequest(requestKey);
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save the fulfillment.",
      );
      showError("Couldn't fulfill order", failure);
    }
  };
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.xs }}>
        <Txt variant="heading">{detail.source.number}</Txt>
        <Txt>{detail.source.partyName}</Txt>
        <Txt variant="caption">
          {detail.source.date} | {detail.source.status}
        </Txt>
      </View>
      {detail.blockedReason ? (
        <Txt tone="give">{detail.blockedReason}</Txt>
      ) : null}
      {detail.targets.length > 1 ? (
        <Segmented
          value={target}
          onChange={setTarget}
          options={detail.targets.map((value) => ({
            value,
            label: labels[value],
          }))}
        />
      ) : detail.targets.length === 1 ? (
        <Txt>{labels[target]}</Txt>
      ) : null}
      {writable && detail.targets.length > 0 ? (
        <DateField label="Entry date" value={date} onChange={setDate} />
      ) : null}
      {detail.lines.map((row) => {
        const qty = Number(quantities[row.id] || 0);
        const lot = detail.lots.find((l) => l.id === lotFor(row));
        const enabled =
          writable &&
          row.remainingQty > 0 &&
          detail.targets.length > 0 &&
          !detail.blockedReason;
        return (
          <View
            key={row.id}
            style={{
              borderTopWidth: 1,
              borderColor: colors.hairline,
              paddingTop: space.lg,
              gap: space.sm,
            }}
          >
            <Checkbox
              label={`${row.position + 1}. ${row.itemName}`}
              checked={qty > 0}
              onChange={(checked) => {
                if (enabled && !mutation.isPending)
                  setQuantities((current) => ({
                    ...current,
                    [row.id]: checked ? String(row.remainingQty) : "",
                  }));
              }}
            />
            <Txt variant="small">
              Ordered {row.line.qty} | Fulfilled {row.consumedQty} | Remaining{" "}
              {row.remainingQty} {row.unit}
            </Txt>
            {row.returnedQty ? (
              <Txt variant="small">
                Returned {row.returnedQty} {row.unit}
              </Txt>
            ) : null}
            <Txt variant="caption">
              Rate {formatINR(row.line.rate)} / {row.unit} | GST{" "}
              {row.line.gstRate}%
            </Txt>
            {enabled ? (
              <TextField
                label={`Quantity (${row.unit})`}
                value={quantities[row.id] ?? ""}
                keyboardType="decimal-pad"
                onChangeText={(value) =>
                  setQuantities((current) => ({
                    ...current,
                    [row.id]: quantityInput(value),
                  }))
                }
                editable={!mutation.isPending}
              />
            ) : null}
            {qty > row.remainingQty ? (
              <Txt tone="give">
                Quantity exceeds the remaining {row.remainingQty}.
              </Txt>
            ) : null}
            {enabled && needsStock && qty > 0 ? (
              <SelectField
                label="Stock lot"
                value={
                  lot
                    ? `${lot.number} | ${lot.bookScope === "gst" ? "GST" : "Non-GST"} | ${lot.qty} base units`
                    : undefined
                }
                onPress={() => setPicker(row.id)}
              />
            ) : null}
          </View>
        );
      })}
      {writable && detail.targets.length > 0 ? (
        <>
          {target === "purchase" ? (
            <TextField
              label="Supplier invoice number"
              value={supplierInvoiceNo}
              onChangeText={setSupplierInvoiceNo}
              maxLength={100}
              editable={!mutation.isPending}
            />
          ) : null}
          <TextField
            label="Narration"
            value={narration}
            onChangeText={setNarration}
            multiline
            maxLength={1000}
            editable={!mutation.isPending}
          />
          {missingLot ? (
            <Txt tone="give">Choose a stock lot for each selected item.</Txt>
          ) : null}
          {error ? (
            <View style={{ gap: space.sm }}>
              <Txt tone="give">{error}</Txt>
              <Button icon="refresh-cw" label="Reload order" onPress={reload} />
            </View>
          ) : null}
          {needsApproval && settlementAccess.owner ? (
            <TextField
              label="Credit-limit approval reason"
              value={creditReason}
              onChangeText={setCreditReason}
              maxLength={500}
              multiline
              editable={!approveCredit.isPending && !mutation.isPending}
            />
          ) : null}
          <Button
            icon="check"
            variant="primary"
            label={
              needsApproval && settlementAccess.owner
                ? "Approve credit and create invoice"
                : `Create ${labels[target].toLowerCase()}`
            }
            loading={mutation.isPending || approveCredit.isPending}
            disabled={
              !canSave ||
              (needsApproval &&
                (!settlementAccess.owner || creditReason.trim().length < 3))
            }
            onPress={save}
          />
        </>
      ) : null}
      {detail.history.length ? (
        <View style={{ gap: space.md }}>
          <Txt variant="heading">Fulfillment history</Txt>
          {detail.history.map((entry) => (
            <View
              key={entry.id}
              style={{
                gap: space.xs,
                borderTopWidth: 1,
                borderColor: colors.hairline,
                paddingTop: space.md,
              }}
            >
              <Txt variant="caption">
                {entry.date} | {entry.userName}
              </Txt>
              {entry.vouchers.map((v) => (
                <View
                  key={v.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  <View style={{ flex: 1, gap: space.xs }}>
                    <Txt>{v.number}</Txt>
                    <Txt variant="caption">
                      {v.status} | {formatINR(v.amount)}
                    </Txt>
                  </View>
                  <IconButton
                    icon="arrow-up-right"
                    label={`Open ${v.number}`}
                    onPress={() => router.push(`/voucher/${v.id}`)}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <PickerSheet
        visible={!!pickerLine}
        title="Stock lot"
        options={
          pickerLine
            ? candidates(pickerLine.line.itemId).map((lot) => ({
                id: lot.id,
                title: lot.number,
                subtitle: `${lot.bookScope === "gst" ? "GST" : "Non-GST"} | ${lot.qty} base units`,
              }))
            : []
        }
        onSelect={(id) => {
          if (picker) setLots((current) => ({ ...current, [picker]: id }));
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}
