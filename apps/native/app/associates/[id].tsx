import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatINR, type TaxScope } from "@repo/core";
import type {
  AssociateDetail,
  AssociateStatementQuery,
} from "@repo/contracts/src/associates";
import {
  Button,
  Checkbox,
  DateField,
  EmptyState,
  Header,
  ListRow,
  QueryView,
  Screen,
  Segmented,
  TaxScopeFilter,
  Txt,
  showError,
} from "@/components";
import { AssociateGate } from "@/components/associates/AssociateGate";
import { DeliveryEditor } from "@/components/associates/DeliveryEditor";
import { PayoutReversal } from "@/components/associates/PayoutReversal";
import {
  useAssociate,
  useAssociateFields,
  useAssociateStatement,
} from "@/data/associateHooks";
import { useFirm } from "@/data/queries";
import { associateStatementReport } from "@/data/associateReport";
import { saveReportFile } from "@/data/reportFile";
import { space } from "@/theme";

export default function AssociateProfile() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const query = useAssociate(id);
  return (
    <Screen
      header={<Header title={query.data?.associate.name ?? "Associate"} />}
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      <AssociateGate>
        <QueryView query={query}>
          {(detail) => <Profile detail={detail} />}
        </QueryView>
      </AssociateGate>
    </Screen>
  );
}
function Profile({ detail }: { detail: AssociateDetail }) {
  const { associate, deliveries, payouts } = detail;
  const [view, setView] = useState<
    "profile" | "deliveries" | "sales" | "statement" | "payouts"
  >("profile");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [scope, setScope] = useState<TaxScope>("all");
  const [unpaid, setUnpaid] = useState(false);
  const [status, setStatus] = useState("all");
  const [editingDelivery, setEditingDelivery] = useState<string | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const filters: AssociateStatementQuery = {
    from: from || undefined,
    to: to || undefined,
    scope,
    unpaidOnly: unpaid ? "true" : "false",
  };
  const statement = useAssociateStatement(associate.id, filters);
  const fields = useAssociateFields();
  const firm = useFirm();
  const exportFile = async (format: "csv" | "pdf") => {
    if (!statement.data || !firm.data) return;
    setExporting(true);
    try {
      await saveReportFile(
        associateStatementReport(firm.data, associate, statement.data, filters),
        format,
      );
    } catch (error) {
      showError("Couldn't export statement", error);
    } finally {
      setExporting(false);
    }
  };
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <Button
          label="Edit profile"
          icon="edit-2"
          onPress={() =>
            router.push({
              pathname: "/associates/new",
              params: { id: associate.id },
            })
          }
        />
        {associate.commission ? (
          <Button
            label="Record payout"
            icon="credit-card"
            onPress={() =>
              router.push({
                pathname: "/associates/payout",
                params: { id: associate.id },
              })
            }
          />
        ) : null}
      </View>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "profile", label: "Profile" },
          { value: "deliveries", label: "Deliveries" },
          { value: "sales", label: "Sales" },
        ]}
      />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "statement", label: "Statement" },
          { value: "payouts", label: "Payouts" },
        ]}
      />
      {view === "profile" ? (
        <>
          <Txt variant="bodyStrong">
            {associate.roles.join(", ")}
            {associate.active ? "" : " | Archived"}
          </Txt>
          <Txt>
            {[associate.phone, associate.email, associate.address]
              .filter(Boolean)
              .join("\n") || "No contact details"}
          </Txt>
          {associate.delivery ? (
            <Txt>
              {associate.delivery.vehicle} | {associate.delivery.area}
            </Txt>
          ) : null}
          {associate.commission ? (
            <Txt>
              Commission {associate.commission.rate}% | Effective{" "}
              {associate.commission.effectiveFrom}
            </Txt>
          ) : null}
          {(fields.data ?? [])
            .filter((f) => associate.fields[f.id] !== undefined)
            .map((field) => (
              <Txt key={field.id}>
                {field.name}: {String(associate.fields[field.id])}
              </Txt>
            ))}
          {associate.notes ? <Txt>{associate.notes}</Txt> : null}
        </>
      ) : (
        <>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}
          >
            <DateField label="From" value={from} onChange={setFrom} />
            <DateField label="To" value={to} onChange={setTo} />
          </View>
          {from || to ? (
            <Button
              label="Clear dates"
              icon="x"
              onPress={() => {
                setFrom("");
                setTo("");
              }}
            />
          ) : null}
          {view === "deliveries" ? (
            <>
              <Segmented
                value={status}
                onChange={setStatus}
                options={[
                  { value: "all", label: "All" },
                  { value: "assigned", label: "Assigned" },
                  { value: "dispatched", label: "Dispatched" },
                ]}
              />
              <Segmented
                value={status}
                onChange={setStatus}
                options={[
                  { value: "delivered", label: "Delivered" },
                  { value: "failed", label: "Failed" },
                  { value: "returned", label: "Returned" },
                ]}
              />
              {deliveries
                .filter(
                  (d) =>
                    (!from || d.date >= from) &&
                    (!to || d.date <= to) &&
                    (status === "all" || d.status === status),
                )
                .map((d) => (
                  <View key={d.id} style={{ gap: space.sm }}>
                    <ListRow
                      title={d.voucherNumber}
                      subtitle={`${d.date} | ${d.status} | ${d.snapshot.name} | ${d.snapshot.vehicle}${d.active ? "" : " | Historical"}`}
                      onPress={() => router.push(`/voucher/${d.voucherId}`)}
                      chevron
                    />
                    <Button
                      label="Document / proof of delivery"
                      icon="paperclip"
                      onPress={() => router.push(`/voucher/${d.voucherId}`)}
                    />
                    {editingDelivery === d.id ? (
                      <DeliveryEditor
                        key={d.id}
                        assignment={d}
                        done={() => setEditingDelivery(null)}
                      />
                    ) : d.active ? (
                      <Button
                        label="Update status"
                        icon="edit-2"
                        onPress={() => setEditingDelivery(d.id)}
                      />
                    ) : null}
                  </View>
                ))}
              {!deliveries.length ? (
                <EmptyState title="No deliveries assigned" />
              ) : null}
            </>
          ) : view === "payouts" ? (
            <>
              {payouts
                .filter(
                  (p) => (!from || p.date >= from) && (!to || p.date <= to),
                )
                .map((p) => (
                  <View key={p.id} style={{ gap: space.sm }}>
                    <ListRow
                      title={`${p.date} | ${formatINR(p.amount)}`}
                      subtitle={`${p.reference}${p.reversedOn ? ` | Reversed ${p.reversedOn}: ${p.reversalReason}` : ""}`}
                    />
                    {reversing === p.id ? (
                      <PayoutReversal
                        key={p.id}
                        payout={p}
                        done={() => setReversing(null)}
                      />
                    ) : !p.reversedOn ? (
                      <Button
                        label="Reverse payout"
                        icon="rotate-ccw"
                        onPress={() => setReversing(p.id)}
                      />
                    ) : null}
                  </View>
                ))}
              {!payouts.length ? (
                <EmptyState title="No recorded payouts" />
              ) : null}
            </>
          ) : (
            <>
              <TaxScopeFilter value={scope} onChange={setScope} />
              <Checkbox
                label="Unsettled sales only"
                checked={unpaid}
                onChange={setUnpaid}
              />
              <QueryView query={statement}>
                {(data) => (
                  <View style={{ gap: space.md }}>
                    {view === "statement" ? (
                      <>
                        <Txt>Opening due {formatINR(data.opening)}</Txt>
                        <Txt>
                          Earned {formatINR(data.earned)} | Adjustments{" "}
                          {formatINR(data.adjusted)} | Paid{" "}
                          {formatINR(data.paid)}
                        </Txt>
                        <Txt variant="bodyStrong">
                          {data.closing < 0 ? "Recoverable" : "Closing due"}{" "}
                          {formatINR(Math.abs(data.closing))}
                        </Txt>
                        <Txt tone={data.difference ? "give" : "body"}>
                          Payable ledger {formatINR(data.ledgerBalance)} |
                          Difference {formatINR(data.difference)}
                        </Txt>
                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: space.sm,
                          }}
                        >
                          <Button
                            label="CSV"
                            icon="download"
                            loading={exporting}
                            disabled={!firm.data}
                            onPress={() => void exportFile("csv")}
                          />
                          <Button
                            label="PDF"
                            icon="file-text"
                            loading={exporting}
                            disabled={!firm.data}
                            onPress={() => void exportFile("pdf")}
                          />
                        </View>
                        {data.rows.map((entry) => (
                          <ListRow
                            key={entry.id}
                            title={entry.description}
                            subtitle={`${entry.date} | ${entry.bookScope} | ${formatINR(entry.amount)}`}
                            onPress={
                              entry.journalId
                                ? () =>
                                    router.push(`/voucher/${entry.journalId}`)
                                : undefined
                            }
                            chevron={!!entry.journalId}
                          />
                        ))}
                      </>
                    ) : data.accruals.length ? (
                      data.accruals.map((a) => (
                        <ListRow
                          key={a.id}
                          title={`${a.date} | Line ${a.lineIndex + 1}`}
                          subtitle={`Net items ${formatINR(a.basis)} | ${a.snapshot.rate}% | Earned ${formatINR(a.earned)} | Balance ${formatINR(a.balance)}${a.active ? "" : " | Replaced"}`}
                          onPress={() => router.push(`/voucher/${a.saleId}`)}
                          chevron
                        />
                      ))
                    ) : (
                      <EmptyState title="No commission sales" />
                    )}
                  </View>
                )}
              </QueryView>
            </>
          )}
        </>
      )}
    </View>
  );
}
