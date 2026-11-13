import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  Button,
  Checkbox,
  EmptyState,
  Header,
  ListRow,
  PagedView,
  Screen,
  TextField,
} from "@/components";
import { AssociateGate } from "@/components/associates/AssociateGate";
import { useAssociatePages } from "@/data/associateHooks";
import { space } from "@/theme";

export default function Associates() {
  const query = useAssociatePages();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  return (
    <Screen
      header={<Header title="Business associates" />}
      onRefresh={() => void query.query.refetch()}
      refreshing={query.query.isRefetching && !query.query.isFetchingNextPage}
      onEndReached={query.loadMore}
    >
      <AssociateGate>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          <Button
            label="New associate"
            icon="plus"
            variant="primary"
            onPress={() => router.push("/associates/new")}
          />
          <Button
            label="Profile fields"
            icon="settings"
            onPress={() => router.push("/associates/fields")}
          />
        </View>
        <TextField
          label="Search associates"
          value={search}
          onChangeText={setSearch}
        />
        <Checkbox
          label="Include archived"
          checked={archived}
          onChange={setArchived}
        />
        <PagedView list={query} noun="associates">
          {({ items: rows }) => {
            const visible = rows.filter(
              (r) =>
                (archived || r.active) &&
                `${r.name} ${r.phone} ${r.roles.join(" ")}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
            );
            return visible.length ? (
              <View>
                {visible.map((row) => (
                  <ListRow
                    key={row.id}
                    title={row.name}
                    subtitle={`${row.roles.join(", ")} | ${row.phone}${row.active ? "" : " | Archived"}`}
                    onPress={() => router.push(`/associates/${row.id}`)}
                    chevron
                  />
                ))}
              </View>
            ) : (
              <EmptyState title="No associates found" />
            );
          }}
        </PagedView>
      </AssociateGate>
    </Screen>
  );
}
