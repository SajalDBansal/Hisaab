type PrivacyDependencies = {
  now(): number;
  isLocked(): boolean;
  identity(): string;
  canRefresh(): boolean;
  readTimeout(): Promise<number | null>;
  conceal(value: boolean): void;
  lock(): void;
  fail(): void;
  refresh(): Promise<void>;
};

/** Conceal immediately; decide whether a PIN is due only after returning to the app. */
export function createAppPrivacy(deps: PrivacyDependencies) {
  let leftAt: number | null = null;
  let generation = 0;
  let active = true;
  let disposed = false;

  async function change(state: string) {
    if (disposed) return;
    active = state === "active";
    const event = ++generation;
    if (!active) {
      leftAt ??= deps.now();
      deps.conceal(true);
      return;
    }
    if (leftAt === null) return;
    const away = deps.now() - leftAt;
    leftAt = null;
    const identity = deps.identity();
    const current = () => !disposed && active && generation === event;
    try {
      if (!deps.canRefresh()) return;
      const timeout = await deps.readTimeout();
      if (!current() || deps.identity() !== identity || !deps.canRefresh())
        return;
      if (!deps.isLocked() && timeout !== null && (away < 0 || away >= timeout))
        deps.lock();
    } catch {
      if (current() && deps.identity() === identity && deps.canRefresh())
        deps.fail();
    } finally {
      if (current()) deps.conceal(false);
    }
    if (current() && deps.canRefresh()) await deps.refresh();
  }

  return {
    change,
    dispose() {
      disposed = true;
      generation++;
    },
  };
}
