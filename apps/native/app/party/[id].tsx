import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import {
  canSeeCosts,
  formatDate,
  formatINR,
  type PartyDetail,
  count,
} from "@repo/core";
import { isOpeningBillId } from "@repo/core/src/accounting/openingImport";
import {
  Avatar,
  Badge,
  Button,
  Card,
  FooterBar,
  Header,
  IconButton,
  Icon,
  KeyValue,
  ListRow,
  Money,
  Notice,
  QueryView,
  Screen,
  Segmented,
  Txt,
  showError,
  type IconName,
} from "@/components";
import { voucherBadge, voucherTypeLabel, stateName } from "@/data/labels";
import { useParty, useAllocatePayments } from "@/data/queries";
import { confirmAction } from "@/data/confirm";
import { callPhone, openWhatsApp, useSendReminder } from "@/data/share";
import { colors, radius, space } from "@/theme";
import { useGstMode } from "@/data/gstMode";
import { useData } from "@/data/DataProvider";

export default function PartyScreen() {
  const sendReminder = useSendReminder();
  const { id } = useLocalSearchParams<{ id: string }>();
  const party = useParty(id);
  const isCustomer = party.data?.party.type === "customer";

  return (
    <Screen
      header={
        <Header
          title="Party"
          right={
            <IconButton
              icon="edit-2"
              label="Edit party"
              onPress={() => router.push(`/party/edit/${id}`)}
            />
          }
        />
      }
      onRefresh={() => party.refetch()}
      refreshing={party.isRefetching}
      footer={
        party.data && isCustomer ? (
          <FooterBar>
            <Button
              label="Send reminder"
              disabled={party.data.balance <= 0}
              block
              onPress={() => sendReminder(party.data.party.id)}
            />
            <Button
              label="Receive payment"
              variant="primary"
              block
              onPress={() =>
                router.push({
                  pathname: "/receipt/new",
                  params: { partyId: id },
                })
              }
            />
          </FooterBar>
        ) : party.data ? (
          <FooterBar>
            <Button
              label="New purchase"
              block
              onPress={() =>
                router.push({
                  pathname: "/purchase/new",
                  params: { partyId: id },
                })
              }
            />
            <Button
              label="Make payment"
              variant="primary"
              block
              onPress={() =>
                router.push({
                  pathname: "/payment/new",
                  params: { partyId: id },
                })
              }
            />
          </FooterBar>
        ) : null
      }
    >
      <QueryView query={party}>{(d) => <PartyBody d={d} />}</QueryView>
    </Screen>
  );
}

function PartyBody({ d }: { d: PartyDetail }) {
  const sendReminder = useSendReminder();
  const allocate = useAllocatePayments();
  const gst = useGstMode();
  const { role } = useData();
  const [tab, setTab] = useState<"bills" | "transactions">("bills");
  const p = d.party;
  // A supplier's rates are purchase costs, hidden from sales staff.
  const showProducts = p.type === "customer" || canSeeCosts(role);
  const balanceTone = d.balance > 0 ? "get" : d.balance < 0 ? "give" : "body";
  const usedPct =
    p.creditLimit > 0 ? Math.min(d.balance / p.creditLimit, 1) : 0;

  return (
    <>
      <View style={{ flexDirection: "row", gap: 14 }}>
        <Avatar name={p.name} size={56} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="title">{p.name}</Txt>
          <Txt variant="small" tone="body">
            {p.type === "customer" ? "Customer" : "Supplier"} ·{" "}
            {gst.on ? (p.gstin ? "Registered · " : "Unregistered · ") : ""}
            {p.city}
          </Txt>
          {gst.on && p.gstin ? (
            <Txt variant="mono" tone="charcoal">
              GSTIN {p.gstin}
            </Txt>
          ) : null}
        </View>
      </View>

      <Card style={{ gap: space.md }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <View>
            <Txt
              variant="small"
              tone={balanceTone}
              style={{ fontWeight: "500" }}
            >
              {d.balance > 0
                ? "You'll get"
                : d.balance < 0
                  ? "You'll give"
                  : "Settled"}
            </Txt>
            <Money
              value={Math.abs(d.balance)}
              variant="display"
              tone={balanceTone}
            />
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Txt variant="small" tone="body">
              Credit {count(p.creditDays, "day")}
            </Txt>
            <Txt variant="small" tone="body" num>
              {p.creditLimit > 0
                ? `Limit ${formatINR(p.creditLimit)}`
                : "No limit"}
            </Txt>
          </View>
        </View>
        {p.creditLimit > 0 ? (
          <View
            style={{
              height: 6,
              borderRadius: radius.pill,
              backgroundColor: colors.hairlineSoft,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${Math.max(usedPct, 0) * 100}%`,
                height: 6,
                backgroundColor: d.overLimitBy > 0 ? colors.warn : colors.ink,
              }}
            />
          </View>
        ) : null}
        {d.overLimitBy > 0 || d.overdueAmount > 0 ? (
          <Notice
            text={`${d.overLimitBy > 0 ? `Over credit limit by ${formatINR(d.overLimitBy)}. ` : ""}${
              d.overdueAmount > 0
                ? `${formatINR(d.overdueAmount)} overdue, oldest by ${count(d.maxOverdueDays, "day")}.`
                : ""
            }`}
          />
        ) : null}
      </Card>

      {showProducts ? (
        <Button
          label={
            p.type === "customer"
              ? "Products they buy and our rates"
              : "Products they supply, rates and stock"
          }
          icon="package"
          onPress={() => router.push(`/party/products/${p.id}`)}
        />
      ) : null}

      {d.unallocated > 0 && d.openBills.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Notice
            text={`${formatINR(d.unallocated)} in payments is not linked to bills yet.`}
          />
          <Button
            label="Allocate payments"
            icon="link"
            loading={allocate.isPending}
            onPress={() =>
              confirmAction(
                "Allocate payments?",
                "Link unused payments to the oldest open bills. Payment amounts and account balances stay unchanged.",
                "Allocate",
                () => {
                  allocate.mutate(p.id, {
                    onError: (e) => showError("Couldn't allocate payments", e),
                  });
                },
              )
            }
          />
        </View>
      ) : null}

      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Action icon="phone" label="Call" onPress={() => callPhone(p.phone)} />
        <Action
          icon="message-circle"
          label="WhatsApp"
          onPress={() => openWhatsApp(p.phone)}
        />
        {p.type === "customer" ? (
          <>
            <Action
              icon="send"
              label="Remind"
              disabled={d.balance <= 0}
              onPress={() => sendReminder(p.id)}
            />
            <Action
              icon="arrow-down-left"
              label="Receive"
              onPress={() =>
                router.push({
                  pathname: "/receipt/new",
                  params: { partyId: p.id },
                })
              }
            />
            <Action
              icon="file-plus"
              label="New Sale"
              onPress={() =>
                router.push({
                  pathname: "/sale/new",
                  params: { partyId: p.id },
                })
              }
            />
          </>
        ) : (
          <>
            <Action
              icon="arrow-up-right"
              label="Pay"
              onPress={() =>
                router.push({
                  pathname: "/payment/new",
                  params: { partyId: p.id },
                })
              }
            />
            <Action
              icon="shopping-cart"
              label="Purchase"
              onPress={() =>
                router.push({
                  pathname: "/purchase/new",
                  params: { partyId: p.id },
                })
              }
            />
          </>
        )}
      </View>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "bills", label: `Outstanding · ${d.openBills.length}` },
          { value: "transactions", label: "Transactions" },
        ]}
      />

      {tab === "bills" ? <Outstanding d={d} /> : <Transactions d={d} />}

      <View>
        <Txt variant="heading" style={{ marginBottom: space.xs }}>
          Details
        </Txt>
        <KeyValue label="Phone" value={p.phone} />
        <KeyValue label="City" value={p.city} />
        <KeyValue label="State" value={stateName(p.stateCode)} />
        <KeyValue label="Opening balance" value={formatINR(p.openingBalance)} />
      </View>
    </>
  );
}

function Outstanding({ d }: { d: PartyDetail }) {
  const buckets = Object.entries(d.ageing) as [string, number][];
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {buckets.map(([label, amount]) => (
          <View
            key={label}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: radius.card,
              backgroundColor: colors.surfaceSoft,
            }}
          >
            <Txt variant="caption" tone="body">
              {label} d
            </Txt>
            <Txt
              variant="small"
              num
              style={{ fontWeight: "600" }}
              tone={amount ? "ink" : "body"}
              adjustsFontSizeToFit
              numberOfLines={1}
            >
              {formatINR(amount, { decimals: false })}
            </Txt>
          </View>
        ))}
      </View>
      {d.openBills.length === 0 ? (
        <Txt variant="small" tone="body">
          No open bills.
        </Txt>
      ) : (
        <View>
          {d.openBills.map((b, i) => (
            <ListRow
              key={b.id}
              title={b.number}
              subtitle={`Bill ${formatDate(b.date)} · Due ${formatDate(b.dueDate)} · Age ${b.ageDays} d`}
              onPress={
                isOpeningBillId(b.id)
                  ? undefined
                  : () => router.push(`/voucher/${b.id}`)
              }
              right={
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Money value={b.pending} variant="bodyStrong" />
                  {d.overdueAmount > 0 && b.overdueDays > 0 ? (
                    <Badge label={`Overdue ${b.overdueDays} d`} tone="warn" />
                  ) : (
                    <Badge
                      label={
                        d.unallocated > 0 ? "Allocation pending" : "Not due"
                      }
                    />
                  )}
                </View>
              }
              last={i === d.openBills.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function Transactions({ d }: { d: PartyDetail }) {
  if (d.transactions.length === 0)
    return (
      <Txt variant="small" tone="body">
        No transactions yet.
      </Txt>
    );
  return (
    <View>
      {d.transactions.map((v, i) => {
        const badge = voucherBadge(v);
        return (
          <ListRow
            key={v.id}
            title={`${voucherTypeLabel[v.type]} · ${v.number}`}
            subtitle={formatDate(v.date)}
            onPress={() => router.push(`/voucher/${v.id}`)}
            right={
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Money
                  value={v.amount}
                  variant="bodyStrong"
                  tone={
                    v.type === "receipt" || v.type === "payment" ? "get" : "ink"
                  }
                />
                {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
              </View>
            }
            last={i === d.transactions.length - 1}
          />
        );
      })}
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        alignItems: "center",
        gap: 6,
        minWidth: 60,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.hairlineStrong,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={20} />
      </View>
      <Txt variant="caption" style={{ fontWeight: "500" }}>
        {label}
      </Txt>
    </Pressable>
  );
}
