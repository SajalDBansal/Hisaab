import { useMemo, useState } from "react";
import { View } from "react-native";
import { ReportRequest as RequestSchema } from "@repo/contracts";
import {
  REPORT_IDS,
  REPORTS,
  addDays,
  financialYear,
  periodRange,
  reportHtml,
  today,
  type Firm,
  type ReportDocument,
  type ReportId,
  type ReportRequest,
} from "@repo/core";
import {
  Button,
  Checkbox,
  DateField,
  Header,
  HtmlPreview,
  PickerSheet,
  QueryView,
  Screen,
  TaxScopeFilter,
  Segmented,
  SelectField,
  Txt,
  type PickerOption,
} from "@/components";
import { useChart, useExportReport, useFirm, useParties } from "@/data/queries";
import { saveReportFile, type ReportFormat } from "@/data/reportFile";
import { ReportPreferencesControls } from "@/data/reportPreferencesControls";
import { space } from "@/theme";

function periodOptions(firm: Firm) {
  const now = today();
  const fy = financialYear(now);
  const previous = financialYear(addDays(fy.start, -1));
  return [
    { id: "today", title: "Today", from: now, to: now },
    { id: "month", title: "This month", ...periodRange("this-month", now) },
    {
      id: "last-month",
      title: "Last month",
      ...periodRange("last-month", now),
    },
    { id: "fy", title: `FY ${fy.label}`, from: fy.start, to: now },
    {
      id: "previous-fy",
      title: `FY ${previous.label}`,
      from: previous.start,
      to: previous.end,
    },
  ]
    .filter((p) => p.to >= firm.fyStart)
    .map((p) => ({
      ...p,
      from: p.from < firm.fyStart ? firm.fyStart : p.from,
    }));
}

/** Keep all options and the preview local to the selected firm. */
export default function DownloadReportsScreen() {
  const firm = useFirm();
  return (
    <Screen
      header={<Header title="Download reports" subtitle={firm.data?.name} />}
    >
      <QueryView query={firm}>
        {(f) => <ReportForm key={f.id} firm={f} />}
      </QueryView>
    </Screen>
  );
}

function ReportForm({ firm }: { firm: Firm }) {
  const chart = useChart();
  const parties = useParties();
  const exporter = useExportReport();
  const periods = useMemo(() => periodOptions(firm), [firm]);
  const initial = periods.find((p) => p.id === "fy")!;
  const [request, setRequest] = useState<ReportRequest>({
    tax: "all",
    report: "trial-balance",
    from: initial.from,
    to: initial.to,
    includeNarration: true,
    includeZeroBalances: false,
  });
  const [period, setPeriod] = useState("fy");
  const [format, setFormat] = useState<ReportFormat>("pdf");
  const [picker, setPicker] = useState<
    "report" | "period" | "account" | "party" | null
  >(null);
  const [preview, setPreview] = useState<ReportDocument | null>(null);
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);
  const [problem, setProblem] = useState("");
  const definition = REPORTS[request.report];
  const update = (patch: Partial<ReportRequest>) => {
    setRequest((current) => ({ ...current, ...patch }));
    setPreview(null);
    setProblem("");
  };
  const accountOptions: PickerOption[] = (chart.data ?? [])
    .flatMap((g) => g.accounts)
    .filter(
      (a) =>
        definition.accounts === "all" ||
        a.group ===
          (definition.accounts === "cash" ? "Cash-in-hand" : "Bank Accounts"),
    )
    .map((a) => ({ id: a.key, title: a.name, subtitle: a.group }));
  const partyOptions = (parties.data ?? [])
    .map((p) => p.party)
    .filter((p) =>
      request.report === "receivables"
        ? p.type === "customer"
        : request.report === "payables"
          ? p.type === "supplier"
          : true,
    )
    .map((p) => ({ id: p.id, title: p.name }));
  const options: PickerOption[] =
    picker === "report"
      ? REPORT_IDS.map((id) => ({
          id,
          title: REPORTS[id].title,
          subtitle: REPORTS[id].category,
        }))
      : picker === "period"
        ? [...periods, { id: "custom", title: "Custom dates" }]
        : picker === "account"
          ? [{ id: "", title: "All accounts" }, ...accountOptions]
          : [{ id: "", title: "All parties" }, ...partyOptions];

  const select = (id: string) => {
    if (picker === "report")
      update({
        report: id as ReportId,
        accountKey: undefined,
        partyId: undefined,
      });
    if (picker === "account") update({ accountKey: id || undefined });
    if (picker === "party") update({ partyId: id || undefined });
    if (picker === "period") {
      setPeriod(id);
      const range = periods.find((p) => p.id === id);
      if (range) update({ from: range.from, to: range.to });
    }
    setPicker(null);
  };

  const generate = async (action: "preview" | "download") => {
    setProblem("");
    const parsed = RequestSchema.safeParse({
      ...request,
      from: definition.asOf ? firm.fyStart : request.from,
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0].message);
      return;
    }
    setBusy(action);
    try {
      const report = await exporter.mutateAsync(parsed.data);
      setPreview(report);
      if (action === "download") await saveReportFile(report, format);
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Couldn't create the report. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  };
  const html = useMemo(() => (preview ? reportHtml(preview) : ""), [preview]);

  return (
    <View
      style={{
        gap: space.xl,
        width: "100%",
        maxWidth: 960,
        alignSelf: "center",
      }}
    >
      <ReportPreferencesControls
        firmId={firm.id}
        value={{ kind: "report", request, format }}
        disabled={!!busy}
        onLoad={(filter) => {
          if (filter.kind !== "report") return;
          setRequest(filter.request);
          setFormat(filter.format);
          setPeriod("custom");
          setPreview(null);
          setProblem("");
        }}
      />
      <View
        pointerEvents={busy ? "none" : "auto"}
        style={{ gap: space.lg, opacity: busy ? 0.65 : 1 }}
      >
        <SelectField
          label="Report"
          value={definition.title}
          onPress={() => setPicker("report")}
        />
        <TaxScopeFilter
          value={request.tax ?? "all"}
          onChange={(tax) => update({ tax })}
        />
        <SelectField
          label="Period"
          value={periods.find((p) => p.id === period)?.title ?? "Custom dates"}
          onPress={() => setPicker("period")}
        />
        <View style={{ flexDirection: "row", gap: space.md }}>
          {!definition.asOf && (
            <View style={{ flex: 1 }}>
              <DateField
                label="From"
                value={request.from}
                min={firm.fyStart}
                max={today()}
                onChange={(from) => {
                  setPeriod("custom");
                  update({ from });
                }}
              />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <DateField
              label={definition.asOf ? "As at" : "To"}
              value={request.to}
              min={firm.fyStart}
              max={today()}
              onChange={(to) => {
                setPeriod("custom");
                update({ to });
              }}
            />
          </View>
        </View>
        {definition.accounts && (
          <SelectField
            label="Account"
            value={
              accountOptions.find((a) => a.id === request.accountKey)?.title ??
              "All accounts"
            }
            onPress={() => setPicker("account")}
          />
        )}
        {definition.parties && (
          <SelectField
            label="Party"
            value={
              partyOptions.find((p) => p.id === request.partyId)?.title ??
              "All parties"
            }
            onPress={() => setPicker("party")}
          />
        )}
        {((definition.accounts && chart.isError) ||
          (definition.parties && parties.isError)) && (
          <Button
            label="Retry account and party lists"
            icon="refresh-cw"
            onPress={() => {
              void chart.refetch();
              void parties.refetch();
            }}
          />
        )}
        <View style={{ gap: space.sm }}>
          <Txt variant="label">File format</Txt>
          <Segmented
            options={[
              { value: "pdf", label: "PDF" },
              { value: "csv", label: "CSV (Excel)" },
            ]}
            value={format}
            onChange={setFormat}
          />
        </View>
        <View>
          {(definition.accounts ||
            [
              "daybook",
              "journal",
              "sales-register",
              "purchase-register",
              "credit-notes",
              "debit-notes",
              "receipts",
              "payments",
            ].includes(request.report)) && (
            <Checkbox
              label="Include narration"
              checked={request.includeNarration}
              onChange={(includeNarration) => update({ includeNarration })}
            />
          )}
          {definition.zeroBalances && (
            <Checkbox
              label={
                request.report === "stock"
                  ? "Include zero-stock items"
                  : "Include inactive / zero-balance accounts"
              }
              checked={request.includeZeroBalances}
              onChange={(includeZeroBalances) =>
                update({ includeZeroBalances })
              }
            />
          )}
        </View>
      </View>
      {problem ? (
        <Txt tone="give" variant="small">
          {problem}
        </Txt>
      ) : null}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button
          label="Preview"
          icon="eye"
          block
          loading={busy === "preview"}
          disabled={!!busy}
          onPress={() => void generate("preview")}
        />
        <Button
          label="Download"
          icon="download"
          block
          variant="primary"
          loading={busy === "download"}
          disabled={!!busy}
          onPress={() => void generate("download")}
        />
      </View>
      {preview && (
        <View style={{ gap: space.md }}>
          <Txt variant="heading">{preview.title}</Txt>
          <Txt variant="small" tone="body">
            {preview.period}
          </Txt>
          {preview.notes
            .filter((note) => note.startsWith("WARNING:"))
            .map((note) => (
              <Txt key={note} variant="small" tone="give">
                {note}
              </Txt>
            ))}
          <HtmlPreview
            html={html}
            height={480}
            pageWidth={
              preview.sections.some((s) => s.columns.length > 5) ? 1120 : 800
            }
          />
        </View>
      )}
      <PickerSheet
        visible={!!picker}
        title={
          picker === "report"
            ? "Select report"
            : picker === "period"
              ? "Select period"
              : picker === "account"
                ? "Select account"
                : "Select party"
        }
        options={options}
        onSelect={select}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}
