import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Polyline } from "react-native-svg";
import { formatINR, type Paise } from "@repo/core";
import { colors, space } from "@/theme";
import { Txt } from "./Txt";

const CHART_HEIGHT = 140;

/** Paired bars per month (e.g. sales in black vs purchases in grey). Heights are scaled to the largest value. */
export function PairedBarChart({
  data,
  labels,
}: {
  data: { label: string; a: Paise; b: Paise }[];
  labels: [string, string];
}) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  const height = (v: Paise) =>
    Math.max(2, Math.round((v / max) * CHART_HEIGHT));
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.legend}>
        <LegendDot color={colors.ink} label={labels[0]} />
        <LegendDot color="#c4c4c4" label={labels[1]} />
      </View>
      <View
        style={styles.bars}
        accessibilityLabel={`${labels[0]} and ${labels[1]} for the last ${data.length} months`}
      >
        {data.map((d) => (
          <View key={d.label} style={styles.group}>
            <View
              style={[
                styles.bar,
                { height: height(d.a), backgroundColor: colors.ink },
              ]}
            />
            <View
              style={[
                styles.bar,
                { height: height(d.b), backgroundColor: "#c4c4c4" },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row" }}>
        {data.map((d) => (
          <Txt
            key={d.label}
            variant="caption"
            tone="body"
            center
            style={{ flex: 1 }}
          >
            {d.label}
          </Txt>
        ))}
      </View>
    </View>
  );
}

/** Simple line chart (e.g. cash + bank at each month end). */
export function LineChart({
  data,
}: {
  data: { label: string; value: Paise }[];
}) {
  const [width, setWidth] = useState(0);
  const h = 110;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const pad = 10;
  const x = (i: number) =>
    pad + (i * (width - pad * 2)) / Math.max(data.length - 1, 1);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const points = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const last = data[data.length - 1];

  return (
    <View style={{ gap: space.sm }}>
      <View
        style={{ height: h }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={`From ${formatINR(data[0]?.value ?? 0, { decimals: false })} to ${formatINR(last?.value ?? 0, { decimals: false })}`}
      >
        {width > 0 && data.length > 1 ? (
          <Svg width={width} height={h}>
            <Line
              x1={0}
              y1={h - 1}
              x2={width}
              y2={h - 1}
              stroke={colors.hairline}
            />
            <Polyline
              points={points}
              fill="none"
              stroke={colors.ink}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <Circle
              cx={x(data.length - 1)}
              cy={y(last.value)}
              r={4}
              fill={colors.ink}
            />
          </Svg>
        ) : null}
      </View>
      <View style={{ flexDirection: "row" }}>
        {data.map((d) => (
          <Txt
            key={d.label}
            variant="caption"
            tone="body"
            center
            style={{ flex: 1 }}
          >
            {d.label}
          </Txt>
        ))}
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
      <Txt variant="caption" tone="charcoal">
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", gap: space.md },
  bars: {
    height: CHART_HEIGHT,
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  group: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 3,
  },
  bar: { width: 12, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
});
