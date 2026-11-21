/**
 * Toast: a short message at the bottom of the screen that works the same on
 * phones and on the web (React Native's Alert shows nothing on the web).
 *   showToast("Saved", "ok")
 *   showError("Couldn't save", error)   → "Couldn't save: <error message>"
 * <ToastHost /> is placed once in the root layout.
 */
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space } from "@/theme";
import { Icon } from "./Icon";
import { Txt } from "./Txt";
import { PendingOperationError } from "@/data/offlineOperation";

type Tone = "error" | "ok" | "info";
interface ToastMessage {
  id: number;
  text: string;
  tone: Tone;
}

const listeners = new Set<(m: ToastMessage) => void>();
let nextId = 1;

export function showToast(text: string, tone: Tone = "info") {
  const m = { id: nextId++, text, tone };
  listeners.forEach((l) => l(m));
}

/** Show what went wrong. `e` is usually the caught error. */
export function showError(title: string, e?: unknown) {
  const detail =
    e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (e instanceof PendingOperationError) return showToast(detail, "info");
  showToast(detail ? `${title}: ${detail}` : title, "error");
}

const SHOW_FOR_MS = 4500;

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const add = (m: ToastMessage) => {
      setList((l) => [...l.slice(-2), m]); // at most 3 on screen
      setTimeout(
        () => setList((l) => l.filter((x) => x.id !== m.id)),
        SHOW_FOR_MS,
      );
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  if (list.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { bottom: Math.max(insets.bottom, space.lg) + 72 }]}
    >
      {list.map((m) => (
        <Pressable
          key={m.id}
          accessibilityRole="alert"
          accessibilityLabel={m.text}
          onPress={() => setList((l) => l.filter((x) => x.id !== m.id))}
          style={[styles.toast, m.tone === "error" && styles.error]}
        >
          <Icon
            name={
              m.tone === "error"
                ? "alert-circle"
                : m.tone === "ok"
                  ? "check-circle"
                  : "info"
            }
            size={18}
            color={colors.onDark}
          />
          <Txt variant="small" tone="onDark" style={{ flex: 1 }}>
            {m.text}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: space.lg,
    right: space.lg,
    gap: space.sm,
    alignItems: "center",
  },
  toast: {
    width: "100%",
    maxWidth: 480,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceDark,
  },
  error: { backgroundColor: colors.give },
});
