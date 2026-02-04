import { useState } from "react";
import { Image } from "react-native";
import type { StoredDocument } from "@repo/core";
import { Avatar } from "@/components";
import { documentIcon } from "@/data/labels";
import { useDocumentThumbnail } from "@/data/queries";

// List rows request only the stored preview, never the full-size document.
export function DocumentThumbnail({ document }: { document: StoredDocument }) {
  const preview = useDocumentThumbnail(document.id, !!document.hasThumbnail);
  const [failedUrl, setFailedUrl] = useState("");
  const uri = preview.data?.downloadUrl;
  if (!uri || uri === failedUrl)
    return <Avatar icon={documentIcon(document.name)} />;
  return (
    <Image
      source={{ uri }}
      style={{ width: 44, height: 44, borderRadius: 4 }}
      resizeMode="contain"
      accessibilityLabel={`${document.name} preview`}
      onError={() => setFailedUrl(uri)}
    />
  );
}
