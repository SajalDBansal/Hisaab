import { useState } from "react";
import { router } from "expo-router";
import { Image, View } from "react-native";
import type { DocumentFile } from "@repo/core";
import {
  Button,
  Checkbox,
  IconButton,
  Notice,
  Txt,
  showError,
} from "@/components";
import { space } from "@/theme";
import { attachmentRetry } from "@/data/attachmentRecovery";
import { confirmAction } from "@/data/confirm";
import { pickFiles, type FileSource } from "./pickFiles";

export function AttachmentPicker({
  files,
  setFiles,
  busy = false,
  recovery,
}: {
  files: DocumentFile[];
  setFiles: (files: DocumentFile[]) => void | Promise<void>;
  busy?: boolean;
  recovery?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [picking, setPicking] = useState(false);
  const pick = async (source: FileSource) => {
    setPicking(true);
    try {
      const selected = await pickFiles(source);
      if (selected.length + files.length > 10)
        throw new Error("Attach up to 10 files at a time.");
      await setFiles([...files, ...selected]);
    } catch (error) {
      showError("Couldn't select file", error);
    } finally {
      setPicking(false);
    }
  };
  const remove = async (index: number) => {
    setPicking(true);
    try {
      await setFiles(files.filter((_, i) => i !== index));
    } catch (error) {
      showError("Couldn't remove attachment", error);
    } finally {
      setPicking(false);
    }
  };
  const confirmRemove = (index: number) => {
    const file = files[index];
    if (!file) return;
    if (!attachmentRetry(file)) {
      void remove(index);
      return;
    }
    confirmAction(
      "Discard pending copy?",
      `${file.name}\n\nThis removes the app's pending copy from this device. Original files and saved server documents are kept.`,
      "Discard copy",
      () => void remove(index),
    );
  };
  return (
    <View style={{ gap: space.sm }}>
      {recovery ? (
        <>
          <Notice tone="warn" text={recovery} />
          <Button
            label="Pending uploads"
            icon="upload-cloud"
            onPress={() => router.push("/settings/pending-uploads")}
          />
        </>
      ) : null}
      <Checkbox
        label="Attach photos or documents"
        checked={expanded || files.length > 0}
        onChange={setExpanded}
      />
      {expanded || files.length ? (
        <>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
          >
            <Button
              label="Camera"
              icon="camera"
              size="sm"
              disabled={busy || picking}
              onPress={() => void pick("camera")}
            />
            <Button
              label="Gallery"
              icon="image"
              size="sm"
              disabled={busy || picking}
              onPress={() => void pick("gallery")}
            />
            <Button
              label="Files"
              icon="paperclip"
              size="sm"
              disabled={busy || picking}
              onPress={() => void pick("file")}
            />
          </View>
          {files.map((file, index) => (
            <View
              key={`${file.uri}-${index}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
              }}
            >
              {file.uri && file.contentType.startsWith("image/") ? (
                <Image
                  source={{ uri: file.uri }}
                  style={{ width: 48, height: 48, borderRadius: 4 }}
                  resizeMode="cover"
                />
              ) : null}
              <Txt variant="small" style={{ flex: 1 }} numberOfLines={2}>
                {file.name}
                {attachmentRetry(file)?.fileError
                  ? " (local copy missing)"
                  : ""}
              </Txt>
              <IconButton
                icon="x"
                label={`Remove ${file.name}`}
                onPress={
                  busy || picking ? undefined : () => confirmRemove(index)
                }
              />
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}
