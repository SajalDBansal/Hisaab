import { Pressable, View } from "react-native";
import {
  DASHBOARD_CARDS,
  moveDashboardCard,
  setDashboardCardVisible,
  type DashboardCardId,
} from "@repo/core";
import { FirmDetail } from "@repo/contracts";
import { Button, Card, Header, Icon, Notice, Screen, Txt } from "@/components";
import { REQUIRE_LOGIN } from "@/auth/config";
import { useDashboardLayout } from "@/data/dashboardLayout";
import { useFirm } from "@/data/queries";
import { colors, space } from "@/theme";

/** Customise dashboard (doc 37, T63): show, hide and order the Home cards. Saved on this device for this user. */
export default function CustomiseDashboardScreen() {
  const firm = useFirm();
  const permissions = FirmDetail.safeParse(firm.data).data?.permissions ?? [];
  const canCreate = !REQUIRE_LOGIN || permissions.includes("sales");
  const layout = useDashboardLayout({ canCreate });
  const slots = layout.slots;
  const shown = slots.filter((s) => s.visible).length;

  return (
    <Screen
      header={
        <Header
          title="Customise dashboard"
          subtitle={`${shown} of ${slots.length} cards on Home`}
        />
      }
    >
      <Txt variant="small" tone="body">
        {
          "Tick the cards you want on Home and move them up or down. This is kept on this device for you; other people's Home screens don't change."
        }
      </Txt>
      {layout.error ? (
        <Notice
          text={`Couldn't save on this device: ${layout.error.message}`}
        />
      ) : null}
      <Card style={{ paddingVertical: space.xs }}>
        {slots.map((slot, index) => (
          <CardRow
            key={slot.id}
            id={slot.id}
            visible={slot.visible}
            first={index === 0}
            last={index === slots.length - 1}
            onToggle={() =>
              layout.save(
                setDashboardCardVisible(slots, slot.id, !slot.visible),
              )
            }
            onMove={(step) =>
              layout.save(moveDashboardCard(slots, slot.id, step))
            }
          />
        ))}
      </Card>
      <Button
        label="Back to the default layout"
        icon="rotate-ccw"
        onPress={() => layout.save(null)}
      />
    </Screen>
  );
}

function CardRow({
  id,
  visible,
  first,
  last,
  onToggle,
  onMove,
}: {
  id: DashboardCardId;
  visible: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onMove: (step: -1 | 1) => void;
}) {
  const card = DASHBOARD_CARDS[id];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: space.sm,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.hairlineSoft,
      }}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: visible }}
        aria-checked={visible}
        accessibilityLabel={`Show ${card.title}`}
        onPress={onToggle}
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          minHeight: 44,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: visible ? colors.ink : colors.hairlineStrong,
            backgroundColor: visible ? colors.ink : colors.canvas,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {visible ? (
            <Icon name="check" size={14} color={colors.onPrimary} />
          ) : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="bodyStrong" tone={visible ? "ink" : "body"}>
            {card.title}
          </Txt>
          <Txt variant="caption" tone="body" numberOfLines={2}>
            {card.note}
          </Txt>
        </View>
      </Pressable>
      <MoveButton
        icon="arrow-up"
        label={`Move ${card.title} up`}
        disabled={first}
        onPress={() => onMove(-1)}
      />
      <MoveButton
        icon="arrow-down"
        label={`Move ${card.title} down`}
        disabled={last}
        onPress={() => onMove(1)}
      />
    </View>
  );
}

function MoveButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "arrow-up" | "arrow-down";
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.hairline,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.3 : 1,
        backgroundColor: pressed ? colors.surfaceSoft : colors.canvas,
      })}
    >
      <Icon name={icon} size={18} />
    </Pressable>
  );
}
