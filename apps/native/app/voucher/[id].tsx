import { router, useLocalSearchParams, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { CancelSheet } from "@/forms/CancelSheet";
import { VoucherAttachments } from "@/documents/VoucherAttachments";

/** Button text for turning an estimate / order into something else. */
const CONVERT_LABEL: Record<string, string> = {
  sale: "Make sale invoice",
  purchase: "Make purchase bill",
  "sales-order": "Make sales order",
  "delivery-note": "Make delivery challan",
};
import {
  amountInWords,
  calcLine,
  docTypeLabel,
  isOrderType,
  orderStatus,
  today,
  type VoucherType,
  lineTaxType,
  taxTypeLabel,
  lineQtyText,
  formatDate,
  formatINR,
  type VoucherDetail,
  AUDIT_ACTION_LABEL,
  billsCarryGst,
  COMPOSITION_DECLARATION,
  sideOf,
  voucherMode,
  type AuditEntry,
} from "@repo/core";
import {
  Badge,
  Button,
  Card,
  FooterBar,
  Header,
  IconButton,
  KeyValue,
  ListRow,
  Notice,
  Money,
  PostingTable,
  QueryView,
  Screen,
  Txt,
  SectionHeader,
} from "@/components";
import {
  paymentModeLabel,
  paymentModeShort,
  orderStatusBadge,
  voucherBadge,
  voucherTypeLabel,
} from "@/data/labels";
import { useVoucher } from "@/data/queries";
import { colors, space } from "@/theme";
import { formatDateTime } from "@/data/format";

/** Detail of any voucher: summary, items/allocations, totals and ledger posting. */
export default function VoucherScreen() {
  // `also` is set when saving split a bill into GST goods and non-GST goods
  const { id, also } = useLocalSearchParams<{ id: string; also?: string }>();
  const voucher = useVoucher(id);
  const other = useVoucher(also ?? "");
  const v = voucher.data?.voucher;
  const isInvoice = v?.type === "sale" || v?.type === "purchase";
  const due = v && isInvoice ? v.amount - (voucher.data?.settled ?? 0) : 0;

  return (
    <Screen
      header={
        <Header
          title={v?.number ?? "Voucher"}
          subtitle={
            v
              ? `${voucherTypeLabel[v.type]} · ${formatDate(v.date)}`
              : undefined
          }
          right={
            v ? (
              <IconButton
                icon="share-2"
                label="Share"
                onPress={() => router.push(`/print/${v.id}`)}
              />
            ) : null
          }
        />
      }
      footer={
        v && isInvoice && v.status === "posted" && due > 0 ? (
          <FooterBar>
            <View style={{ flex: 1 }}>
              <Money value={due} variant="heading" />
              <Txt variant="caption" tone="body">
                Balance due
              </Txt>
            </View>
            <Button
              label="Record payment"
              variant="primary"
              onPress={() =>
                router.push({
                  pathname: v.type === "sale" ? "/receipt/new" : "/payment/new",
                  params: { partyId: v.partyId },
                })
              }
            />
          </FooterBar>
        ) : null
      }
    >
      {other.data ? (
        <Card
          variant="soft"
          onPress={() => router.replace(`/voucher/${other.data!.voucher.id}`)}
        >
          <Txt variant="small">
            Non-GST goods were saved on a separate bill{" "}
            <Txt variant="small" style={{ fontWeight: "600" }}>
              {other.data.voucher.number}
            </Txt>{" "}
            for {formatINR(other.data.voucher.amount)}. Tap to open.
          </Txt>
        </Card>
      ) : null}
      <QueryView query={voucher}>{(d) => <VoucherBody d={d} />}</QueryView>
    </Screen>
  );
}

function VoucherBody({ d }: { d: VoucherDetail }) {
  const v = d.voucher;
  const badge = voucherBadge(v);
  const isInvoice = v.type === "sale" || v.type === "purchase";
  const isNote = v.type === "credit-note" || v.type === "debit-note";
  const isOrder = isOrderType(v.type);
  const status = isOrder ? orderStatus(v, today()) : undefined;
  // GST shows only on bills that carry it (not composition sales or firms without GST)
  const carriesGst =
    v.bookScope !== "nongst" &&
    billsCarryGst(voucherMode(v), sideOf(v.type) ?? "sale");
  const [cancelling, setCancelling] = useState(false);
  // Part of what's settled that came from returns rather than money
  const returnedAmount = d.payments
    .filter((p) => p.type === "credit-note" || p.type === "debit-note")
    .reduce(
      (s, p) =>
        s +
        (p.allocations ?? [])
          .filter((a) => a.voucherId === v.id)
          .reduce((x, a) => x + a.amount, 0),
      0,
    );
  const itemName = (id: string) => d.items.find((i) => i.id === id)?.name ?? id;
  const itemUnit = (id: string) => d.items.find((i) => i.id === id)?.unit ?? "";

  /** Show why an action isn't allowed, or run it. */
  const [blocked, setBlocked] = useState<string | null>(null);
  const guard = (blocker: string | null, run: () => void) => {
    setBlocked(blocker);
    if (!blocker) run();
  };

  return (
    <>
      {v.status === "cancelled" ? (
        <Notice
          text={`Cancelled${v.cancelledAt ? ` on ${formatDate(v.cancelledAt.slice(0, 10))}` : ""}${v.cancelReason ? ` · ${v.cancelReason}` : ""}. It no longer counts anywhere.`}
        />
      ) : null}
      {isNote && d.against ? (
        <Card
          variant="soft"
          onPress={() => router.push(`/voucher/${d.against!.id}`)}
        >
          <Txt variant="small">
            {v.type === "credit-note" ? "Sales return" : "Purchase return"}{" "}
            against{" "}
            <Txt variant="small" style={{ fontWeight: "600" }}>
              {d.against.number}
            </Txt>
            {v.noteReason ? ` · ${v.noteReason}` : ""}. Tap to open the bill.
          </Txt>
        </Card>
      ) : null}
      {d.source ? (
        <Card
          variant="soft"
          onPress={() => router.push(`/voucher/${d.source!.id}`)}
        >
          <Txt variant="small">
            Made from{" "}
            {voucherTypeLabel[d.source.type as VoucherType].toLowerCase()}{" "}
            <Txt variant="small" style={{ fontWeight: "600" }}>
              {d.source.number}
            </Txt>
            . Tap to open.
          </Txt>
        </Card>
      ) : null}
      {d.convertedTo ? (
        <Card
          variant="soft"
          onPress={() => router.push(`/voucher/${d.convertedTo!.id}`)}
        >
          <Txt variant="small">
            Turned into{" "}
            {voucherTypeLabel[d.convertedTo.type as VoucherType].toLowerCase()}{" "}
            <Txt variant="small" style={{ fontWeight: "600" }}>
              {d.convertedTo.number}
            </Txt>
            . Tap to open.
          </Txt>
        </Card>
      ) : null}
      {isOrder && d.canConvertTo.length > 0 ? (
        <View style={{ gap: space.sm }}>
          {d.canConvertTo.map((t, i) => (
            <Button
              key={t}
              label={CONVERT_LABEL[t]}
              icon="arrow-right"
              variant={i === 0 ? "primary" : "secondary"}
              block
              onPress={() =>
                router.push(
                  `/order/fulfill?id=${v.id}&target=${t}` as Href,
                )
              }
            />
          ))}
        </View>
      ) : null}
      {v.status === "posted" ? (
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          {isOrder && !v.convertedToId ? (
            <Button
              label="Edit"
              size="sm"
              icon="edit-2"
              onPress={() =>
                guard(d.editBlocker, () =>
                  router.push(`/order/edit/${v.id}` as Href),
                )
              }
            />
          ) : null}
          {isInvoice ? (
            <>
              <Button
                label="Edit"
                size="sm"
                icon="edit-2"
                onPress={() =>
                  guard(d.editBlocker, () =>
                    router.push(`/${v.type}/edit/${v.id}` as Href),
                  )
                }
              />
              <Button
                label="Return"
                size="sm"
                icon={v.type === "sale" ? "corner-up-left" : "corner-up-right"}
                onPress={() =>
                  router.push(
                    `/note/new?kind=${v.type === "sale" ? "credit" : "debit"}&against=${v.id}` as Href,
                  )
                }
              />
            </>
          ) : null}
          <Button
            label="Cancel"
            size="sm"
            icon="x-circle"
            variant="danger"
            onPress={() => guard(d.cancelBlocker, () => setCancelling(true))}
          />
        </View>
      ) : null}
      {blocked ? <Notice text={blocked} /> : null}
      <CancelSheet
        visible={cancelling}
        voucherId={v.id}
        number={v.number}
        version={v.version}
        onClose={() => setCancelling(false)}
      />
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Badge label={voucherTypeLabel[v.type]} />
          {status && status !== "cancelled" ? (
            <Badge
              label={orderStatusBadge[status].label}
              tone={orderStatusBadge[status].tone}
            />
          ) : null}
          {v.docType ? (
            <Badge label={docTypeLabel(v.docType)} tone="ink" />
          ) : null}
          <Badge
            label={
              v.status === "posted"
                ? "Posted"
                : v.status === "draft"
                  ? "Draft"
                  : "Cancelled"
            }
            tone={
              v.status === "cancelled"
                ? "bad"
                : v.status === "draft"
                  ? "dashed"
                  : "neutral"
            }
          />
          {badge && v.pendingSync ? (
            <Badge label={badge.label} tone={badge.tone} />
          ) : null}
        </View>
        {d.party ? (
          <Txt
            variant="heading"
            onPress={() => router.push(`/party/${d.party!.id}`)}
          >
            {d.party.name}
          </Txt>
        ) : (
          <Txt variant="heading">
            {v.type === "journal"
              ? "Journal entry"
              : v.type === "contra"
                ? "Money moved between accounts"
                : (v.expenseHead ?? "Expense")}
          </Txt>
        )}
        {v.supplierInvoiceNo ? (
          <Txt variant="small" tone="body">
            Supplier invoice <Txt variant="mono">{v.supplierInvoiceNo}</Txt>
          </Txt>
        ) : null}
        <Money
          value={v.amount}
          variant="display"
          style={
            v.status === "cancelled" && {
              textDecorationLine: "line-through",
              color: colors.body,
            }
          }
        />
        <Txt variant="small" tone="body">
          {amountInWords(v.amount)}
        </Txt>
      </View>

      {(isInvoice || isNote || isOrder) && d.totals ? (
        <>
          <View style={{ gap: space.sm }}>
            <Txt variant="heading">Items · {v.lines?.length ?? 0}</Txt>
            {(v.lines ?? []).map((line, i) => {
              const t = calcLine(line, !!v.interState);
              return (
                <Card key={i} style={{ paddingVertical: space.md }}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: space.sm,
                    }}
                  >
                    <Txt variant="bodyStrong" style={{ flex: 1 }}>
                      {itemName(line.itemId)}
                    </Txt>
                    <Money
                      value={t.total}
                      variant="bodyStrong"
                      style={{ fontWeight: "600" }}
                    />
                  </View>
                  <Txt variant="small" tone="charcoal" num>
                    {lineQtyText(line, itemUnit(line.itemId)).main} ×{" "}
                    {formatINR(line.rate)}
                    {line.per
                      ? ` (${lineQtyText(line, itemUnit(line.itemId)).base})`
                      : ""}
                    {t.discount ? ` · discount ${formatINR(t.discount)}` : ""}
                  </Txt>
                  {carriesGst ? (
                    <Txt variant="caption" tone="body" num>
                      {lineTaxType(line) === "taxable"
                        ? `Taxable ${formatINR(t.taxable)} · GST ${line.gstRate}% ${formatINR(t.tax)}`
                        : `${taxTypeLabel(lineTaxType(line))} · no GST`}
                    </Txt>
                  ) : null}
                </Card>
              );
            })}
          </View>

          <Card style={{ gap: 0 }}>
            {(v.charges ?? []).map((c) => (
              <KeyValue
                key={c.name}
                label={carriesGst ? `${c.name} (GST ${c.gstRate}%)` : c.name}
                value={formatINR(c.amount)}
              />
            ))}
            <KeyValue
              label={carriesGst ? "Taxable value" : "Sub total"}
              value={formatINR(d.totals.taxable)}
            />
            {!carriesGst ? null : v.interState ? (
              <KeyValue label="IGST" value={formatINR(d.totals.igst)} />
            ) : (
              <>
                <KeyValue label="CGST" value={formatINR(d.totals.cgst)} />
                <KeyValue label="SGST" value={formatINR(d.totals.sgst)} />
              </>
            )}
            <KeyValue label="Round off" value={formatINR(d.totals.roundOff)} />
            <KeyValue
              label="Total"
              value={formatINR(d.totals.grandTotal)}
              strong
            />
            {isNote && v.status === "posted" ? (
              <KeyValue
                label={`Adjusted against ${d.against?.number ?? "bill"}`}
                value={formatINR(
                  (v.allocations ?? []).reduce((s, a) => s + a.amount, 0),
                )}
              />
            ) : null}
            {isInvoice && v.status === "posted" ? (
              <>
                <KeyValue
                  label={v.type === "sale" ? "Received" : "Paid"}
                  value={formatINR(d.settled - returnedAmount)}
                />
                {returnedAmount ? (
                  <KeyValue
                    label="Returned (credit / debit notes)"
                    value={formatINR(returnedAmount)}
                  />
                ) : null}
                <KeyValue
                  label="Balance due"
                  value={formatINR(v.amount - d.settled)}
                  strong
                />
                {v.dueDate ? (
                  <KeyValue label="Due date" value={formatDate(v.dueDate)} />
                ) : null}
              </>
            ) : null}
          </Card>

          {d.payments.length > 0 ? (
            <View>
              <Txt variant="heading" style={{ marginBottom: space.xs }}>
                {d.returns.length ? "Payments and returns" : "Payments"}
              </Txt>
              {d.payments.map((p, i) => (
                <ListRow
                  key={p.id}
                  title={`${p.number} · ${p.mode ? paymentModeShort[p.mode] : voucherTypeLabel[p.type]}`}
                  subtitle={formatDate(p.date)}
                  onPress={() => router.push(`/voucher/${p.id}`)}
                  right={
                    <Money
                      value={
                        p.allocations?.find((a) => a.voucherId === v.id)
                          ?.amount ?? 0
                      }
                      variant="bodyStrong"
                      tone={v.type === "sale" ? "get" : "ink"}
                    />
                  }
                  last={i === d.payments.length - 1}
                />
              ))}
            </View>
          ) : null}
        </>
      ) : v.type === "journal" ? null : v.type === "contra" ? (
        <Card style={{ gap: 0 }}>
          <KeyValue label="From" value={d.ledgerName ?? ""} />
          <KeyValue label="To" value={d.toLedgerName ?? ""} />
          {v.reference ? (
            <KeyValue label="Reference" value={v.reference} />
          ) : null}
        </Card>
      ) : (
        <Card style={{ gap: 0 }}>
          {v.mode ? (
            <KeyValue label="Mode" value={paymentModeLabel[v.mode]} />
          ) : null}
          {d.ledgerName ? (
            <KeyValue
              label={v.type === "receipt" ? "Deposited to" : "Paid from"}
              value={d.ledgerName}
            />
          ) : null}
          {v.reference ? (
            <KeyValue label="Reference" value={v.reference} />
          ) : null}
          {v.tds ? (
            <>
              <KeyValue
                label="Bill amount settled"
                value={formatINR(v.amount + v.tds.amount)}
              />
              <KeyValue
                label={`TDS ${v.tds.section} @ ${v.tds.rate}%`}
                value={`−${formatINR(v.tds.amount)}`}
              />
              <KeyValue label="Net paid" value={formatINR(v.amount)} strong />
            </>
          ) : null}
          {d.allocatedTo.map((a) => (
            <KeyValue
              key={a.voucherId}
              label={`Against ${a.number}`}
              value={formatINR(a.amount)}
            />
          ))}
          {d.allocatedTo.length > 0 &&
          d.allocatedTo.reduce((s, a) => s + a.amount, 0) <
            v.amount + (v.tds?.amount ?? 0) ? (
            <KeyValue
              label="On account"
              value={formatINR(
                v.amount +
                  (v.tds?.amount ?? 0) -
                  d.allocatedTo.reduce((s, a) => s + a.amount, 0),
              )}
            />
          ) : null}
        </Card>
      )}

      {v.narration ? (
        <Txt variant="small" tone="charcoal">
          {v.narration}
        </Txt>
      ) : null}

      {voucherMode(v) === "composition" && sideOf(v.type) === "sale" ? (
        <Txt variant="caption" tone="body">
          {COMPOSITION_DECLARATION}
        </Txt>
      ) : null}

      <VoucherAttachments key={v.id} voucherId={v.id} />
      {isOrder ? null : <PostingTable rows={d.postings} />}

      <History entries={d.history} />
    </>
  );
}

/** Edit history (audit trail): who created, changed or cancelled this entry, and what changed. */
function History({ entries }: { entries: AuditEntry[] }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0)
    return (
      <Txt variant="caption" tone="body">
        No edit history (entered before the edit log started).
      </Txt>
    );
  const shown = open
    ? [...entries].reverse()
    : [...entries].reverse().slice(0, 3);
  return (
    <View style={{ gap: space.sm }}>
      <SectionHeader
        title="History"
        action={
          entries.length > 3
            ? open
              ? "Show less"
              : `All ${entries.length}`
            : undefined
        }
        onAction={() => setOpen(!open)}
      />
      {shown.map((e) => (
        <View
          key={e.id}
          style={{
            borderLeftWidth: 2,
            borderLeftColor:
              e.action === "cancelled" ? colors.give : colors.hairlineStrong,
            paddingLeft: space.md,
            gap: 2,
          }}
        >
          <Txt variant="small" style={{ fontWeight: "600" }}>
            {AUDIT_ACTION_LABEL[e.action]} · {e.userName}
          </Txt>
          <Txt variant="caption" tone="body">
            {formatDateTime(e.at)}
            {e.note ? ` · ${e.note}` : ""}
          </Txt>
          {e.changes.map((c) => (
            <Txt key={c.field} variant="caption" tone="charcoal">
              {c.field}: {c.before} → {c.after}
            </Txt>
          ))}
        </View>
      ))}
      <Txt variant="caption" tone="body">
        Every change is kept and can't be deleted.
      </Txt>
    </View>
  );
}
