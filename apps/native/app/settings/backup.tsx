import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useServiceQuery } from "@/data/scopedHooks";
import {
  BackupInspection,
  type BackupRestorePreview,
  type BackupRestoreResult,
} from "@repo/contracts";
import {
  Button,
  Checkbox,
  Header,
  KeyValue,
  Notice,
  QueryView,
  Screen,
  Txt,
  TextField,
  showError,
} from "@/components";
import { useData } from "@/data/DataProvider";
import { formatDateTime } from "@/data/format";
import { pickBackupFile, saveBackupFile } from "@/data/backupFile";
import {
  useBackupStatus,
  useCreateBackup,
  useSwitchFirm,
} from "@/data/queries";
import { space } from "@/theme";

export default function BackupScreen() {
  const { services, userId, firmId } = useData();
  // Changing firms discards a previously inspected file from the visible screen.
  return (
    <FirmBackup
      key={`${userId}:${firmId}`}
      services={services}
      demo={userId === "demo"}
    />
  );
}

function FirmBackup({
  services,
  demo,
}: {
  services: ReturnType<typeof useData>["services"];
  demo: boolean;
}) {
  const status = useBackupStatus();
  const create = useCreateBackup();
  const switchFirm = useSwitchFirm();
  const { role } = useData();
  const recovery = useServiceQuery({
    queryKey: ["backup-recovery"],
    queryFn: (current) => current.backupService.recovery(),
    enabled: !demo && role === "owner",
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [preview, setPreview] = useState<BackupInspection | null>(null);
  const [fileText, setFileText] = useState("");
  const [name, setName] = useState("");
  const [restorePreview, setRestorePreview] =
    useState<BackupRestorePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [missingAccepted, setMissingAccepted] = useState(false);
  const [restored, setRestored] = useState<BackupRestoreResult | null>(null);
  const fail = (title: string, error: unknown) => {
    setProblem(
      `${title}: ${error instanceof Error ? error.message : "Please try again."}`,
    );
    showError(title, error);
  };

  async function exportBooks() {
    setProblem(null);
    setExported(false);
    setBusy(true);
    try {
      const file = await create.mutateAsync();
      await saveBackupFile(file.fileName, file.text);
      // A dismissed share sheet cannot prove that the file was actually saved.
      setExported(true);
    } catch (error) {
      fail("Couldn't export books", error);
    } finally {
      setBusy(false);
    }
  }

  async function inspectFile() {
    setProblem(null);
    setPreview(null);
    setRestorePreview(null);
    setFileText("");
    setRestored(null);
    setConfirmed(false);
    setMissingAccepted(false);
    setBusy(true);
    try {
      const text = await pickBackupFile();
      if (text) {
        const inspected = BackupInspection.parse(
          await services.backupService.inspect(text),
        );
        setPreview(inspected);
        setFileText(text);
        setName(`${inspected.firmName.slice(0, 180)} recovered`);
      }
    } catch (error) {
      fail("Couldn't inspect the file", error);
    } finally {
      setBusy(false);
    }
  }

  async function prepareRestore() {
    setProblem(null);
    setBusy(true);
    setRestorePreview(null);
    setConfirmed(false);
    setMissingAccepted(false);
    try {
      setRestorePreview(
        await services.backupService.previewRestore({ text: fileText, name }),
      );
    } catch (error) {
      fail("Couldn't prepare recovery", error);
    } finally {
      setBusy(false);
    }
  }

  async function restoreNewFirm() {
    if (!restorePreview || !confirmed || !missingAccepted) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await services.backupService.restoreNewFirm({
        text: fileText,
        previewId: restorePreview.previewId,
        confirmNewFirm: true,
        acknowledgeMissingAttachments: true,
      });
      setRestored(result);
      setRestorePreview(null);
      setFileText("");
    } catch (error) {
      fail("Couldn't recover the books", error);
    } finally {
      setBusy(false);
    }
  }

  async function openRecoveredFirm() {
    if (!restored) return;
    try {
      await switchFirm.mutateAsync(restored.firmId);
      router.replace("/settings/backup");
    } catch (error) {
      fail("Couldn't open the recovered firm", error);
    }
  }

  return (
    <Screen header={<Header title="Books export and recovery" />}>
      {demo ? (
        <Notice
          tone="warn"
          text="Sign in as a firm owner to export saved books."
        />
      ) : (
        <QueryView query={status}>
          {(view) => (
            <>
              <View style={{ gap: space.sm }}>
                <Txt variant="heading">{view.firmName}</Txt>
                <KeyValue label="Parties" value={String(view.counts.parties)} />
                <KeyValue label="Items" value={String(view.counts.items)} />
                <KeyValue
                  label="Entries"
                  value={String(view.counts.vouchers)}
                />
                <KeyValue
                  label="Document records"
                  value={String(view.counts.documents)}
                />
              </View>
              <Notice
                tone="warn"
                text="Books and attachment metadata only. Photos, documents and thumbnails are not included. This is not a complete disaster-recovery backup."
              />
              <View style={{ gap: space.sm }}>
                <Button
                  label="Export books (JSON)"
                  icon="download"
                  variant="primary"
                  disabled={busy}
                  onPress={() => void exportBooks()}
                />
                <Button
                  label="Inspect an export file"
                  icon="file-text"
                  disabled={busy}
                  onPress={() => void inspectFile()}
                />
              </View>
              <KeyValue label="Restore destination" value="New firm only" />
              <KeyValue
                label="Automatic offsite backup"
                value="Not configured"
              />
              <Txt variant="small" tone="body">
                Existing books and audit history are never replaced by this
                screen.
              </Txt>
            </>
          )}
        </QueryView>
      )}
      {exported ? (
        <Notice
          tone="info"
          text="Export prepared. Check that the file was saved at your chosen destination. Offsite recovery has not been verified."
        />
      ) : null}
      {problem ? <Notice tone="warn" text={problem} /> : null}
      {recovery.error ? (
        <Notice tone="warn" text="Recovery status could not be loaded." />
      ) : null}
      {recovery.data?.restoredAt ? (
        <Notice
          tone="warn"
          text={`Recovered ${formatDateTime(recovery.data.restoredAt)}. ${recovery.data.missingAttachments} attachment records have no recovered binary. Missing files are not shown in Documents and cannot be downloaded.`}
        />
      ) : null}
      {preview ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="heading">File inspection</Txt>
          <KeyValue label="Firm" value={preview.firmName} />
          <KeyValue label="Exported" value={formatDateTime(preview.savedAt)} />
          <KeyValue label="Format version" value={String(preview.version)} />
          <KeyValue label="Entries" value={String(preview.counts.vouchers)} />
          <KeyValue
            label="Document records"
            value={String(preview.counts.documents)}
          />
          <KeyValue label="File checksum" value="Matched" />
          <KeyValue label="Attachment binaries" value="Not included" />
          {preview.warnings.map((warning) => (
            <Txt key={warning} variant="small" tone="body">
              {warning}
            </Txt>
          ))}
          {!restored ? (
            <>
              <TextField
                label="New firm name"
                value={name}
                maxLength={200}
                editable={!busy}
                onChangeText={(value) => {
                  setName(value);
                  setRestorePreview(null);
                  setConfirmed(false);
                  setMissingAccepted(false);
                }}
              />
              <Button
                label="Preview recovery"
                icon="file-text"
                disabled={busy || !name.trim()}
                onPress={() => void prepareRestore()}
              />
            </>
          ) : null}
        </View>
      ) : null}
      {restorePreview ? (
        <View style={{ gap: space.sm }}>
          <Txt variant="heading">Confirm new firm</Txt>
          <KeyValue label="Destination" value={restorePreview.newFirmName} />
          <KeyValue
            label="Preview expires"
            value={formatDateTime(restorePreview.expiresAt)}
          />
          <KeyValue
            label="Missing attachment files"
            value={String(restorePreview.missingAttachments)}
          />
          <KeyValue
            label="Automatic reminders"
            value="Disabled in recovered firm"
          />
          <Checkbox
            label="Create a new firm. Leave my existing books and history unchanged."
            checked={confirmed}
            onChange={(value) => {
              if (!busy) setConfirmed(value);
            }}
          />
          <Checkbox
            label="I understand that photos, documents and thumbnails will not be recovered."
            checked={missingAccepted}
            onChange={(value) => {
              if (!busy) setMissingAccepted(value);
            }}
          />
          <Button
            label="Create recovered firm"
            icon="plus"
            variant="primary"
            disabled={busy || !confirmed || !missingAccepted}
            onPress={() => void restoreNewFirm()}
          />
        </View>
      ) : null}
      {restored ? (
        <View style={{ gap: space.sm }}>
          <Notice
            tone="info"
            text={`${restored.firmName} was created. The original firm is unchanged. Reminders are disabled in the recovered firm.`}
          />
          <KeyValue
            label="Missing attachment files"
            value={String(restored.missingAttachments)}
          />
          <Button
            label="Open recovered firm"
            icon="arrow-right"
            disabled={switchFirm.isPending}
            onPress={() => void openRecoveredFirm()}
          />
        </View>
      ) : null}
    </Screen>
  );
}
