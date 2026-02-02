/**
 * Bottom sheet that asks why a voucher is being cancelled, then cancels it.
 * The voucher keeps its number (no gaps in the series) but stops counting everywhere.
 */
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Chip, IconButton, Notice, TextField, Txt } from "@/components";
import { useCancelVoucher } from "@/data/queries";
import { colors, radius, space } from "@/theme";

const REASONS = [
  "Wrong entry",
  "Entered twice",
  "Order cancelled",
  "Wrong party",
  "Other",
];

export function CancelSheet({
  visible,
  voucherId,
  number,
  version,
  onClose,
}: {
  visible: boolean;
  voucherId: string;
  number: string;
  version?: number;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const cancel = useCancelVoucher();
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const text = reason === "Other" ? other.trim() : reason;

  const close = () => {
    setReason("");
    setOther("");
    cancel.reset();
    onClose();
  };

  const confirm = async () => {
    try {
      await cancel.mutateAsync({ id: voucherId, reason: text, version });
      close();
    } catch {
      // cancel.error is shown below
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
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
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Txt variant="heading" style={{ flex: 1, fontSize: 20 }}>
            Cancel {number}?
          </Txt>
          <IconButton icon="x" label="Close" onPress={close} />
        </View>
        <Txt variant="small" tone="body">
          It keeps its number but stops counting in balances, stock, tax and
          reports. This can't be undone.
        </Txt>
        <View style={{ gap: space.sm }}>
          <Txt variant="label" tone="charcoal">
            Reason
          </Txt>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
          >
            {REASONS.map((r) => (
              <Chip
                key={r}
                label={r}
                selected={reason === r}
                onPress={() => setReason(r)}
              />
            ))}
          </View>
          {reason === "Other" ? (
            <View style={{ flexDirection: "row" }}>
              <TextField
                label="Write the reason"
                value={other}
                onChangeText={setOther}
              />
            </View>
          ) : null}
        </View>
        {cancel.error ? <Notice text={cancel.error.message} /> : null}
        <Button
          label="Cancel this voucher"
          variant="danger"
          onPress={confirm}
          loading={cancel.isPending}
          disabled={!text}
          block
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
    gap: space.lg,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.hairlineStrong,
  },
});
