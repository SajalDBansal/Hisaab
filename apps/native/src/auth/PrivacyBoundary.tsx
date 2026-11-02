import type { ReactNode } from "react";
import { Modal, View } from "react-native";
import { colors } from "@/theme";
import { useAuth } from "./AuthProvider";
import LockScreen from "./LockScreen";

/** Cover native books and block input/accessibility without unmounting their navigation. */
export function PrivacyBoundary({ children }: { children: ReactNode }) {
  const { status, locked, concealed } = useAuth();
  const hidden = status === "signedIn" && (locked || concealed);
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1, opacity: hidden ? 0 : 1 }}
        pointerEvents={hidden ? "none" : "auto"}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      <Modal
        visible={hidden}
        animationType="none"
        presentationStyle="fullScreen"
        onRequestClose={() => {}}
      >
        {concealed ? (
          <View
            style={{ flex: 1, backgroundColor: colors.canvas }}
            accessibilityLabel="Hisaab is hidden"
          />
        ) : (
          <LockScreen />
        )}
      </Modal>
    </View>
  );
}
