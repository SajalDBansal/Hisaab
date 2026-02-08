export interface OfflineStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  lock<T>(key: string, work: () => Promise<T>): Promise<T>;
}
