import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { formatINR, type Gstr3b } from "@repo/core";
import {
  Button,
  Card,
  FooterBar,
  Header,
  Money,
  Notice,
  QueryView,
  Screen,
  TableRow,
  Txt,
} from "@/components";
import { useGstr3b } from "@/data/queries";
import { colors, radius, space } from "@/theme";

const box = {
  borderWidth: 1,
  borderColor: colors.hairline,
  borderRadius: radius.card,
  overflow: "hidden" as const,
};
const inr = (p: number) => formatINR(p, { decimals: false });
const HEADS = ["", "IGST", "CGST", "SGST"];

/** GSTR-3B: the monthly summary return and how the tax is paid. */
export default function Gstr3bScreen() {
  const { month = "" } = useLocalSearchParams<{ month: string }>();
  const data = useGstr3b(month);

  return (
    <Screen
      header={
        <Header
          title="GSTR-3B"
          subtitle={data.data?.title ?? "Summary return"}
        />
      }
      onRefresh={() => data.refetch()}
      refreshing={data.isRefetching}
      footer={
        <FooterBar>
          <Button
            label="View GSTR-1"
            onPress={() => router.replace(`/gstr1?month=${month}`)}
            style={{ flex: 1 }}
          />
        </FooterBar>
      }
    >
      <QueryView query={data}>{(g) => <Body g={g} />}</QueryView>
    </Screen>
  );
}

function Body({ g }: { g: Gstr3b }) {
  const o = g.outwardTaxable;
  // Credit used = tax due − tax still to pay in cash, per head
  const used = {
    igst: o.igst - g.payable.igst,
    cgst: o.cgst - g.payable.cgst,
    sgst: o.sgst - g.payable.sgst,
  };
  return (
    <>
      <Card variant="dark" style={{ gap: space.sm }}>
        <Txt variant="small" tone="onDarkMute">
          Estimated period tax difference
        </Txt>
        <Money value={g.payable.total} variant="display" tone="onDark" />
        <Txt variant="caption" tone="onDarkMute">
          {g.broughtForward.total
            ? `Credit brought forward ${formatINR(g.broughtForward.total)} · `
            : ""}
          Credit carried to next month {formatINR(g.creditLeft.total)}
        </Txt>
      </Card>
      <Notice text="Book estimates only. Unused credit from earlier months in these books is carried forward; credit from before the books started, credit eligibility and actual tax payments are not included." />

      <View style={{ gap: space.sm }}>
        <Txt variant="heading">3.1 · Outward supplies</Txt>
        <View style={box}>
          <TableRow header cells={["", "Value"]} width={120} />
          <TableRow
            width={120}
            cells={["(a) Taxable supplies", inr(o.taxable)]}
          />
          <TableRow
            width={120}
            cells={["(c) Nil rated and exempt", inr(g.outwardNil)]}
          />
          <TableRow
            width={120}
            last
            cells={["(e) Non-GST supplies", inr(g.outwardNonGst)]}
          />
        </View>
      </View>

      <TaxTable
        title="Tax on outward supplies"
        rows={[["Tax due", o.igst, o.cgst, o.sgst]]}
      />
      <TaxTable
        title="4 · Input tax in books"
        rows={[["Recorded input tax", g.itc.igst, g.itc.cgst, g.itc.sgst]]}
      />
      <View style={{ gap: space.sm }}>
        <Txt variant="heading">5 · Purchases without GST</Txt>
        <View style={box}>
          <TableRow
            header
            width={92}
            cells={["", "Interstate", "Within state"]}
          />
          <TableRow
            width={92}
            cells={[
              "Nil-rated and exempt",
              inr(g.inwardNoTax.nilExempt.inter),
              inr(g.inwardNoTax.nilExempt.intra),
            ]}
          />
          <TableRow
            width={92}
            last
            cells={[
              "Non-GST",
              inr(g.inwardNoTax.nonGst.inter),
              inr(g.inwardNoTax.nonGst.intra),
            ]}
          />
        </View>
      </View>
      <TaxTable
        title="6.1 · Estimated tax working"
        rows={[
          ["Tax due", o.igst, o.cgst, o.sgst],
          ["Paid by credit", used.igst, used.cgst, used.sgst],
          [
            "Estimated difference",
            g.payable.igst,
            g.payable.cgst,
            g.payable.sgst,
          ],
        ]}
        totalLast
      />
      <Txt variant="caption" tone="body">
        Figures are worked out from your sales and purchase bills. Check them
        against the GST portal before filing.
      </Txt>
    </>
  );
}

function TaxTable({
  title,
  rows,
  totalLast,
}: {
  title: string;
  rows: [string, number, number, number][];
  totalLast?: boolean;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="heading">{title}</Txt>
      <View style={box}>
        <TableRow header width={76} cells={HEADS} />
        {rows.map(([label, i, c, s], k) => (
          <TableRow
            key={label}
            width={76}
            last={k === rows.length - 1}
            strong={totalLast && k === rows.length - 1}
            cells={[label, inr(i), inr(c), inr(s)]}
          />
        ))}
      </View>
    </View>
  );
}
