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
import { can, type Permission } from "@repo/core";
import { availableWithoutFirm } from "@/auth/accountRoutes";
import { PrivacyBoundary } from "@/auth/PrivacyBoundary";

/** Root of the app: data cache, safe areas, fonts and the screen stack. */
/** Create and edit screens, with the rights the server checks on their save. */
const CREATE_SCREENS: [string, Permission[] | null][] = [
  ["sale/new", ["sales"]],
  ["sale/retail", ["sales"]],
  ["sale/edit/[id]", ["sales"]],
  ["receipt/new", ["sales"]],
  ["purchase/new", ["purchase"]],
  ["purchase/edit/[id]", ["purchase"]],
  ["payment/new", ["purchase"]],
  ["expense/new", ["purchase"]],
  ["journal/new", ["accounts"]],
  ["journal/financing", ["accounts"]],
  ["account/new", ["accounts"]],
  ["contra/new", ["payments"]],
  ["note/new", ["sales", "purchase"]],
  ["order/new", ["sales", "purchase"]],
  ["order/edit/[id]", ["sales", "purchase"]],
  ["party/new", ["sales", "purchase"]],
  ["party/edit/[id]", ["sales", "purchase"]],
  ["item/new", ["sales", "purchase"]],
  ["item/edit/[id]", ["sales", "purchase"]],
  ["item/variants/[id]", ["sales", "purchase"]],
  ["documents/new", ["sales", "purchase", "payments", "accounts", "settings"]],
  ["settings/firm", ["settings"]],
  ["settings/invoice", ["settings"]],
  ["settings/credit", ["settings"]],
  ["settings/charges", ["settings"]],
  ["settings/stock", ["settings"]],
  ["settings/invite", ["team"]],
  ["settings/transfer", ["team"]],
  ["firms", null],
];

/** List screens whose rows only some roles may read. */
const READ_SCREENS: [string, Permission[]][] = [
  ["purchases", ["purchase", "reports"]],
];

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
            <PrivacyBoundary>
              <Routes />
              <ToastHost />
            </PrivacyBoundary>
          </SafeAreaProvider>
        </DataProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

const AUTH_ROUTES = ["login", "signup", "verify-email", "forgot-password"];

/** Session changes remove screens; PIN locks only cover them so local drafts survive. */
function Routes() {
  const { status, locked, askForPin } = useAuth();
  const data = useData();
  const segments = useSegments();
  const path = segments as string[];
  const signedIn = status === "signedIn";
  const signedOut = status === "signedOut";
  const first = path[0];
  const onPinSetup = first === "settings" && path[1] === "pin";
  const withoutFirm = availableWithoutFirm(path);

  // Safety net for screens that aren't listed below: send people to where they belong
  useEffect(() => {
    if (status === "loading") return;
    if (signedOut && !AUTH_ROUTES.includes(first ?? ""))
      router.replace("/login");
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
      !withoutFirm
    )
      router.replace("/firms");
    else if (signedIn && !locked && data.twoFactorBlocked && !withoutFirm)
      router.replace("/settings/account");
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
    withoutFirm,
    data.loading,
    data.error,
    data.firmId,
    data.twoFactorBlocked,
  ]);

  if (status === "loading") return null;
  if (signedIn && !locked && data.loading && !withoutFirm)
    return (
      <Screen>
        <Txt>Opening your firms...</Txt>
      </Screen>
    );
  if (signedIn && !locked && data.error && !withoutFirm)
    return (
      <Screen>
        <Txt>{data.error.message}</Txt>
        <Button label="Retry" onPress={data.retry} />
        <Button
          label="Account and logout"
          onPress={() => router.replace("/settings/account")}
        />
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
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        {/* The "+" button opens this as a see-through bottom sheet. */}
        <Stack.Screen
          name="create-sheet"
          options={{ presentation: "transparentModal", animation: "fade" }}
        />
        {/* Create forms slide up as full-screen modals. Each opens only for
            roles the server lets save it, so a link or a back step never shows
            a form that would be refused on Save. */}
        {READ_SCREENS.map(([name, needs]) => (
          <Stack.Protected
            key={name}
            guard={
              !REQUIRE_LOGIN ||
              (!!data.role && needs.some((p) => can(data.role!, p)))
            }
          >
            <Stack.Screen name={name} />
          </Stack.Protected>
        ))}
        {CREATE_SCREENS.map(([name, needs]) => (
          <Stack.Protected
            key={name}
            guard={
              !REQUIRE_LOGIN ||
              !needs ||
              (!!data.role && needs.some((p) => can(data.role!, p)))
            }
          >
            <Stack.Screen name={name} options={{ presentation: "modal" }} />
          </Stack.Protected>
        ))}
      </Stack.Protected>
      <Stack.Protected guard={signedOut}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="verify-email" />
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="lock" />
      </Stack.Protected>
    </Stack>
  );
}
