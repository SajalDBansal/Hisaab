import { useState } from "react";
import { ScrollView, View } from "react-native";
import * as Crypto from "expo-crypto";
import Svg, { Line, Polyline } from "react-native-svg";
import {
  addDays,
  can,
  formatDate,
  formatINR,
  parseRupees,
  today,
  type Firm,
} from "@repo/core";
import {
  CashForecastRequest,
  ExpectedCashFlow,
  type CashForecast,
} from "@repo/contracts/src/cashForecast";
import {
  AmountField,
  Button,
  Checkbox,
  DateField,
  Header,
  IconButton,
  QueryView,
  Screen,
  Segmented,
  TaxScopeFilter,
  TextField,
  Txt,
} from "@/components";
import { useFirm } from "@/data/queries";
import { useData } from "@/data/DataProvider";
import { useCashForecast } from "@/data/cashForecastHook";
import { ReportPreferencesControls } from "@/data/reportPreferencesControls";
import { colors, space } from "@/theme";

export default function CashForecastScreen() {
  const data = useData();
  const firm = useFirm();
  return (
    <Screen
      header={<Header title="Cash forecast" subtitle={firm.data?.name} />}
    >
      {data.role && can(data.role, "reports") ? (
        <QueryView query={firm}>
          {(value) => (
            <ForecastForm
              key={`${data.userId}:${value.id}:${data.accessKey}`}
              firm={value}
            />
          )}
        </QueryView>
      ) : (
        <Txt tone="give">Report access is required for this firm.</Txt>
      )}
    </Screen>
  );
}

function ForecastForm({ firm }: { firm: Firm }) {
  const [request, setRequest] = useState<CashForecastRequest>({
    asOf: today(),
    to: addDays(today(), 30),
    tax: "all",
    includeOverdue: false,
    manualFlows: [],
  });
  const [result, setResult] = useState<CashForecast | null>(null);
  const [problem, setProblem] = useState("");
  const [flowProblem, setFlowProblem] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [flowLabel, setFlowLabel] = useState("");
  const [flowDate, setFlowDate] = useState(addDays(today(), 1));
  const [flowAmount, setFlowAmount] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [bookScope, setBookScope] = useState<"gst" | "nongst">(
    firm.gstRegistration === "unregistered" ? "nongst" : "gst",
  );
  const forecast = useCashForecast();
  const update = (patch: Partial<CashForecastRequest>) => {
    setRequest((value) => ({ ...value, ...patch }));
    setResult(null);
    setProblem("");
  };
  const clearFlow = () => {
    setEditId(null);
    setFlowLabel("");
    setFlowAmount("");
    setFlowProblem("");
  };
  const addFlow = () => {
    const parsed = ExpectedCashFlow.safeParse({
      id: editId ?? Crypto.randomUUID(),
      label: flowLabel,
      date: flowDate,
      amount: parseRupees(flowAmount),
      direction,
      bookScope,
    });
    if (!parsed.success) {
      setFlowProblem(parsed.error.issues[0].message);
      return;
    }
    if (flowDate <= request.asOf || flowDate > request.to) {
      setFlowProblem(
        "Choose a date after the as-of date and through the forecast end.",
      );
      return;
    }
    if (!editId && request.manualFlows.length >= 100) {
      setFlowProblem("Keep up to 100 expected flows.");
      return;
    }
    update({
      manualFlows: [
        ...request.manualFlows.filter((flow) => flow.id !== editId),
        parsed.data,
      ],
    });
    clearFlow();
  };
  const generate = async () => {
    setProblem("");
    setResult(null);
    if (editId || flowLabel.trim() || flowAmount.trim()) {
      setProblem(
        "Add or cancel the expected flow being edited before calculating.",
      );
      return;
    }
    const parsed = CashForecastRequest.safeParse(request);
    if (!parsed.success) {
      setProblem(parsed.error.issues[0].message);
      return;
    }
    try {
      setResult(await forecast.mutateAsync(parsed.data));
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Couldn't calculate the forecast.",
      );
    }
  };
  return (
    <View
      style={{
        width: "100%",
        maxWidth: 960,
        alignSelf: "center",
        gap: space.xl,
      }}
    >
      <Txt variant="small" tone="body">
        Management estimate from opening book cash/bank, outstanding due bills
        and manual expected flows. Collections are not guaranteed. This is not a
        statutory cash-flow statement.
      </Txt>
      <ReportPreferencesControls
        firmId={firm.id}
        value={{ kind: "forecast", request }}
        disabled={
          forecast.isPending ||
          !!editId ||
          !!flowLabel.trim() ||
          !!flowAmount.trim()
        }
        onLoad={(filter) => {
          if (filter.kind === "forecast") {
            setRequest(filter.request);
            setResult(null);
            setProblem("");
            clearFlow();
          }
        }}
      />
      <View
        pointerEvents={forecast.isPending ? "none" : "auto"}
        style={{ gap: space.lg, opacity: forecast.isPending ? 0.65 : 1 }}
      >
        <TaxScopeFilter
          value={request.tax}
          onChange={(tax) => update({ tax })}
        />
        <DateField
          label="Books as of"
          value={request.asOf}
          min={firm.fyStart}
          max={today()}
          onChange={(asOf) => update({ asOf })}
        />
        <TextField
          label="Forecast through (YYYY-MM-DD)"
          value={request.to}
          onChangeText={(to) => update({ to })}
          maxLength={10}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {[30, 60, 90].map((days) => (
            <Button
              key={days}
              label={`${days} days`}
              icon="calendar"
              size="sm"
              onPress={() => update({ to: addDays(request.asOf, days) })}
            />
          ))}
        </View>
        <Checkbox
          label="Include overdue bills on first forecast day"
          checked={request.includeOverdue}
          onChange={(includeOverdue) => update({ includeOverdue })}
        />
        <Txt variant="heading">Manual expected flows</Txt>
        <Txt variant="small" tone="body">
          Additional receipts or payments only. Outstanding bills are already
          included; internal cash/bank transfers have no net effect.
        </Txt>
        {request.manualFlows.map((flow) => (
          <View
            key={flow.id}
            style={{
              borderBottomWidth: 1,
              borderColor: colors.hairline,
              paddingVertical: space.sm,
              gap: space.sm,
            }}
          >
            <Txt variant="bodyStrong">{flow.label}</Txt>
            <Txt variant="small">
              {formatDate(flow.date)} /{" "}
              {flow.bookScope === "gst" ? "GST" : "Non-GST"} /{" "}
              {flow.direction === "in" ? "In" : "Out"}: {formatINR(flow.amount)}
            </Txt>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <IconButton
                icon="edit-2"
                label={`Edit ${flow.label}`}
                onPress={() => {
                  setEditId(flow.id);
                  setFlowLabel(flow.label);
                  setFlowDate(flow.date);
                  setFlowAmount((flow.amount / 100).toFixed(2));
                  setDirection(flow.direction);
                  setBookScope(flow.bookScope);
                  setFlowProblem("");
                }}
              />
              <IconButton
                icon="trash-2"
                label={`Remove ${flow.label}`}
                onPress={() => {
                  update({
                    manualFlows: request.manualFlows.filter(
                      (entry) => entry.id !== flow.id,
                    ),
                  });
                  if (editId === flow.id) clearFlow();
                }}
              />
            </View>
          </View>
        ))}
        <TextField
          label="Expected flow"
          value={flowLabel}
          onChangeText={setFlowLabel}
          maxLength={120}
        />
        <TextField
          label="Expected date (YYYY-MM-DD)"
          value={flowDate}
          onChangeText={setFlowDate}
          maxLength={10}
        />
        <AmountField
          label="Amount"
          value={flowAmount}
          onChangeText={setFlowAmount}
        />
        <Segmented
          options={[
            { value: "in", label: "Money in" },
            { value: "out", label: "Money out" },
          ]}
          value={direction}
          onChange={setDirection}
        />
        <Segmented
          options={[
            { value: "gst", label: "GST" },
            { value: "nongst", label: "Non-GST" },
          ]}
          value={bookScope}
          onChange={setBookScope}
        />
        {flowProblem ? (
          <Txt variant="small" tone="give">
            {flowProblem}
          </Txt>
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <Button
            label={editId ? "Update flow" : "Add expected flow"}
            icon={editId ? "check" : "plus"}
            onPress={addFlow}
          />
          {editId || flowLabel || flowAmount ? (
            <Button label="Discard flow edit" icon="x" onPress={clearFlow} />
          ) : null}
        </View>
      </View>
      {problem ? <Txt tone="give">{problem}</Txt> : null}
      <Button
        label="Calculate forecast"
        icon="trending-up"
        variant="primary"
        loading={forecast.isPending}
        onPress={() => void generate()}
      />
      {result ? <ForecastResult result={result} /> : null}
    </View>
  );
}

function Figure({ label, amount }: { label: string; amount: number }) {
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        gap: space.sm,
        paddingVertical: space.sm,
      }}
    >
      <Txt variant="small" style={{ flexShrink: 1 }}>
        {label}
      </Txt>
      <Txt variant="bodyStrong" tone={amount < 0 ? "give" : "ink"}>
        {formatINR(amount)}
      </Txt>
    </View>
  );
}

function ForecastResult({ result }: { result: CashForecast }) {
  const [showBills, setShowBills] = useState(false);
  const [showDays, setShowDays] = useState(false);
  return (
    <View style={{ gap: space.lg }}>
      <Txt variant="heading">Projected cash and bank</Txt>
      <Txt variant="small">
        {formatDate(result.from)} to {formatDate(result.to)}
      </Txt>
      <View>
        <Figure label="Opening cash" amount={result.opening.cash} />
        <Figure label="Opening bank" amount={result.opening.bank} />
        <Figure label="Due bill receipts" amount={result.totals.billInflows} />
        <Figure
          label="Due bill payments"
          amount={-result.totals.billOutflows}
        />
        <Figure label="Manual receipts" amount={result.totals.manualInflows} />
        <Figure
          label="Manual payments"
          amount={-result.totals.manualOutflows}
        />
        <Figure label="Projected closing" amount={result.totals.closing} />
        <Figure
          label="Lowest daily closing / opening"
          amount={result.minimumBalance}
        />
      </View>
      {result.firstShortfallDate ? (
        <Txt tone="give">
          First projected shortfall: {formatDate(result.firstShortfallDate)}
        </Txt>
      ) : null}
      <ForecastChart result={result} />
      <Txt variant="heading">Book reconciliation</Txt>
      {result.reconciliation.map((row) => (
        <Figure
          key={row.tax}
          label={`${row.tax === "all" ? "Mixed" : row.tax === "gst" ? "GST" : "Non-GST"} projected closing`}
          amount={row.closing}
        />
      ))}
      <Txt variant="heading">Excluded due bills</Txt>
      <Figure
        label="Overdue receipts excluded"
        amount={result.excluded.overdueInflows}
      />
      <Figure
        label="Overdue payments excluded"
        amount={result.excluded.overdueOutflows}
      />
      <Figure
        label="Receipts after forecast end"
        amount={result.excluded.laterInflows}
      />
      <Figure
        label="Payments after forecast end"
        amount={result.excluded.laterOutflows}
      />
      <Button
        label={showDays ? "Hide daily balances" : "Daily balances"}
        icon={showDays ? "chevron-up" : "chevron-down"}
        onPress={() => setShowDays(!showDays)}
      />
      {showDays ? (
        <ScrollView horizontal>
          <View style={{ width: 680 }}>
            <View style={{ flexDirection: "row", paddingVertical: space.sm }}>
              {["Date", "Opening", "In", "Out", "Closing"].map((label) => (
                <Txt key={label} variant="label" style={{ width: 136 }}>
                  {label}
                </Txt>
              ))}
            </View>
            {result.days.map((day) => (
              <View
                key={day.date}
                style={{
                  flexDirection: "row",
                  paddingVertical: space.sm,
                  borderTopWidth: 1,
                  borderColor: colors.hairline,
                }}
              >
                {[
                  formatDate(day.date),
                  formatINR(day.opening),
                  formatINR(day.inflows),
                  formatINR(day.outflows),
                  formatINR(day.closing),
                ].map((value, index) => (
                  <Txt
                    key={index}
                    variant="small"
                    style={{ width: 136, paddingRight: space.sm }}
                  >
                    {value}
                  </Txt>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
      <Button
        label={`${showBills ? "Hide" : "View"} due bills (${result.bills.length})`}
        icon={showBills ? "chevron-up" : "chevron-down"}
        onPress={() => setShowBills(!showBills)}
      />
      {showBills
        ? result.bills.map((bill) => (
            <View
              key={`${bill.bookScope}:${bill.id}`}
              style={{
                gap: space.sm,
                paddingVertical: space.sm,
                borderBottomWidth: 1,
                borderColor: colors.hairline,
              }}
            >
              <Txt variant="bodyStrong">
                {bill.partyName} / {bill.number}
              </Txt>
              <Txt variant="small">
                Due {formatDate(bill.dueDate)}; expected{" "}
                {formatDate(bill.expectedDate)} /{" "}
                {bill.bookScope === "gst" ? "GST" : "Non-GST"}
                {bill.overdue ? " / overdue" : ""}
              </Txt>
              <Figure
                label={bill.direction === "in" ? "Expected in" : "Expected out"}
                amount={bill.amount}
              />
            </View>
          ))
        : null}
      <Txt variant="heading">Assumptions</Txt>
      {result.assumptions.map((note) => (
        <Txt key={note} variant="small" tone="body">
          {note}
        </Txt>
      ))}
    </View>
  );
}

function ForecastChart({ result }: { result: CashForecast }) {
  const [width, setWidth] = useState(0);
  const values = [
    result.opening.total,
    ...result.days.map((day) => day.closing),
  ];
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = Math.max(1, high - low);
  const y = (value: number) => 140 - ((value - low) / span) * 130;
  return (
    <View style={{ gap: space.sm }}>
      <View
        style={{ height: 150 }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessibilityLabel={`Daily projected balances from ${formatINR(result.opening.total)} to ${formatINR(result.totals.closing)}; lowest ${formatINR(result.minimumBalance)}`}
      >
        {width > 20 ? (
          <Svg width={width} height={150}>
            <Line
              x1={0}
              x2={width}
              y1={y(0)}
              y2={y(0)}
              stroke={colors.hairlineStrong}
            />
            <Polyline
              fill="none"
              stroke={colors.ink}
              strokeWidth={2}
              strokeLinejoin="round"
              points={values
                .map(
                  (value, index) =>
                    `${10 + (index * (width - 20)) / (values.length - 1)},${y(value)}`,
                )
                .join(" ")}
            />
          </Svg>
        ) : null}
      </View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: space.sm,
        }}
      >
        <Txt variant="caption">{formatDate(result.asOf)}</Txt>
        <Txt variant="caption">{formatDate(result.to)}</Txt>
      </View>
    </View>
  );
}
