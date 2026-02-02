import { router, useLocalSearchParams } from "expo-router";
import { Share, View } from "react-native";
import { formatINR, type Gstr1, count } from "@repo/core";
import {
  Button,
  Card,
  EmptyState,
  FooterBar,
  Header,
  KeyValue,
  QueryView,
  Screen,
  TableRow,
  Txt,
} from "@/components";
import { stateName } from "@/data/labels";
import { useGstr1 } from "@/data/queries";
import { colors, fonts, radius, space } from "@/theme";

const box = {
  borderWidth: 1,
  borderColor: colors.hairline,
  borderRadius: radius.card,
  overflow: "hidden" as const,
};
const inr = (p: number) => formatINR(p, { decimals: false });

/** GSTR-1: every sale of the month, in the sections the GST portal asks for. */
export default function Gstr1Screen() {
  const { month = "" } = useLocalSearchParams<{ month: string }>();
  const data = useGstr1(month);

  const share = async (g: Gstr1) => {
    // Mock export: shares a text summary. The real app will download the portal JSON from the API.
    const text = [
      `GSTR-1 · ${g.title}`,
      `Invoices: ${g.totals.invoices}`,
      `Taxable value: ${formatINR(g.totals.taxable)}`,
      `Tax: ${formatINR(g.totals.tax)}`,
    ].join("\n");
    try {
      await Share.share({ message: text });
    } catch {
      // Sharing is not available (e.g. some browsers); nothing to do.
    }
  };

  return (
    <Screen
      header={
        <Header title="GSTR-1" subtitle={data.data?.title ?? "Sales details"} />
      }
      onRefresh={() => data.refetch()}
      refreshing={data.isRefetching}
      footer={
        data.data ? (
          <FooterBar>
            <Button
              label="View GSTR-3B"
              onPress={() => router.replace(`/gstr3b?month=${month}`)}
            />
            <Button
              label="Share summary"
              variant="primary"
              icon="share-2"
              onPress={() => share(data.data!)}
              style={{ flex: 1 }}
            />
          </FooterBar>
        ) : null
      }
    >
      <QueryView query={data}>
        {(g) =>
          g.totals.invoices === 0 ? (
            <EmptyState
              icon="file-text"
              title="No sales this month"
              message="File a nil GSTR-1 for this month."
            />
          ) : (
            <Body g={g} />
          )
        }
      </QueryView>
    </Screen>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: space.sm }}>
      <View>
        <Txt variant="heading">{title}</Txt>
        <Txt variant="caption" tone="body">
          {note}
        </Txt>
      </View>
      <View style={box}>{children}</View>
    </View>
  );
}

function Body({ g }: { g: Gstr1 }) {
  return (
    <>
      <Card style={{ gap: 0 }}>
        <KeyValue label="Invoices" value={String(g.totals.invoices)} />
        <KeyValue label="Taxable value" value={formatINR(g.totals.taxable)} />
        {g.totals.nil + g.totals.exempt + g.totals.nonGst > 0 ? (
          <KeyValue
            label="Without GST (nil, exempt, non-GST)"
            value={formatINR(g.totals.nil + g.totals.exempt + g.totals.nonGst)}
          />
        ) : null}
        <KeyValue label="Total tax" value={formatINR(g.totals.tax)} strong />
      </Card>

      <Section
        title={`4A · B2B · ${count(
          g.b2b.reduce((n, r) => n + r.invoices, 0),
          "invoice",
        )}`}
        note="Sales to registered buyers (with GSTIN)"
      >
        <TableRow header cells={["Buyer", "Taxable", "Tax"]} />
        {g.b2b.length === 0 ? (
          <TableRow last cells={["None this month", "", ""]} />
        ) : (
          g.b2b.map((r, i) => (
            <TableRow
              key={r.partyId}
              last={i === g.b2b.length - 1}
              onPress={() => router.push(`/party/${r.partyId}`)}
              cells={[
                <View key="n">
                  <Txt variant="small" numberOfLines={1}>
                    {r.name}
                  </Txt>
                  <Txt
                    variant="caption"
                    tone="body"
                    style={{ fontFamily: fonts.mono }}
                  >
                    {r.gstin}
                  </Txt>
                </View>,
                inr(r.taxable),
                inr(r.tax),
              ]}
            />
          ))
        )}
      </Section>

      {g.b2cl.length > 0 ? (
        <Section
          title={`5A · B2C Large · ${g.b2cl.length}`}
          note="Interstate sales over ₹1,00,000 to unregistered buyers"
        >
          <TableRow header cells={["Invoice", "Taxable", "Tax"]} />
          {g.b2cl.map((r, i) => (
            <TableRow
              key={r.voucherId}
              last={i === g.b2cl.length - 1}
              onPress={() => router.push(`/voucher/${r.voucherId}`)}
              cells={[
                `${r.number} · ${stateName(r.stateCode)}`,
                inr(r.taxable),
                inr(r.tax),
              ]}
            />
          ))}
        </Section>
      ) : null}

      <Section
        title="7 · B2C Small"
        note="Other sales to unregistered buyers, by state and rate"
      >
        <TableRow header cells={["Place · rate", "Taxable", "Tax"]} />
        {g.b2cs.length === 0 ? (
          <TableRow last cells={["None this month", "", ""]} />
        ) : (
          g.b2cs.map((r, i) => (
            <TableRow
              key={`${r.stateCode}-${r.rate}`}
              last={i === g.b2cs.length - 1}
              cells={[
                `${stateName(r.stateCode)} · ${r.rate}%`,
                inr(r.taxable),
                inr(r.tax),
              ]}
            />
          ))
        )}
      </Section>

      {(["b2b", "b2c"] as const).map((kind) => {
        const rows = g.hsn.filter((r) => r.kind === kind);
        return (
          <Section
            key={kind}
            title={`12 · HSN summary · ${kind === "b2b" ? "B2B" : "B2C"}`}
            note={
              kind === "b2b"
                ? "Sales to buyers with a GSTIN, by HSN/SAC code"
                : "Sales to everyone else, by HSN/SAC code"
            }
          >
            <TableRow header cells={["HSN · qty", "Taxable", "Tax"]} />
            {rows.length === 0 ? (
              <TableRow last cells={["None this month", "—", "—"]} />
            ) : (
              rows.map((r, i) => (
                <TableRow
                  key={`${kind}-${r.hsn}`}
                  last={i === rows.length - 1}
                  cells={[
                    <View key="h">
                      <Txt variant="small" numberOfLines={1}>
                        {r.description}
                      </Txt>
                      <Txt variant="caption" tone="body" num>
                        {r.hsn} · {r.qty ? `${r.qty} ${r.uqc}` : r.uqc}
                      </Txt>
                    </View>,
                    inr(r.taxable),
                    inr(r.cgst + r.sgst + r.igst),
                  ]}
                />
              ))
            )}
          </Section>
        );
      })}

      {g.noTax.length > 0 ? (
        <Section
          title="8 · Nil-rated, exempt and non-GST"
          note="Sales that carried no GST"
        >
          <TableRow
            header
            width={70}
            cells={["", "Nil", "Exempt", "Non-GST"]}
          />
          {g.noTax.map((r, i) => (
            <TableRow
              key={r.row}
              width={70}
              last={i === g.noTax.length - 1}
              cells={[r.label, inr(r.nil), inr(r.exempt), inr(r.nonGst)]}
            />
          ))}
        </Section>
      ) : null}

      {g.documents.length > 0 ? (
        <Section title="13 · Documents issued" note="Number range per series">
          {g.documents.map((d, i) => (
            <TableRow
              key={d.kind}
              last={i === g.documents.length - 1}
              width={92}
              cells={[
                <View key="d">
                  <Txt variant="small">{d.kind}</Txt>
                  <Txt variant="caption" tone="body" num>
                    {d.from} to {d.to}
                  </Txt>
                </View>,
                `${d.total} issued`,
                `${d.cancelled} cancelled`,
              ]}
            />
          ))}
        </Section>
      ) : null}
    </>
  );
}
