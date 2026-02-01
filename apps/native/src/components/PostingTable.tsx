import { StyleSheet, View } from "react-native";
import { formatAmount, postingTotals, type Posting } from "@repo/core";
import { colors, radius, space } from "@/theme";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

/** Dr/Cr lines a voucher creates, with a "Dr = Cr" check or the difference. */
export function PostingTable({ rows }: { rows: Posting[] }) {
  const totals = postingTotals(rows);
  return (
    <View style={{ gap: space.sm }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <Txt variant="heading">Ledger posting</Txt>
        {totals.balanced ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name="check" size={16} color={colors.get} />
            <Txt variant="small" tone="get">
              Dr = Cr
            </Txt>
          </View>
        ) : (
          <Txt variant="small" tone="give">
            Difference {formatAmount(Math.abs(totals.difference))}
          </Txt>
        )}
      </View>
      <View style={styles.table}>
        <Row ledger="Ledger" debit="Dr" credit="Cr" muted />
        {rows.map((r, i) => (
          <Row
            key={`${r.ledger}-${i}`}
            ledger={r.ledger}
            debit={r.debit ? formatAmount(r.debit) : ""}
            credit={r.credit ? formatAmount(r.credit) : ""}
          />
        ))}
        <Row
          ledger="Total"
          debit={formatAmount(totals.debit)}
          credit={formatAmount(totals.credit)}
          bold
        />
      </View>
    </View>
  );
}

function Row({
  ledger,
  debit,
  credit,
  muted,
  bold,
}: {
  ledger: string;
  debit: string;
  credit: string;
  muted?: boolean;
  bold?: boolean;
}) {
  const tone = muted ? "body" : "ink";
  const style = bold ? { fontWeight: "600" as const } : undefined;
  return (
    <View style={[styles.row, (muted || bold) && styles.divider]}>
      <Txt
        variant="mono"
        tone={tone}
        style={[{ flex: 1, fontSize: 12 }, style]}
        numberOfLines={1}
      >
        {ledger}
      </Txt>
      <Txt variant="mono" tone={tone} style={[styles.num, style]}>
        {debit}
      </Txt>
      <Txt variant="mono" tone={tone} style={[styles.num, style]}>
        {credit}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  table: {
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  row: { flexDirection: "row", gap: space.sm, paddingVertical: 6 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  num: { width: 84, textAlign: "right", fontSize: 12 },
});
