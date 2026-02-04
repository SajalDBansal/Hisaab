import { router } from "expo-router";
import { View } from "react-native";
import { Button, ListRow, Notice, QueryView, Txt } from "@/components";
import { useDocuments } from "@/data/queries";
import { space } from "@/theme";
import { AttachmentPicker } from "./AttachmentPicker";
import { useEntryAttachments } from "./useEntryAttachments";
import { DocumentThumbnail } from "./DocumentThumbnail";

export function VoucherAttachments({
  voucherId,
  accountKey,
}: {
  voucherId?: string;
  accountKey?: string;
}) {
  const docs = useDocuments(
    accountKey ? { accountKeys: [accountKey] } : { voucherId },
  );
  const attachments = useEntryAttachments(
    accountKey ?? voucherId,
    accountKey ? "account" : "voucher",
  );
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="heading">Documents</Txt>
      <QueryView query={docs}>
        {(list) => (
          <>
            {list.map((doc) => (
              <ListRow
                key={doc.id}
                left={<DocumentThumbnail document={doc} />}
                title={doc.name}
                subtitle={doc.folder || undefined}
                chevron
                onPress={() => router.push(`/documents/${doc.id}`)}
              />
            ))}
          </>
        )}
      </QueryView>
      {attachments.files.length ? (
        <Notice
          tone="info"
          text="Entry saved. These attachments have not been uploaded yet."
        />
      ) : null}
      {attachments.error ? (
        <Notice tone="warn" text={attachments.error} />
      ) : null}
      <AttachmentPicker {...attachments} />
      {attachments.files.length ? (
        <Button
          label="Upload attachments"
          icon="upload"
          loading={attachments.busy}
          onPress={() =>
            void attachments.attachTo(accountKey ?? voucherId ?? "")
          }
        />
      ) : null}
    </View>
  );
}
