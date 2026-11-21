import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  can,
  COMPOSITION_TYPES,
  compositionTaxEntry,
  formatINR,
  monthLabel,
  today,
  type GstMonth,
  count,
} from "@repo/core";
import {
  Avatar,
  Button,
  Card,
  Chip,
  ChipRow,
  Header,
  ListRow,
  Money,
  Notice,
  QueryView,
  Screen,
  TableRow,
  Txt,
  EmptyState,
  showError,
  showToast,
} from "@/components";
import { useData } from "@/data/DataProvider";
import { useGstMode } from "@/data/gstMode";
import {
  useCompositionQuarters,
  useCreateJournal,
  useFirm,
  useGstMonths,
} from "@/data/queries";
import { colors, radius, space } from "@/theme";

const card = {
  borderWidth: 1,
  borderColor: colors.hairline,
  borderRadius: radius.card,
  overflow: "hidden" as const,
};

/**
 * GST for the open firm, by its GST setting:
 *   regular     → month by month: tax collected, credit, cash to pay, GSTR-1 / GSTR-3B figures
 *   composition → quarter by quarter: CMP-08 tax on turnover
 *   no GST      → nothing to show; points to Firm profile
 * Hisaab works the figures out only; returns are filed on the GST portal by the user or their CA.
 */
export default function GstScreen() {
  const gst = useGstMode();
  if (gst.off)
    return (
      <Screen header={<Header title="GST" />}>
        <EmptyState
          icon="percent"
          title="GST is switched off for this firm"
          message="Bills carry no GST and there are no GST reports. If the firm registers for GST, turn it on in Firm profile."
          actionLabel="Open Firm profile"
          onAction={() => router.push("/settings/firm")}
        />
      </Screen>
    );
  if (gst.composition) return <CompositionScreen />;
  return <RegularScreen />;
}

function RegularScreen() {
  const months = useGstMonths();
  return (
    <Screen
      header={<Header title="GST" subtitle="Book tax summary" />}
      onRefresh={() => months.refetch()}
      refreshing={months.isRefetching}
    >
      <Notice
        tone="info"
        text="Book estimates only. Opening credit, credit eligibility and actual tax payments are not included."
      />
      <QueryView query={months}>{(list) => <Body months={list} />}</QueryView>
    </Screen>
  );
}

function Body({ months }: { months: GstMonth[] }) {
  // Default to last month: that is the one being filed now.
  const [month, setMonth] = useState(months[1]?.month ?? months[0].month);
  const m = months.find((x) => x.month === month) ?? months[0];
  const isCurrent = m.month === months[0].month;

  return (
    <>
      <ChipRow>
        {months.map((x, i) => (
          <Chip
            key={x.month}
            label={i === 0 ? `${monthLabel(x.month)} (so far)` : x.title}
            selected={x.month === month}
            onPress={() => setMonth(x.month)}
          />
        ))}
      </ChipRow>

      <Card variant="dark" style={{ gap: space.sm }}>
        <Txt variant="small" tone="onDarkMute">
          Estimated GST difference · {m.title}
        </Txt>
        <Money value={m.payable.total} variant="display" tone="onDark" />
        <Txt variant="caption" tone="onDarkMute">
          {[
            m.broughtForward.total
              ? `${formatINR(m.broughtForward.total)} credit brought forward`
              : "",
            m.creditLeft.total > 0
              ? `${formatINR(m.creditLeft.total)} credit carried to next month`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </Txt>
      </Card>

      {isCurrent ? (
        <Notice
          tone="info"
          text="This month is still open. Figures will change as you add sales and purchases."
        />
      ) : null}

      <View style={{ gap: space.sm }}>
        <Txt variant="heading">Tax summary</Txt>
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: radius.card,
            overflow: "hidden",
          }}
        >
          <TableRow header width={78} cells={["", "CGST", "SGST", "IGST"]} />
          <TableRow
            width={78}
            cells={[
              `Output · ${m.salesCount} sales`,
              formatINR(m.output.cgst, { decimals: false }),
              formatINR(m.output.sgst, { decimals: false }),
              formatINR(m.output.igst, { decimals: false }),
            ]}
          />
          <TableRow
            width={78}
            cells={[
              `Book input tax · ${count(m.purchaseCount, "bill")}`,
              `− ${formatINR(m.input.cgst, { decimals: false })}`,
              `− ${formatINR(m.input.sgst, { decimals: false })}`,
              `− ${formatINR(m.input.igst, { decimals: false })}`,
            ]}
          />
          <TableRow
            strong
            last
            width={78}
            cells={[
              "Estimate",
              formatINR(m.payable.cgst, { decimals: false }),
              formatINR(m.payable.sgst, { decimals: false }),
              formatINR(m.payable.igst, { decimals: false }),
            ]}
          />
        </View>
        <Txt variant="caption" tone="body">
          Taxable sales {formatINR(m.output.taxable, { decimals: false })} ·
          taxable purchases {formatINR(m.input.taxable, { decimals: false })}.
          IGST credit is used first, then CGST and SGST.
        </Txt>
      </View>

      <View style={{ gap: space.sm }}>
        <Txt variant="heading">Without GST</Txt>
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: radius.card,
            overflow: "hidden",
          }}
        >
          <TableRow
            header
            width={78}
            cells={["", "Nil-rated", "Exempt", "Non-GST"]}
          />
          <TableRow
            width={78}
            cells={[
              "Sales",
              formatINR(m.output.nil, { decimals: false }),
              formatINR(m.output.exempt, { decimals: false }),
              formatINR(m.output.nonGst, { decimals: false }),
            ]}
          />
          <TableRow
            width={78}
            last
            cells={[
              "Purchases",
              formatINR(m.input.nil, { decimals: false }),
              formatINR(m.input.exempt, { decimals: false }),
              formatINR(m.input.nonGst, { decimals: false }),
            ]}
          />
        </View>
        <Txt variant="caption" tone="body">
          {m.billsOfSupply} bill{m.billsOfSupply === 1 ? "" : "s"} of supply
          this month. These go in GSTR-1 table 8 and GSTR-3B 3.1(c), 3.1(e) and
          5.
        </Txt>
      </View>

      <View>
        <Txt variant="heading" style={{ marginBottom: space.xs }}>
          Book summaries
        </Txt>
        <ListRow
          left={<Avatar icon="upload" />}
          title="GSTR-1 · Sales details"
          subtitle="Sales and return working"
          chevron
          onPress={() => router.push(`/gstr1?month=${m.month}`)}
        />
        <ListRow
          left={<Avatar icon="file-text" />}
          title="GSTR-3B · Tax summary"
          subtitle="Period book estimate"
          chevron
          onPress={() => router.push(`/gstr3b?month=${m.month}`)}
          last
        />
        <Txt variant="caption" tone="body">
          Hisaab works these figures out from your bills. File the returns on
          the GST portal yourself or through your CA.
        </Txt>
      </View>
    </>
  );
}

/** Composition: tax = rate × turnover each quarter (CMP-08), GSTR-4 once a year. */
function CompositionScreen() {
  const quarters = useCompositionQuarters();
  const firm = useFirm();
  const { role } = useData();
  const createJournal = useCreateJournal();
  const [index, setIndex] = useState(1);
  const type = COMPOSITION_TYPES.find(
    (t) => t.value === (firm.data?.compositionType ?? "trader"),
  );
  return (
    <Screen
      header={
        <Header
          title="GST · Composition"
          subtitle={type ? `${type.label} · ${type.rate}% of turnover` : ""}
        />
      }
      onRefresh={() => quarters.refetch()}
      refreshing={quarters.isRefetching}
    >
      <QueryView query={quarters}>
        {(list) => {
          const q = list[Math.min(index, list.length - 1)];
          return (
            <>
              <ChipRow>
                {list.map((x, i) => (
                  <Chip
                    key={x.label}
                    label={i === 0 ? `${x.label} (so far)` : x.label}
                    selected={i === index}
                    onPress={() => setIndex(i)}
                  />
                ))}
              </ChipRow>
              {/* The one dark card on this screen */}
              <Card variant="dark" style={{ gap: space.sm }}>
                <Txt variant="small" tone="onDarkMute">
                  Estimated composition tax · {q.label}
                </Txt>
                <Money value={q.tax} variant="display" tone="onDark" />
                <Txt variant="caption" tone="onDarkMute">
                  {q.rate}% of {formatINR(q.turnover)} turnover
                </Txt>
              </Card>
              {index === 0 ? (
                <Notice
                  tone="info"
                  text="This quarter is still open. The figure grows as you make sales."
                />
              ) : null}
              {(() => {
                // Closed quarters only: the entry is dated on the quarter's last day.
                const closed = (q.end ?? q.due) < today();
                if (!closed) return null;
                const entry = compositionTaxEntry(q);
                if (!entry)
                  return q.tax ? (
                    <Notice
                      tone="info"
                      text={`${formatINR(q.recorded)} composition tax is recorded in the books for ${q.label}.`}
                    />
                  ) : null;
                const difference = q.tax - q.recorded;
                const what = q.recorded
                  ? `The books show ${formatINR(q.recorded)}; record the ${formatINR(Math.abs(difference))} difference.`
                  : `Record ${formatINR(q.tax)} as Composition Tax (expense) and Composition Tax Payable.`;
                return role && can(role, "accounts") ? (
                  <Card style={{ gap: space.sm }}>
                    <Txt variant="small" tone="body">
                      {what}
                    </Txt>
                    <Button
                      label="Record in books"
                      variant="primary"
                      loading={createJournal.isPending}
                      onPress={async () => {
                        try {
                          await createJournal.mutateAsync(entry);
                          await quarters.refetch();
                          showToast(`Recorded for ${q.label}`, "ok");
                        } catch (e) {
                          showError("Couldn't record", e);
                        }
                      }}
                    />
                  </Card>
                ) : (
                  <Notice
                    tone="info"
                    text={`${what} Ask the owner or accountant to record it.`}
                  />
                );
              })()}
              <View style={card}>
                <TableRow header cells={["", "Amount"]} />
                <TableRow
                  cells={["Sales (bills of supply)", formatINR(q.sales)]}
                />
                <TableRow
                  cells={["Less: sales returns", formatINR(q.returns)]}
                />
                <TableRow cells={["Turnover", formatINR(q.turnover)]} />
                <TableRow
                  last
                  cells={[`Tax at ${q.rate}%`, formatINR(q.tax)]}
                />
              </View>
              <Txt variant="caption" tone="body">
                Book estimate only. This is not a filing, eligibility check or
                confirmation of tax paid.
              </Txt>
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}
