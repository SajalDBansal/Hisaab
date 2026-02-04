import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { DocumentKind, NewDocumentInput } from "@repo/core";
import {
  Button,
  FooterBar,
  Header,
  Notice,
  PickerSheet,
  Screen,
  SelectField,
  TextField,
  showError,
} from "@/components";
import { useData } from "@/data/DataProvider";
import { attachmentRetry } from "@/data/attachmentRecovery";
import { documentKindLabel } from "@/data/labels";
import {
  useDocumentFolders,
  useParties,
  usePickableAccounts,
} from "@/data/queries";
import { space } from "@/theme";
import { AttachmentPicker } from "./AttachmentPicker";
import { useEntryAttachments } from "./useEntryAttachments";

const kinds: DocumentKind[] = [
  "bill",
  "receipt",
  "certificate",
  "agreement",
  "other",
];
const titles = {
  kind: "Document type",
  folder: "Folder",
  partyId: "Party",
  accountKey: "Ledger / account",
};
type Picker = keyof typeof titles;
type Details = Omit<NewDocumentInput, "name">;

export function LibraryDocumentForm() {
  const { userId, firmId } = useData();
  return <LibraryFields key={JSON.stringify([userId, firmId])} />;
}

function LibraryFields() {
  const params = useLocalSearchParams<{
    folder?: string;
    accountKey?: string;
    voucherId?: string;
    partyId?: string;
  }>();
  const attachments = useEntryAttachments("library", "library");
  const parties = useParties();
  const accounts = usePickableAccounts();
  const folders = useDocumentFolders();
  const mounted = useRef(true);
  const [details, setDetails] = useState<Details>({
    kind: "bill",
    folder: params.folder ?? "",
    accountKey: params.accountKey,
    partyId: params.partyId,
    voucherId: params.voucherId,
  });
  const [picker, setPicker] = useState<Picker | null>(null);
  const [locked, setLocked] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  const busy = attachments.busy || restoring;
  const editable = !busy && !locked;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRestoring(true);
    void Promise.all(
      attachments.files.map((file) => attachmentRetry(file)?.read()),
    ).then(
      (records) => {
        if (cancelled) return;
        const input = records.find((record) => record?.input)?.input;
        setLocked(!!input);
        if (input) {
          const { name: _name, ...saved } = input;
          setDetails(saved);
        }
        setRestoring(false);
      },
      (cause) => {
        if (!cancelled) {
          setLocked(true);
          setRestoring(false);
          setError(
            cause instanceof Error
              ? cause.message
              : "Couldn't restore the pending upload details.",
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attachments.files]);

  const save = async () => {
    if (busy || !attachments.files.length) return;
    setError("");
    try {
      const saved = await attachments.attachTo("library", {
        ...details,
        folder: details.folder ?? "",
        partyId: details.partyId || undefined,
        accountKey: details.accountKey || undefined,
        voucherId: details.voucherId || undefined,
        note: details.note?.trim() || undefined,
      });
      const last = saved?.at(-1);
      if (last && mounted.current) router.replace(`/documents/${last.id}`);
    } catch (cause) {
      if (mounted.current) showError("Couldn't upload remaining files", cause);
    }
  };

  const options = () => {
    if (picker === "kind")
      return kinds.map((id) => ({ id, title: documentKindLabel[id] }));
    if (picker === "folder")
      return [
        { id: "", title: "Unfiled" },
        ...(folders.data ?? []).map((id) => ({ id, title: id })),
      ];
    if (picker === "partyId")
      return [
        { id: "", title: "Not linked" },
        ...(parties.data ?? []).map(({ party }) => ({
          id: party.id,
          title: party.name,
        })),
      ];
    return [
      { id: "", title: "Not linked" },
      ...(accounts.data ?? []).map((account) => ({
        id: account.key,
        title: account.name,
        subtitle: account.group,
      })),
    ];
  };

  return (
    <Screen
      header={<Header close title="Add documents" />}
      footer={
        <FooterBar>
          <Button
            label="Upload documents"
            icon="upload"
            variant="primary"
            block
            loading={busy}
            disabled={!attachments.files.length}
            onPress={() => void save()}
          />
        </FooterBar>
      }
    >
      {error || attachments.error ? (
        <Notice tone="warn" text={error || attachments.error} />
      ) : null}
      {locked ? (
        <Notice tone="info" text="Pending upload details are locked." />
      ) : null}
      <AttachmentPicker {...attachments} busy={busy} />
      <View
        pointerEvents={editable ? "auto" : "none"}
        style={{ gap: space.md, opacity: editable ? 1 : 0.65 }}
      >
        <SelectField
          label="Document type"
          value={documentKindLabel[details.kind]}
          onPress={() => setPicker("kind")}
        />
        <TextField
          label="Folder"
          value={details.folder ?? ""}
          onChangeText={(folder) => setDetails({ ...details, folder })}
          placeholder="Purchases/2026/October"
          editable={editable}
        />
        <Button
          label="Existing folders"
          icon="folder"
          size="sm"
          disabled={!editable}
          onPress={() => setPicker("folder")}
        />
        {!details.voucherId ? (
          <>
            <SelectField
              label="Party"
              value={
                parties.data?.find(({ party }) => party.id === details.partyId)
                  ?.party.name ?? "Not linked"
              }
              onPress={() => setPicker("partyId")}
            />
            <SelectField
              label="Ledger / account"
              value={
                accounts.data?.find(
                  (account) => account.key === details.accountKey,
                )?.name ?? "Not linked"
              }
              onPress={() => setPicker("accountKey")}
            />
          </>
        ) : null}
        <TextField
          label="Note"
          value={details.note ?? ""}
          multiline
          editable={editable}
          onChangeText={(note) => setDetails({ ...details, note })}
        />
      </View>
      <PickerSheet
        visible={!!picker && editable}
        title={picker ? titles[picker] : ""}
        onClose={() => setPicker(null)}
        options={options()}
        onSelect={(value) => {
          if (picker && editable) setDetails({ ...details, [picker]: value });
          setPicker(null);
        }}
      />
    </Screen>
  );
}
