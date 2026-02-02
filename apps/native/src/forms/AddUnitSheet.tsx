/**
 * Bottom sheet to add a unit of measure.
 * Used from the item form and from Settings → Units.
 *
 * Three ways to get a unit, quickest first:
 *   1. Tap a ready-made unit that is switched off (Bag, Gm …) — it is switched on, nothing to type.
 *   2. Pick a GST code — the name is filled in from it (ROL → "Roll").
 *   3. Type your own name (Tray) — the GST code is guessed from it.
 *
 * The form scrolls inside the sheet, so fields keep their full height on small phones.
 */
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { checkUnit, UQC_CODES, type UnitDef } from "@repo/core";
import {
  Button,
  Chip,
  Icon,
  IconButton,
  ListRow,
  SelectField,
  TextField,
  Txt,
} from "@/components";
import { useAddUnit, useSetUnitEnabled, useUnits } from "@/data/queries";
import { colors, radius, space, touch } from "@/theme";

const codeInfo = (code: string) => UQC_CODES.find((c) => c.code === code);
const codeLabel = (code: string) => `${code} · ${codeInfo(code)?.label ?? ""}`;

/** "Rolls" → "roll", "Boxes" → "box", for comparing names with GST labels. */
const singular = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/(xes|ches|shes)$/, (m) => m.slice(0, -2))
    .replace(/s$/, "");

/** Guess the GST code from the name: "Roll" → ROL, "Bottles" → BTL. Falls back to OTH. */
function guessCode(name: string): string {
  const n = singular(name);
  if (!n) return "OTH";
  const hit = UQC_CODES.find(
    (c) => singular(c.label) === n || c.code.toLowerCase() === n,
  );
  return hit?.code ?? "OTH";
}

/** Name to fill in when a GST code is picked first: ROL "Rolls" → "Roll". */
function nameFromCode(code: string): string {
  const label = codeInfo(code)?.label ?? "";
  if (code === "OTH" || !label) return "";
  const one = singular(label);
  return one[0].toUpperCase() + one.slice(1);
}

export function AddUnitSheet({
  visible,
  onClose,
  onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  /** Called with the new or switched-on unit, e.g. to select it in the item form. */
  onAdded?: (unit: UnitDef) => void;
}) {
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const add = useAddUnit();
  const switchOn = useSetUnitEnabled();
  const [step, setStep] = useState<"form" | "codes">("form");
  const [name, setName] = useState("");
  // null = not chosen by hand, so keep guessing it from the name
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const all = units.data ?? [];
  const ready = all.filter((u) => !u.enabled);
  const uqc = pickedCode ?? guessCode(name);
  const problem = checkUnit({ name, uqc }, all);
  const message = showErrors ? (problem ?? add.error?.message) : undefined;
  // A unit with this GST code is already in the list (e.g. KGS → Kg)
  const sameCode = uqc !== "OTH" ? all.find((u) => u.uqc === uqc) : undefined;

  const codes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? UQC_CODES.filter((c) =>
          `${c.code} ${c.label}`.toLowerCase().includes(q),
        )
      : UQC_CODES;
  }, [search]);

  const close = () => {
    setStep("form");
    setName("");
    setPickedCode(null);
    setSearch("");
    setShowErrors(false);
    add.reset();
    onClose();
  };

  /** Use a unit already in the list; switch it on first if needed. */
  const pickExisting = async (unit: UnitDef) => {
    try {
      const saved = unit.enabled
        ? unit
        : await switchOn.mutateAsync({ name: unit.name, enabled: true });
      onAdded?.(saved);
      close();
    } catch {
      // Shown by the mutation state; nothing else to do
    }
  };

  const save = async () => {
    setShowErrors(true);
    if (problem) return;
    try {
      const unit = await add.mutateAsync({ name, uqc });
      onAdded?.(unit);
      close();
    } catch {
      // add.error is shown under the name
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={step === "codes" ? () => setStep("form") : close}
    >
      <Pressable
        style={styles.overlay}
        onPress={close}
        accessibilityLabel="Close"
      />
      <View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, space.lg) },
        ]}
      >
        <View style={styles.handle} />

        {step === "form" ? (
          <>
            <View style={styles.titleRow}>
              <Txt variant="heading" style={styles.title}>
                Add a unit
              </Txt>
              <IconButton icon="x" label="Close" onPress={close} />
            </View>

            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ gap: space.lg, paddingBottom: space.xs }}
              keyboardShouldPersistTaps="handled"
            >
              {ready.length > 0 ? (
                <View style={{ gap: space.sm }}>
                  <View>
                    <Txt variant="label" tone="charcoal">
                      Ready to use
                    </Txt>
                    <Txt variant="caption" tone="body">
                      Tap one to switch it on — no typing needed
                    </Txt>
                  </View>
                  <View style={styles.wrap}>
                    {ready.map((u) => (
                      <Chip
                        key={u.name}
                        label={u.name}
                        onPress={() => pickExisting(u)}
                      />
                    ))}
                  </View>
                  <View style={styles.dividerRow}>
                    <View style={styles.divider} />
                    <Txt variant="caption" tone="body">
                      or make your own
                    </Txt>
                    <View style={styles.divider} />
                  </View>
                </View>
              ) : null}

              <View style={styles.row}>
                <TextField
                  label="Unit name"
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Tray, Roll, Sheet"
                  error={message}
                />
              </View>

              <View style={{ gap: space.xs }}>
                <View style={styles.row}>
                  <SelectField
                    label="GST unit code (for GSTR-1)"
                    value={codeLabel(uqc)}
                    onPress={() => setStep("codes")}
                  />
                </View>
                <Txt variant="caption" tone="body">
                  {pickedCode
                    ? "Chosen by you."
                    : "Picked from the name. Not sure? OTH (Others) is fine."}
                </Txt>
              </View>

              {sameCode ? (
                <View style={styles.hint}>
                  <Txt variant="small" style={{ flex: 1 }}>
                    You already have{" "}
                    <Txt variant="small" style={{ fontWeight: "600" }}>
                      {sameCode.name}
                    </Txt>{" "}
                    for {uqc}
                    {sameCode.enabled ? "." : " (switched off)."}
                  </Txt>
                  <Button
                    label={sameCode.enabled ? "Use it" : "Switch on"}
                    size="sm"
                    onPress={() => pickExisting(sameCode)}
                    loading={switchOn.isPending}
                  />
                </View>
              ) : null}
            </ScrollView>

            <Button
              label="Add unit"
              variant="primary"
              onPress={save}
              loading={add.isPending}
              block
            />
          </>
        ) : (
          <>
            <View style={styles.titleRow}>
              <IconButton
                icon="chevron-left"
                label="Back"
                onPress={() => setStep("form")}
              />
              <Txt variant="heading" style={styles.title}>
                GST unit code
              </Txt>
              <IconButton icon="x" label="Close" onPress={close} />
            </View>
            <View style={styles.search}>
              <Icon name="search" size={18} color={colors.body} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search code or name"
                placeholderTextColor={colors.mute}
                accessibilityLabel="Search GST unit codes"
                style={{
                  flex: 1,
                  fontSize: 15,
                  color: colors.ink,
                  minHeight: 40,
                }}
              />
            </View>
            <FlatList
              data={codes}
              keyExtractor={(c) => c.code}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 420 }}
              renderItem={({ item, index }) => (
                <ListRow
                  title={item.code}
                  subtitle={item.label}
                  right={
                    item.code === uqc ? (
                      <Icon name="check" size={18} />
                    ) : undefined
                  }
                  onPress={() => {
                    setPickedCode(item.code);
                    // Picking the code first fills the name, so nothing else is needed
                    if (!name.trim()) setName(nameFromCode(item.code));
                    setSearch("");
                    setStep("form");
                  }}
                  last={index === codes.length - 1}
                />
              )}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    maxHeight: "90%",
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.md,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.hairlineStrong,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  title: { flex: 1, fontSize: 20 },
  // Fields use flex: 1, so each sits in a row to keep its natural height
  row: { flexDirection: "row" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.xs,
  },
  divider: { flex: 1, height: 1, backgroundColor: colors.hairline },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: 12,
    borderRadius: radius.card,
    backgroundColor: colors.surfaceSoft,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: touch,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
  },
});
