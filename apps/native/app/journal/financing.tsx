import { router } from "expo-router";
import { useState } from "react";
import { BookScopeField, useBookScope } from "@/components/BookScopeField";
import { View } from "react-native";
import {
  allowedDates,
  FINANCING_ENTRIES,
  financingGroups,
  financingLines,
  formatINR,
  parseRupees,
  today,
  type AccountInfo,
  type FinancingKind,
} from "@repo/core";
import {
  AmountField,
  Button,
  DateField,
  FooterBar,
  Header,
  PickerSheet,
  PostingTable,
  QueryView,
  Screen,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useCreateJournal, usePickableAccounts } from "@/data/queries";
import { space } from "@/theme";
import { AttachmentPicker } from "@/documents/AttachmentPicker";
import { useFinancialAttachments } from "@/documents/useFinancialAttachments";

export default function FinancingScreen() {
  const accounts = usePickableAccounts();
  return (
    <Screen header={<Header close title="Loan & capital entry" />}>
      <QueryView query={accounts}>
        {(rows) => <EntryForm accounts={rows} />}
      </QueryView>
    </Screen>
  );
}

function EntryForm({ accounts }: { accounts: AccountInfo[] }) {
  const attachments = useFinancialAttachments();
  const create = useCreateJournal();
  const [kind, setKind] = useState<FinancingKind>("loan-in");
  const [date, setDate] = useState(today());
  const [bookScope, setBookScope] = useBookScope();
  const [accountKey, setAccountKey] = useState("");
  const [bankKey, setBankKey] = useState("");
  const [principalText, setPrincipal] = useState("");
  const [interestText, setInterest] = useState("");
  const [note, setNote] = useState("");
  const [picker, setPicker] = useState<"kind" | "account" | "bank" | null>(
    null,
  );
  const account = accounts.find((a) => a.key === accountKey);
  const bank = accounts.find((a) => a.key === bankKey);
  const interestOnly = kind.startsWith("interest-");
  const hasInterest =
    interestOnly || kind === "loan-repay" || kind === "loan-recover";
  const principal = interestOnly ? 0 : parseRupees(principalText);
  const interest = hasInterest ? parseRupees(interestText || "0") : 0;
  const title = FINANCING_ENTRIES.find((e) => e.id === kind)!.title;
  let problem = "";
  let lines: ReturnType<typeof financingLines> = [];
  try {
    if (!account) throw new Error("Choose the loan or capital ledger.");
    if (principal === null || interest === null)
      throw new Error("Enter valid amounts.");
    lines = financingLines({ kind, account, bank, principal, interest });
  } catch (e) {
    problem = (e as Error).message;
  }

  const save = async () => {
    if (problem || !account) return;
    try {
      const saved = await attachments.save(
        "/journals",
        {
          bookScope,
          date,
          lines,
          narration: `${title}: ${account.name}${note.trim() ? ` - ${note.trim()}` : ""}`,
        },
        create.mutateAsync,
      );
      router.replace(`/voucher/${saved.id}`);
    } catch (e) {
      showError("Couldn't save entry", e);
    }
  };

  const options =
    picker === "kind"
      ? FINANCING_ENTRIES.map((e) => ({ id: e.id, title: e.title }))
      : accounts
          .filter((a) =>
            picker === "bank"
              ? ["Cash-in-hand", "Bank Accounts"].includes(a.group)
              : financingGroups(kind).includes(a.group),
          )
          .map((a) => ({ id: a.key, title: a.name, subtitle: a.group }));

  return (
    <View style={{ gap: space.lg }}>
      <SelectField
        label="Entry type"
        value={title}
        onPress={() => setPicker("kind")}
      />
      <DateField
        value={date}
        onChange={setDate}
        min={allowedDates().min}
        max={allowedDates().max}
      />
      <SelectField
        label="Loan / capital ledger"
        value={account?.name}
        onPress={() => setPicker("account")}
      />
      <Button
        label="New ledger"
        icon="plus"
        onPress={() => router.push("/account/new")}
      />
      {kind !== "interest-due" ? (
        <SelectField
          label="Cash / bank"
          value={bank?.name}
          onPress={() => setPicker("bank")}
        />
      ) : null}
      {!interestOnly ? (
        <AmountField
          label="Principal (Rs)"
          value={principalText}
          onChangeText={setPrincipal}
        />
      ) : null}
      {hasInterest ? (
        <AmountField
          label="Interest for this entry (Rs)"
          value={interestText}
          onChangeText={setInterest}
        />
      ) : null}
      <View style={{ flexDirection: "row" }}>
        <TextField
          label="Narration / reference"
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={200}
        />
      </View>
      <AttachmentPicker {...attachments} />
      <BookScopeField value={bookScope} onChange={setBookScope} />
      {lines.length ? (
        <PostingTable rows={lines.map((l) => ({ ...l, ledger: l.name }))} />
      ) : null}
      <FooterBar>
        <View style={{ flex: 1 }}>
          <Txt variant="small" num>
            {formatINR(lines.reduce((s, l) => s + l.debit, 0))}
          </Txt>
          {problem ? (
            <Txt variant="caption" tone="body">
              {problem}
            </Txt>
          ) : null}
        </View>
        <Button
          label="Save entry"
          icon="check"
          variant="primary"
          onPress={save}
          disabled={!!problem}
          loading={create.isPending || attachments.busy}
        />
      </FooterBar>
      <PickerSheet
        visible={picker !== null}
        title={picker === "kind" ? "Entry type" : "Account"}
        options={options}
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          if (picker === "kind") {
            setKind(id as FinancingKind);
            setAccountKey("");
          } else if (picker === "account") setAccountKey(id);
          else setBankKey(id);
          setPicker(null);
        }}
      />
    </View>
  );
}
