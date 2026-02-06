import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { randomUUID } from "expo-crypto";
import {
  isFinancialImport,
  type ImportApplyResult,
  type ImportKind,
  type ImportPreview,
} from "@repo/contracts/src/imports";
import { formatAmount } from "@repo/core";
import {
  Button,
  Checkbox,
  Header,
  KeyValue,
  Notice,
  Screen,
  Segmented,
  Txt,
} from "@/components";
import { useData } from "@/data/DataProvider";
import { pickImportFile, saveImportFile } from "@/data/importFiles";
import { useMasterImports } from "@/data/importHooks";
import { colors, space } from "@/theme";

export default function ImportsScreen() {
  const { accessKey } = useData();
  return <FirmImports key={accessKey} />;
}

function FirmImports() {
  const imports = useMasterImports();
  const { role } = useData();
  const [kind, setKind] = useState<ImportKind>("customers");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportApplyResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [errorPage, setErrorPage] = useState(0);
  const inFlight = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "The import could not be completed.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setConfirmed(false);
    setRequestKey("");
    setProblem(null);
    setPage(0);
    setErrorPage(0);
  };
  const review = async (selected: { name: string; text: string }) => {
    setConfirmed(false);
    setPreview(null);
    setResult(null);
    setPage(0);
    setErrorPage(0);
    const next = await imports.preview.mutateAsync({
      kind,
      text: selected.text,
    });
    setPreview(next);
    setRequestKey(randomUUID());
  };
  const apply = async () => {
    if (!file || !preview?.previewToken || !confirmed) return;
    const response = await imports.apply.mutateAsync({
      body: {
        kind,
        text: file.text,
        previewToken: preview.previewToken,
        confirmed: true,
      },
      requestKey,
    });
    if (response.status === "invalid") {
      setPreview(response.preview);
      setConfirmed(false);
      setErrorPage(0);
      setProblem(
        "The firm changed after preview. Nothing was imported. Review the errors.",
      );
    } else {
      setResult(response.result);
      setPreview(null);
      setFile(null);
      setConfirmed(false);
    }
  };
  const columns = preview?.rows[0] ? Object.keys(preview.rows[0].values) : [];
  const financial = isFinancialImport(kind);
  const chooseKind = (value: ImportKind) => {
    if (!inFlight.current) {
      reset();
      setKind(value);
    }
  };
  return (
    <Screen header={<Header title="CSV imports" />}>
      {!imports.allowed ? (
        <Notice
          tone="warn"
          text="Sign in as the firm's owner or accountant to import masters."
        />
      ) : (
        <>
          {role === "owner" ? (
            <Segmented
              options={[
                { value: "masters", label: "Masters" },
                { value: "openings", label: "Openings" },
              ]}
              value={financial ? "openings" : "masters"}
              onChange={(value) =>
                chooseKind(
                  value === "openings" ? "opening-balances" : "customers",
                )
              }
            />
          ) : null}
          <Segmented
            options={
              financial
                ? [
                    { value: "opening-balances", label: "Balances" },
                    { value: "open-bills", label: "Open bills" },
                    { value: "opening-stock", label: "Stock" },
                  ]
                : [
                    { value: "customers", label: "Customers" },
                    { value: "suppliers", label: "Suppliers" },
                    { value: "items", label: "Items" },
                  ]
            }
            value={kind}
            onChange={chooseKind}
          />
          <KeyValue label="Import limit" value="500 records / 256 KiB" />
          <KeyValue label="Amounts" value="Rupees, up to 2 decimals" />
          <KeyValue
            label="Import mode"
            value={financial ? "Owner-reviewed cutover" : "New masters only"}
          />
          <Button
            label="Download template"
            icon="download"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const template = await imports.template.mutateAsync(kind);
                await saveImportFile(template.fileName, template.text);
              })
            }
          />
          <Button
            label="Choose CSV"
            icon="upload"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const selected = await pickImportFile();
                if (!selected) return;
                reset();
                setFile(selected);
                await review(selected);
              })
            }
          />
          {file ? (
            <>
              <Txt variant="small" style={{ flexShrink: 1 }}>
                {file.name}
              </Txt>
              <Button
                label="Preview again"
                icon="refresh-cw"
                disabled={busy}
                onPress={() => void run(() => review(file))}
              />
            </>
          ) : null}
          {problem ? <Notice tone="warn" text={problem} /> : null}
          {busy ? (
            <Txt variant="small" tone="body">
              Processing...
            </Txt>
          ) : null}
          {preview ? (
            <>
              <KeyValue label="Records" value={String(preview.rowCount)} />
              <KeyValue
                label="Valid records"
                value={String(preview.validRows)}
              />
              {preview.reconciliation ? (
                <View style={{ gap: space.sm }}>
                  <Txt variant="heading">Reconciliation</Txt>
                  {preview.reconciliation.totals.map((total) => (
                    <View key={total.scope} style={{ gap: space.xs }}>
                      <Txt variant="label">
                        {total.scope === "all"
                          ? "Mixed"
                          : total.scope === "gst"
                            ? "GST"
                            : "Non-GST"}
                      </Txt>
                      <KeyValue
                        label="Opening debits"
                        value={formatAmount(total.debit)}
                      />
                      <KeyValue
                        label="Opening credits"
                        value={formatAmount(total.credit)}
                      />
                      <KeyValue
                        label="Capital offset (Dr + / Cr -)"
                        value={formatAmount(total.capital)}
                      />
                      <KeyValue
                        label="Stock value"
                        value={formatAmount(total.stockValue)}
                      />
                      <KeyValue
                        label="Allocated open bills"
                        value={formatAmount(total.billAmount)}
                      />
                    </View>
                  ))}
                  <KeyValue
                    label="Reconciled"
                    value={preview.reconciliation.reconciled ? "Yes" : "No"}
                  />
                  {preview.reconciliation.parties
                    .filter(
                      (p) =>
                        p.expected !== p.actual ||
                        p.expectedGst !== p.actualGst,
                    )
                    .slice(0, 10)
                    .map((p) => (
                      <Notice
                        key={p.partyId}
                        tone="warn"
                        text={`Party ${p.partyId}: opening ${formatAmount(p.expected)}, bills ${formatAmount(p.actual)}; GST opening ${formatAmount(p.expectedGst)}, bills ${formatAmount(p.actualGst)}.`}
                      />
                    ))}
                </View>
              ) : null}
              {preview.errors.length ? (
                <View style={{ gap: space.sm }}>
                  <Txt variant="heading">Row errors</Txt>
                  {preview.errors
                    .slice(errorPage * 10, (errorPage + 1) * 10)
                    .map((error, index) => (
                      <Txt
                        key={`${errorPage}:${index}`}
                        variant="small"
                        style={{ flexShrink: 1 }}
                      >
                        {`Record ${error.row}, ${error.field}: ${error.message}`}
                      </Txt>
                    ))}
                  {preview.errorsTruncated ? (
                    <Notice
                      tone="warn"
                      text="More errors exist. Correct these errors and preview again."
                    />
                  ) : null}
                  <PageControls
                    page={errorPage}
                    count={preview.errors.length}
                    setPage={setErrorPage}
                  />
                  <Button
                    label="Download errors"
                    icon="download"
                    disabled={busy}
                    onPress={() =>
                      void run(() =>
                        saveImportFile(
                          `hisaab-${kind}-errors.csv`,
                          preview.errorsCsv,
                        ),
                      )
                    }
                  />
                </View>
              ) : null}
              {preview.rows.length ? (
                <View style={{ gap: space.sm }}>
                  <Txt variant="heading">Preview</Txt>
                  <ScrollView horizontal style={{ flexGrow: 0 }}>
                    <View>
                      <View
                        style={{
                          flexDirection: "row",
                          backgroundColor: colors.surfaceSoft,
                        }}
                      >
                        {["Record", ...columns].map((column) => (
                          <Txt
                            key={column}
                            variant="label"
                            style={{ width: 140, padding: space.sm }}
                          >
                            {column}
                          </Txt>
                        ))}
                      </View>
                      {preview.rows
                        .slice(page * 10, (page + 1) * 10)
                        .map((row) => (
                          <View
                            key={row.row}
                            style={{
                              flexDirection: "row",
                              borderBottomWidth: 1,
                              borderBottomColor: colors.hairline,
                            }}
                          >
                            {[
                              String(row.row),
                              ...columns.map(
                                (column) => row.values[column] || "-",
                              ),
                            ].map((value, index) => (
                              <Txt
                                key={index}
                                variant="small"
                                style={{
                                  width: 140,
                                  padding: space.sm,
                                  flexShrink: 0,
                                }}
                              >
                                {value}
                              </Txt>
                            ))}
                          </View>
                        ))}
                    </View>
                  </ScrollView>
                  <PageControls
                    page={page}
                    count={preview.rows.length}
                    setPage={setPage}
                  />
                </View>
              ) : null}
              {preview.canApply && preview.previewToken ? (
                <>
                  <Checkbox
                    label={
                      financial
                        ? `Confirm all ${preview.rowCount} opening records and the GST, non-GST and mixed totals. No existing opening will be overwritten.`
                        : `Create all ${preview.rowCount} new ${kind}. Existing records will not be updated.`
                    }
                    checked={confirmed}
                    onChange={(value) => {
                      if (!busy) setConfirmed(value);
                    }}
                  />
                  <Button
                    label="Confirm import"
                    icon="check"
                    variant="primary"
                    disabled={busy || !confirmed}
                    onPress={() => void run(apply)}
                  />
                </>
              ) : null}
            </>
          ) : null}
          {result ? (
            <Notice
              tone="info"
              text={`${result.createdCount} ${result.kind} imported.`}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

function PageControls({
  page,
  count,
  setPage,
}: {
  page: number;
  count: number;
  setPage: (page: number) => void;
}) {
  if (count <= 10) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: space.sm,
      }}
    >
      <Button
        label="Previous"
        icon="chevron-left"
        size="sm"
        disabled={page === 0}
        onPress={() => setPage(page - 1)}
      />
      <Txt variant="small">
        {page + 1} / {Math.ceil(count / 10)}
      </Txt>
      <Button
        label="Next"
        icon="chevron-right"
        size="sm"
        disabled={(page + 1) * 10 >= count}
        onPress={() => setPage(page + 1)}
      />
    </View>
  );
}
