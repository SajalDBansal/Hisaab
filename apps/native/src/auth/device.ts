import * as Device from "expo-device";

export const PLATFORM = "app" as const;

/** What the "logged in elsewhere" message calls this phone, e.g. "Redmi Note 12". */
export function deviceName(): string {
  return Device.deviceName ?? Device.modelName ?? "Phone";
}
