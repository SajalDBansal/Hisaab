import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import {
  allowedDates,
  formatDate,
  formatINR,
  parseRupees,
  today,
  type BankEntry,
  type LedgerWithBalance,
} from "@repo/core";
import {
  AmountField,
  Card,
  Chip,
  ChipRow,
  DateField,
  EmptyState,
  Header,
  Icon,
  Money,
  QueryView,
  Screen,
  Segmented,
  Txt,
  showError,
} from "@/components";
import { voucherTypeLabel } from "@/data/labels";
import { useLedgers, useReconciliation, useSetCleared } from "@/data/queries";
import { colors, radius, space } from "@/theme";
import { useReveal } from "@/data/useReveal";

type Filter = "open" | "cleared" | "all";

/**
 * Bank reconciliation: tick each entry once it shows in the bank statement.
 * Whatever is left unticked explains the gap between the books and the bank.
 */
export default function ReconcileScreen() {
  // Entries are drawn a page at a time as the user scrolls.
  const reveal = useReveal();
  const ledgers = useLedgers();
  const banks = (ledgers.data ?? []).filter((l) => l.ledger.kind === "bank");
  if (ledgers.data && banks.length === 0)
    return (
      <Screen header={<Header title="Bank reconciliation" />}>
        <EmptyState
          icon="credit-card"
          title="No bank account yet"
          message="Add a bank account to match its entries with the bank statement."
        />
      </Screen>
    );
  return (
    <Screen
      header={
        <Header
          title="Bank reconciliation"
          subtitle="Match the books with the bank statement"
        />
      }
      onEndReached={reveal.more}
    >
      <QueryView query={ledgers}>
        {() => <Reconcile banks={banks} shown={reveal.count} />}
      </QueryView>
    </Screen>
  );
}

function Reconcile({
  banks,
  shown,
}: {
  banks: LedgerWithBalance[];
  shown: number;
}) {
  const params = useLocalSearchParams<{ ledger?: string }>();
  const [ledgerId, setLedgerId] = useState(
    banks.find((b) => b.ledger.id === params.ledger)?.ledger.id ??
      banks[0].ledger.id,
  );
  const [filter, setFilter] = useState<Filter>("open");
  const [bankDate, setBankDate] = useState(today());
  const [statementText, setStatementText] = useState("");
  const rec = useReconciliation(ledgerId);
  const setCleared = useSetCleared(ledgerId);

  const tick = (e: BankEntry) => {
    // The bank date can't be before the entry, so use the entry date if needed
    const date = e.clearedOn
      ? null
      : bankDate < e.voucher.date
        ? e.voucher.date
        : bankDate;
    setCleared.mutate(
      { id: e.voucher.id, date },
      {
        onError: (err) => showError("Couldn't update", err),
      },
    );
  };

  return (
    <>
      {banks.length > 1 ? (
        <Segmented
          value={ledgerId}
          onChange={setLedgerId}
          options={banks.map((b) => ({
            value: b.ledger.id,
            label: b.ledger.shortName,
          }))}
        />
      ) : null}

      <QueryView query={rec}>
        {(r) => {
          const statement = parseRupees(statementText);
          const diff = statement === null ? null : statement - r.bankBalance;
          const open = r.entries.filter((e) => !e.clearedOn);
          const visible = r.entries.filter((e) =>
            filter === "all"
              ? true
              : filter === "open"
                ? !e.clearedOn
                : !!e.clearedOn,
          );
          return (
            <>
              {/* The one dark card on this screen */}
              <Card variant="dark" style={{ gap: space.md, padding: 20 }}>
                <View>
                  <Txt variant="small" tone="onDarkMute">
                    Bank statement should show
                  </Txt>
                  <Money value={r.bankBalance} variant="title" tone="onDark" />
                </View>
                <View style={{ gap: 6 }}>
                  <DarkRow
                    label="Balance as per books"
                    value={r.booksBalance}
                  />
                  <DarkRow
                    label="− Deposits not yet in bank"
                    value={r.unclearedIn}
                  />
                  <DarkRow
                    label="+ Payments not yet out of bank"
                    value={r.unclearedOut}
                  />
                </View>
              </Card>

              <Card style={{ gap: space.sm }}>
                <View style={{ flexDirection: "row" }}>
                  <AmountField
                    label="Closing balance in your bank statement (optional)"
                    value={statementText}
                    onChangeText={setStatementText}
                  />
                </View>
                {diff === null ? (
                  <Txt variant="caption" tone="body">
                    Type the statement balance to check it matches.
                  </Txt>
                ) : diff === 0 ? (
                  <Txt variant="small" tone="get" style={{ fontWeight: "600" }}>
                    ✓ Matches the bank statement
                  </Txt>
                ) : (
                  <Txt variant="small" tone="give">
                    Off by {formatINR(Math.abs(diff))}. Look for an entry
                    missing in the books (bank charges, interest) or one not
                    ticked yet.
                  </Txt>
                )}
              </Card>

              <View style={{ gap: space.md }}>
                <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
                  <Txt variant="heading" style={{ flex: 1 }}>
                    Entries
                  </Txt>
                </View>
                <ChipRow>
                  <Chip
                    label={`Not in bank · ${open.length}`}
                    selected={filter === "open"}
                    onPress={() => setFilter("open")}
                  />
                  <Chip
                    label={`In bank · ${r.entries.length - open.length}`}
                    selected={filter === "cleared"}
                    onPress={() => setFilter("cleared")}
                  />
                  <Chip
                    label={`All · ${r.entries.length}`}
                    selected={filter === "all"}
                    onPress={() => setFilter("all")}
                  />
                </ChipRow>
                {filter !== "cleared" ? (
                  <View style={{ flexDirection: "row" }}>
                    <DateField
                      label="Bank date for ticked entries"
                      value={bankDate}
                      onChange={setBankDate}
                      min={allowedDates().min}
                      max={today()}
                    />
                  </View>
                ) : null}
                {visible.length === 0 ? (
                  <EmptyState
                    icon="check-circle"
                    title={
                      filter === "open"
                        ? "Every entry is in the bank"
                        : "No entries here"
                    }
                  />
                ) : (
                  <View style={{ gap: space.sm }}>
                    {visible.slice(0, shown).map((e) => (
                      <EntryRow
                        key={e.voucher.id}
                        e={e}
                        onTick={() => tick(e)}
                      />
                    ))}
                  </View>
                )}
                <Txt variant="caption" tone="body">
                  Tick an entry when you see it in the bank statement. Tick
                  again to undo.
                </Txt>
              </View>
            </>
          );
        }}
      </QueryView>
    </>
  );
}

function DarkRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Txt variant="small" tone="onDarkMute">
        {label}
      </Txt>
      <Txt variant="small" tone="onDark" num>
        {formatINR(value)}
      </Txt>
    </View>
  );
}

function EntryRow({ e, onTick }: { e: BankEntry; onTick: () => void }) {
  const v = e.voucher;
  const cleared = !!e.clearedOn;
  const what =
    v.narration ?? v.expenseHead ?? `${voucherTypeLabel[v.type]} ${v.number}`;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.hairline,
      }}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: cleared }}
        accessibilityLabel={`In bank: ${v.number}`}
        onPress={onTick}
        hitSlop={8}
        style={{
          width: 26,
          height: 26,
          borderRadius: radius.sm,
          borderWidth: 1.5,
          borderColor: colors.ink,
          backgroundColor: cleared ? colors.ink : colors.canvas,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {cleared ? (
          <Icon name="check" size={16} color={colors.onPrimary} />
        ) : null}
      </Pressable>
      <Pressable
        style={{ flex: 1, gap: 2 }}
        onPress={() => router.push(`/voucher/${v.id}`)}
      >
        <Txt variant="bodyStrong" numberOfLines={1}>
          {what}
        </Txt>
        <Txt variant="caption" tone="body" numberOfLines={1}>
          {what.includes(v.number) ? "" : `${v.number} · `}
          {formatDate(v.date)}
          {v.reference ? ` · ${v.reference}` : ""}
          {e.clearedOn ? ` · in bank ${formatDate(e.clearedOn)}` : ""}
        </Txt>
      </Pressable>
      <Txt
        variant="bodyStrong"
        num
        tone={e.amount > 0 ? "get" : "ink"}
        style={{ fontWeight: "600" }}
      >
        {e.amount > 0 ? "+" : "−"}
        {formatINR(Math.abs(e.amount))}
      </Txt>
    </View>
  );
}
