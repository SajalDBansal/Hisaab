import Constants from "expo-constants";
import { Platform } from "react-native";
import { webApiUrl } from "./apiUrl";

type ExpoHostInfo = {
  expoConfig?: { hostUri?: string };
  expoGoConfig?: { debuggerHost?: string };
};

function hostFromExpo() {
  // Expo LAN URLs look like "192.168.1.20:8081"; the API runs on the same host.
  const constants = Constants as ExpoHostInfo;
  const host =
    constants.expoConfig?.hostUri ?? constants.expoGoConfig?.debuggerHost;
  return host?.split(":")[0];
}

function defaultApiUrl() {
  const host = hostFromExpo();
  // Match the API's PORT when it isn't 3000; the host still follows Expo's LAN address.
  const port = process.env.EXPO_PUBLIC_API_PORT?.trim() || "3000";
  return `http://${host ?? "localhost"}:${port}`;
}

const envApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

// Where the API lives. Set EXPO_PUBLIC_API_URL to override Expo's LAN auto-detect.
const configuredUrl = envApiUrl || defaultApiUrl();
export const API_URL =
  Platform.OS === "web" && typeof window !== "undefined"
    ? webApiUrl(
        configuredUrl,
        window.location.origin,
        process.env.EXPO_PUBLIC_WEB_API_URL,
      )
    : configuredUrl;

// Set EXPO_PUBLIC_REQUIRE_LOGIN=false to work on the screens with the mock data and no API running.
export const REQUIRE_LOGIN = process.env.EXPO_PUBLIC_REQUIRE_LOGIN !== "false";
