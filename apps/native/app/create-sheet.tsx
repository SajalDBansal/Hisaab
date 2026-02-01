import { router, type Href } from "expo-router";
import { backOrReplace } from "@/navigation";
import { FirmDetail } from "@repo/contracts";
import { PERMISSIONS } from "@repo/core";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, IconButton, QueryView, Txt } from "@/components";
import { REQUIRE_LOGIN } from "@/auth/config";
import { createSections, type CreateAction } from "@/data/createActions";
import { useFirm } from "@/data/queries";

import { colors, radius, space } from "@/theme";

/** Bottom sheet opened by the "+" tab. */
export default function CreateSheet() {
  const insets = useSafeAreaInsets();
  const firm = useFirm();
  const open = (href: Href) => {
    router.replace(href);
  };

  return (
    <View style={{ flex: 1 }}>
      <Pressable
        style={[styles.overlay, { minHeight: insets.top + space.sm }]}
        onPress={() => backOrReplace(router)}
        accessibilityLabel="Close"
      />
      <View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, space.xl) },
        ]}
        accessibilityViewIsModal
      >
        <View style={styles.handle} />
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Txt variant="heading" style={{ flex: 1, fontSize: 20 }}>
            {"Create"}
          </Txt>
          <IconButton
            icon="x"
            label={"Close"}
            onPress={() => backOrReplace(router)}
          />
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.sections}
        >
          <QueryView query={firm}>
            {(data) => {
              // Missing real-firm permissions never enable creation shortcuts.
              const permissions = REQUIRE_LOGIN
                ? (FirmDetail.safeParse(data).data?.permissions ?? [])
                : PERMISSIONS.map((p) => p.key);
              const sections = createSections(permissions);
              return sections.length ? (
                sections.map((section) => (
                  <View key={section.title} style={styles.section}>
                    <Txt variant="label" tone="body">
                      {section.title}
                    </Txt>
                    <Grid actions={section.actions} onOpen={open} />
                  </View>
                ))
              ) : (
                <Txt tone="body">{"No creation access for this firm."}</Txt>
              );
            }}
          </QueryView>
        </ScrollView>
      </View>
    </View>
  );
}

function Grid({
  actions,
  onOpen,
}: {
  actions: CreateAction[];
  onOpen: (href: Href) => void;
}) {
  return (
    <View style={styles.grid}>
      {actions.map((a) => (
        <Pressable
          key={a.label}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          onPress={() => onOpen(a.href)}
          style={styles.tile}
        >
          <View style={[styles.circle, a.primary && styles.circlePrimary]}>
            <Icon
              name={a.icon}
              size={22}
              color={a.primary ? colors.onPrimary : colors.ink}
            />
          </View>
          <Txt
            variant="caption"
            center
            style={{ fontWeight: "500" }}
            numberOfLines={2}
          >
            {a.label}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    maxHeight: "90%",
    flexShrink: 1,
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.md,
  },
  scroll: { flexShrink: 1, flexGrow: 0 },
  sections: { gap: space.md },
  section: { gap: space.md },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.hairlineStrong,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: space.sm },
  tile: {
    width: "25%",
    minHeight: 84,
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: 2,
  },
  circle: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  circlePrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});
