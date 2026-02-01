import { Nunito_600SemiBold } from "@expo-google-fonts/nunito/600SemiBold";
import { Nunito_700Bold } from "@expo-google-fonts/nunito/700Bold";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@/theme";
import { ToastHost, Screen, Txt, Button } from "@/components";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { DataProvider, useData } from "@/data/DataProvider";
import { REQUIRE_LOGIN } from "@/auth/config";

/** Root of the app: data cache, safe areas, fonts and the screen stack. */
export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );
  const [fontsLoaded] = useFonts({ Nunito_600SemiBold, Nunito_700Bold });
  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DataProvider>
          <SafeAreaProvider>
            <StatusBar style="dark" />
            <Routes />
            <ToastHost />
          </SafeAreaProvider>
        </DataProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

const AUTH_ROUTES = ["login", "signup", "verify-email", "forgot-password"];

/** The screen stack. Which screens exist depends on whether the person is logged in and unlocked. */
function Routes() {
  const { status, locked, askForPin } = useAuth();
  const data = useData();
  const segments = useSegments();
  const path = segments as string[];
  const signedIn = status === "signedIn";
  const signedOut = status === "signedOut";
  const first = path[0];
  const onPinSetup = first === "settings" && path[1] === "pin";

  // Safety net for screens that aren't listed below: send people to where they belong
  useEffect(() => {
    if (status === "loading") return;
    if (signedOut && !AUTH_ROUTES.includes(first ?? ""))
      router.replace("/login");
    else if (signedIn && locked && first !== "lock") router.replace("/lock");
    else if (signedIn && !locked && askForPin && !onPinSetup)
      router.replace("/settings/pin?first=1");
    else if (
      signedIn &&
      !locked &&
      !askForPin &&
      REQUIRE_LOGIN &&
      !data.loading &&
      !data.error &&
      !data.firmId &&
      first !== "firms"
    )
      router.replace("/firms");
    else if (
      signedIn &&
      !locked &&
      (AUTH_ROUTES.includes(first ?? "") || first === "lock")
    )
      router.replace("/");
  }, [
    status,
    locked,
    first,
    signedIn,
    signedOut,
    askForPin,
    onPinSetup,
    data.loading,
    data.error,
    data.firmId,
  ]);

  if (status === "loading") return null;
  if (signedIn && !locked && data.loading)
    return (
      <Screen>
        <Txt>Opening your firms...</Txt>
      </Screen>
    );
  if (signedIn && !locked && data.error)
    return (
      <Screen>
        <Txt>{data.error.message}</Txt>
        <Button label="Retry" onPress={data.retry} />
      </Screen>
    );
  return (
    <Stack
      key={`${data.userId}:${data.firmId ?? "no-firm"}`}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Protected guard={signedIn && !locked}>
        <Stack.Screen name="(tabs)" />
        {/* The "+" button opens this as a see-through bottom sheet. */}
        <Stack.Screen
          name="create-sheet"
          options={{ presentation: "transparentModal", animation: "fade" }}
        />
        {/* Create forms slide up as full-screen modals. */}
        {[
          "sale/new",
          "purchase/new",
          "receipt/new",
          "payment/new",
          "expense/new",
          "journal/new",
          "journal/financing",
          "account/new",
          "documents/new",
          "party/new",
          "party/edit/[id]",
          "item/new",
          "item/edit/[id]",
          "sale/edit/[id]",
          "purchase/edit/[id]",
          "note/new",
          "order/new",
          "order/edit/[id]",
          "contra/new",
          "firms",
          "settings/firm",
          "settings/invoice",
          "settings/invite",
        ].map((name) => (
          <Stack.Screen
            key={name}
            name={name}
            options={{ presentation: "modal" }}
          />
        ))}
      </Stack.Protected>
      <Stack.Protected guard={signedOut}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="verify-email" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && locked}>
        <Stack.Screen name="lock" />
      </Stack.Protected>
    </Stack>
  );
}
