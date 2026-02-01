import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space, touch } from "@/theme";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import { ListRow } from "./ListRow";
import { EmptyState } from "./States";
import { Txt } from "./Txt";

export interface PickerOption {
  id: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

/**
 * Bottom sheet with a search box and a list to pick one option.
 * Used for PartyPicker, ItemPicker and LedgerPicker.
 */
export function PickerSheet({
  visible,
  title,
  options,
  onSelect,
  onClose,
  searchPlaceholder = "Search",
  addLabel,
  onAdd,
  selectedIds,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  onSelect: (id: string) => void;
  onClose: () => void;
  searchPlaceholder?: string;
  /** Shows an "Add new …" row at the top, e.g. "Add new customer". */
  addLabel?: string;
  onAdd?: () => void;
  selectedIds?: string[];
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      `${o.title} ${o.subtitle ?? ""}`.toLowerCase().includes(q),
    );
  }, [options, query]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, space.lg) },
        ]}
      >
        <View style={styles.handle} />
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Txt variant="heading" style={{ flex: 1, fontSize: 20 }}>
            {title}
          </Txt>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <View style={styles.search}>
          <Icon name="search" size={18} color={colors.body} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.mute}
            accessibilityLabel={searchPlaceholder}
            style={{ flex: 1, fontSize: 15, color: colors.ink, minHeight: 40 }}
          />
        </View>
        {onAdd ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setQuery("");
              onAdd();
            }}
            style={({ pressed }) => [styles.add, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.addIcon}>
              <Icon name="plus" size={18} color={colors.onPrimary} />
            </View>
            <Txt variant="bodyStrong" style={{ flex: 1 }}>
              {addLabel ?? "Add new"}
              {query.trim() ? ` "${query.trim()}"` : ""}
            </Txt>
          </Pressable>
        ) : null}
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.id}
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: 420 }}
          ListEmptyComponent={
            <EmptyState
              icon="search"
              title="No matches"
              message="Try a shorter search."
            />
          }
          renderItem={({ item, index }) => (
            <ListRow
              title={item.title}
              subtitle={item.subtitle}
              right={
                selectedIds ? (
                  <Icon
                    name={
                      selectedIds.includes(item.id) ? "check-square" : "square"
                    }
                    size={22}
                  />
                ) : (
                  item.right
                )
              }
              last={index === filtered.length - 1}
              onPress={() => {
                if (!selectedIds) setQuery("");
                onSelect(item.id);
              }}
            />
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.md,
  },
  add: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: touch,
  },
  addIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.hairlineStrong,
  },
  search: {
    minHeight: touch,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
});
