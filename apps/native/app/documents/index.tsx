import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatDate, type DocumentFilters as Filters } from "@repo/core";
import {
  Avatar,
  Button,
  EmptyState,
  Header,
  ListRow,
  QueryView,
  Screen,
  Segmented,
  TextField,
  Txt,
} from "@/components";
import { fileSize } from "@/data/labels";
import { DocumentThumbnail } from "@/documents/DocumentThumbnail";
import { useDocumentFolders, useDocuments } from "@/data/queries";
import { DocumentFilters } from "@/documents/DocumentFilters";
import { space } from "@/theme";

export default function DocumentsScreen() {
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<"all" | "folders">("all");
  const [folder, setFolder] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const folders = useDocumentFolders();
  const docs = useDocuments({
    ...filters,
    folder: view === "folders" ? folder : undefined,
  });
  const prefix = folder ? folder + "/" : "";
  const children = [
    ...new Set(
      (folders.data ?? [])
        .filter((p) => p.startsWith(prefix) && p !== folder)
        .map((p) => prefix + p.slice(prefix.length).split("/")[0]),
    ),
  ].sort();
  const add = (path = "") =>
    router.push({ pathname: "/documents/new", params: { folder: path } });
  return (
    <Screen
      header={
        <Header
          title="Documents"
          right={
            <Button
              label="Add"
              icon="plus"
              size="sm"
              onPress={() => add(view === "folders" ? folder : "")}
            />
          }
        />
      }
      onRefresh={() => {
        void docs.refetch();
        void folders.refetch();
      }}
      refreshing={docs.isRefetching}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
      >
        <View style={{ flex: 1 }}>
          <TextField
            label="Search documents"
            value={filters.search ?? ""}
            onChangeText={(search) => setFilters((old) => ({ ...old, search }))}
          />
        </View>
        <Button
          label="Filters"
          icon="filter"
          size="sm"
          onPress={() => setShowFilters(!showFilters)}
        />
      </View>
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "all", label: "All documents" },
          { value: "folders", label: "Folders" },
        ]}
      />
      {showFilters ? (
        <DocumentFilters value={filters} onChange={setFilters} />
      ) : null}
      {view === "folders" ? (
        <View style={{ gap: space.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            {folder ? (
              <Button
                label="Up"
                icon="arrow-up"
                size="sm"
                onPress={() =>
                  setFolder(folder.split("/").slice(0, -1).join("/"))
                }
              />
            ) : null}
            <Txt variant="bodyStrong" style={{ flex: 1 }}>
              {folder || "Documents"}
            </Txt>
          </View>
          <QueryView query={folders}>
            {() => (
              <>
                {children.map((path) => (
                  <ListRow
                    key={path}
                    title={path.split("/").slice(-1)[0] ?? path}
                    left={<Avatar icon="folder" />}
                    chevron
                    onPress={() => setFolder(path)}
                  />
                ))}
              </>
            )}
          </QueryView>
          <TextField
            label="New folder"
            value={newFolder}
            onChangeText={setNewFolder}
            placeholder="Folder name"
          />
          <Button
            label="Add files to folder"
            icon="folder-plus"
            size="sm"
            disabled={!newFolder.trim()}
            onPress={() => add(prefix + newFolder.trim())}
          />
        </View>
      ) : null}
      <QueryView query={docs}>
        {(list) =>
          list.length ? (
            <View>
              {list.map((d) => (
                <ListRow
                  key={d.id}
                  left={<DocumentThumbnail document={d} />}
                  title={d.name}
                  subtitle={[
                    d.partyName,
                    d.voucherNumber,
                    d.folder,
                    formatDate(
                      filters.dateBy === "entry"
                        ? (d.entryDate ?? d.uploadedOn)
                        : d.uploadedOn,
                    ),
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                  right={<Txt variant="caption">{fileSize(d.sizeKb)}</Txt>}
                  onPress={() => router.push(`/documents/${d.id}`)}
                />
              ))}
              <Txt
                variant="caption"
                tone="body"
                style={{ marginTop: space.sm }}
              >
                {list.length} documents
              </Txt>
            </View>
          ) : (
            <EmptyState
              icon="folder"
              title="No documents found"
              message="No files match this folder and selection."
            />
          )
        }
      </QueryView>
    </Screen>
  );
}
