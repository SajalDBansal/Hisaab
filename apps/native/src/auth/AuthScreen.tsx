import type { ReactNode } from "react";
import { View } from "react-native";
import { Screen, Txt } from "@/components";
import { space } from "@/theme";

/** Shared frame for the sign-up, login and code screens: big title, short note, then the form. */
export function AuthScreen({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <Screen contentStyle={{ paddingTop: space.xl, gap: space.lg }}>
      <View style={{ gap: 6 }}>
        <Txt variant="display">Hisaab</Txt>
        <Txt variant="title">{title}</Txt>
        {note ? (
          <Txt variant="body" tone="body">
            {note}
          </Txt>
        ) : null}
      </View>
      {children}
    </Screen>
  );
}
