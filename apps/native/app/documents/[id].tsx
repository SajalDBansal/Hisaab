import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Linking, View } from "react-native";
import { formatDate } from "@repo/core";
import { DocumentFolder } from "@repo/contracts";
import {
  Button,
  EmptyState,
  Header,
  KeyValue,
  Notice,
  QueryView,
  Screen,
  TextField,
  showError,
} from "@/components";
import { confirmAction } from "@/data/confirm";
import { documentKindLabel, fileSize } from "@/data/labels";
import {
  useDocumentDownload,
  useDocuments,
  useRemoveDocument,
  useUpdateDocument,
} from "@/data/queries";
import { saveDocumentFile } from "@/data/documentFiles";
import { documentName } from "@/data/documentName";
import { space } from "@/theme";

export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const docs = useDocuments();
  const remove = useRemoveDocument();
  const download = useDocumentDownload();
  const update = useUpdateDocument();
  const doc = docs.data?.find((d) => d.id === id);
  const [url, setUrl] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  useEffect(() => {
    setFolder(doc?.folder ?? "");
    setUrl("");
    setPreviewError("");
  }, [doc?.id, doc?.folder]);
  const preview = async () => {
    try {
      setPreviewError("");
      const ticket = await download.mutateAsync(id);
      if (doc?.contentType?.startsWith("image/")) setUrl(ticket.downloadUrl);
      else await Linking.openURL(ticket.downloadUrl);
    } catch (error) {
      showError("Couldn't open document", error);
    }
  };
  const saveFile = async (share: boolean) => {
    if (!doc || busy) return;
    setBusy(true);
    try {
      const ticket = await download.mutateAsync(id);
      await saveDocumentFile(
        ticket.downloadUrl,
        documentName(doc.name, doc.contentType),
        share,
      );
    } catch (error) {
      showError("Couldn't download document", error);
    } finally {
      setBusy(false);
    }
  };
  const move = async () => {
    const path = DocumentFolder.safeParse(folder);
    if (!path.success) {
      showError(
        "Invalid folder",
        path.error.issues[0]?.message ?? "Check the folder path.",
      );
      return;
    }
    try {
      await update.mutateAsync({ id, folder: path.data });
    } catch (error) {
      showError("Couldn't move document", error);
    }
  };
  return (
    <Screen header={<Header title={doc?.name ?? "Document"} />}>
      <QueryView query={docs}>
        {() =>
          !doc ? (
            <EmptyState
              icon="folder"
              title="Document not found"
              message="It may have been deleted."
            />
          ) : (
            <>
              {url ? (
                <Image
                  source={{ uri: url }}
                  resizeMode="contain"
                  style={{ width: "100%", height: 360 }}
                  onError={() =>
                    setPreviewError(
                      "This image cannot be previewed on this device. Download it to open in another app.",
                    )
                  }
                />
              ) : null}
              {previewError ? <Notice tone="warn" text={previewError} /> : null}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                }}
              >
                <Button
                  label={url ? "Refresh preview" : "Open"}
                  icon="eye"
                  onPress={() => void preview()}
                  loading={download.isPending && !busy}
                />
                <Button
                  label="Download"
                  icon="download"
                  onPress={() => void saveFile(false)}
                  disabled={busy}
                />
                <Button
                  label="Share"
                  icon="share-2"
                  onPress={() => void saveFile(true)}
                  disabled={busy}
                />
              </View>
              <View>
                <KeyValue label="Type" value={documentKindLabel[doc.kind]} />
                <KeyValue label="Added on" value={formatDate(doc.uploadedOn)} />
                <KeyValue label="Size" value={fileSize(doc.sizeKb)} />
                {doc.entryDate ? (
                  <KeyValue
                    label="Entry date"
                    value={formatDate(doc.entryDate)}
                  />
                ) : null}
                {doc.partyName ? (
                  <KeyValue label="Party" value={doc.partyName} />
                ) : null}
                {doc.voucherNumber ? (
                  <KeyValue label="Entry" value={doc.voucherNumber} />
                ) : null}
                {doc.note ? <KeyValue label="Note" value={doc.note} /> : null}
              </View>
              <TextField
                label="Folder"
                value={folder}
                onChangeText={setFolder}
                placeholder="Unfiled"
              />
              <Button
                label="Move to folder"
                icon="folder"
                onPress={() => void move()}
                loading={update.isPending}
                disabled={folder === (doc.folder ?? "")}
              />
              {doc.voucherId ? (
                <Button
                  label="Open entry"
                  icon="file-text"
                  onPress={() => router.push(`/voucher/${doc.voucherId}`)}
                />
              ) : null}
              {doc.partyId ? (
                <Button
                  label="Open party"
                  icon="user"
                  onPress={() => router.push(`/party/${doc.partyId}`)}
                />
              ) : null}
              {doc.accountKey ? (
                <Button
                  label="Open ledger"
                  icon="book-open"
                  onPress={() =>
                    router.push(
                      `/account/${encodeURIComponent(doc.accountKey ?? "")}`,
                    )
                  }
                />
              ) : null}
              <Button
                label="Delete document"
                icon="trash-2"
                variant="danger"
                loading={remove.isPending}
                onPress={() =>
                  confirmAction(
                    "Delete document?",
                    "This removes the file for everyone in the firm. The accounting entry stays unchanged.",
                    "Delete",
                    async () => {
                      await remove.mutateAsync(id);
                      router.replace("/documents");
                    },
                  )
                }
              />
            </>
          )
        }
      </QueryView>
    </Screen>
  );
}
