import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Only selection IDs and pending request keys live here. Book snapshots and the
// durable write journal use the separate encrypted offlineStore.
export const dataStorage = {
  async get(key: string): Promise<string | null> {
    return Platform.OS === "web"
      ? localStorage.getItem(key)
      : SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (Platform.OS === "web") localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string) {
    if (Platform.OS === "web") localStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};
