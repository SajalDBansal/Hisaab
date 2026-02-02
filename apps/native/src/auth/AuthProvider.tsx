import { Me } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { ApiFailure, api, clearLogin } from "./api";
import { REQUIRE_LOGIN } from "./config";
import {
  checkPin,
  getPinSettings,
  hasPin,
  pinSupported,
  removePin,
} from "./pin";
import { sessionStore } from "./session";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthState {
  status: Status;
  me: Me | null;
  /** The PIN screen is showing. */
  locked: boolean;
  /** Right after logging in on a phone with no PIN yet: send them to set one. */
  askForPin: boolean;
  clearAskForPin(): void;
  /** Why the person was logged out, shown on the login screen once. */
  endedReason: string | null;
  signUp(input: {
    name: string;
    email: string;
    phoneNumber: string;
    password: string;
  }): Promise<void>;
  /** Pass `takeOver` after the person agrees to log out the other device. */
  signIn(email: string, password: string, takeOver?: boolean): Promise<void>;
  verifyEmail(email: string, otp: string): Promise<void>;
  sendEmailCode(email: string): Promise<void>;
  signOut(reason?: string): Promise<void>;
  /** A definitive server rejection ends local access without another identity request. */
  endSession(reason?: string | null): Promise<void>;
  /** Returns the reply to show: null when unlocked. */
  unlock(pin: string): Promise<string | null>;
  unlockedByBiometrics(): void;
  lockNow(): void;
  refresh(): Promise<void>;
  clearEndedReason(): void;
}

const AuthContext = createContext<AuthState | null>(null);
const CHECK_EVERY_MS = 2 * 60 * 1000;

/** Knows who is logged in, whether the app is locked, and keeps checking the login is still valid. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const allowRefresh = useRef(true);
  const [status, setStatus] = useState<Status>(
    REQUIRE_LOGIN ? "loading" : "signedIn",
  );
  const [me, setMe] = useState<Me | null>(null);
  const [locked, setLocked] = useState(false);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [askForPin, setAskForPin] = useState(false);
  const leftAt = useRef<number | null>(null);

  const resetView = useCallback(
    (reason: string | null) => {
      allowRefresh.current = false;
      setMe(null);
      setLocked(false);
      setAskForPin(false);
      setEndedReason(reason);
      setStatus("signedOut");
      queryClient.clear();
    },
    [queryClient],
  );

  useEffect(() => sessionStore.subscribe(() => resetView(null)), [resetView]);

  const finishLogout = useCallback(
    async (reason: string | null = null) => {
      const cleared = clearLogin();
      resetView(reason);
      try {
        await Promise.all([cleared, removePin()]);
      } catch {
        setEndedReason(
          "This view is signed out, but the browser or device could not save the logout. Close all Hisaab tabs, restore access to site storage and retry logout before sharing this device. Do not clear site data while entries are pending.",
        );
      }
    },
    [resetView],
  );

  /** Asks the server who we are. A 401 means the login has ended. */
  const refresh = useCallback(async () => {
    if (!REQUIRE_LOGIN || !allowRefresh.current) return;
    const revision = sessionStore.revision;
    const stillCurrent = () =>
      allowRefresh.current && revision === sessionStore.revision;
    try {
      if (!(await sessionStore.canRefresh())) {
        if (stillCurrent()) resetView(null);
        return;
      }
      const current = await api<Me>("/v1/me");
      if (!stillCurrent()) return;
      setMe(current);
      setStatus("signedIn");
      await sessionStore.saveIdentity(current, revision).catch(() => {});
    } catch (e) {
      if (!stillCurrent()) return;
      if (e instanceof ApiFailure && e.status === 401) {
        await finishLogout(e.code === "SESSION_REPLACED" ? e.message : null);
      } else if (e instanceof ApiFailure && e.offline) {
        // No internet: stay logged in with what we last knew, so the shop can keep working
        const saved = Me.safeParse(
          await sessionStore.readIdentity().catch(() => null),
        );
        if (!stillCurrent()) return;
        if (saved.success) {
          setMe(saved.data);
          setStatus("signedIn");
        } else await finishLogout(null);
      } else {
        if (e instanceof Error) setEndedReason(e.message);
        setStatus((s) => (s === "loading" ? "signedOut" : s));
      }
    }
  }, [finishLogout, resetView]);

  // A new login is complete only after its cookie can authenticate a real request.
  const completeSignIn = useCallback(async () => {
    await sessionStore.activate();
    const revision = sessionStore.revision;
    setEndedReason(null);
    allowRefresh.current = true;
    try {
      const current = await api<Me>("/v1/me");
      const needsPin = pinSupported && !(await hasPin());
      if (revision !== sessionStore.revision || !allowRefresh.current)
        throw new Error("The login session changed. Please try again.");
      setMe(current);
      setStatus("signedIn");
      setAskForPin(needsPin);
      await sessionStore.saveIdentity(current, revision).catch(() => {});
    } catch (error) {
      if (revision === sessionStore.revision) await finishLogout();
      if (
        error instanceof ApiFailure &&
        error.status === 401 &&
        error.code !== "SESSION_REPLACED"
      )
        throw new ApiFailure(
          401,
          "SESSION_NOT_SAVED",
          "Couldn't keep your login session. On web, allow site cookies and check the API address, then try again.",
        );
      throw error;
    }
  }, [finishLogout]);

  // On start: check the login, and lock straight away if a PIN is set
  useEffect(() => {
    if (!REQUIRE_LOGIN) return;
    void (async () => {
      if (pinSupported && (await hasPin())) setLocked(true);
      await refresh();
    })();
  }, [refresh]);

  // Coming back to the app: lock again if it was away longer than the person chose, and re-check the login
  useEffect(() => {
    if (!REQUIRE_LOGIN) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        leftAt.current ??= Date.now();
        return;
      }
      const away = leftAt.current === null ? 0 : Date.now() - leftAt.current;
      leftAt.current = null;
      void (async () => {
        if (pinSupported && (await hasPin())) {
          const { lockAfterMinutes } = await getPinSettings();
          if (away >= lockAfterMinutes * 60_000) setLocked(true);
        }
        await refresh();
      })();
    });
    return () => sub.remove();
  }, [refresh]);

  // While open, notice if the account was opened on another device
  useEffect(() => {
    if (!REQUIRE_LOGIN || status !== "signedIn") return;
    const timer = setInterval(() => void refresh(), CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [status, refresh]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      locked,
      endedReason,
      askForPin,
      clearAskForPin: () => setAskForPin(false),
      async signUp(input) {
        await api("/api/auth/sign-up/email", { body: input });
      },
      async signIn(email, password, takeOver) {
        await api("/api/auth/sign-in/email", {
          body: { email, password },
          headers: takeOver ? { "x-confirm-takeover": "true" } : undefined,
        });
        await completeSignIn();
      },
      async verifyEmail(email, otp) {
        await api("/api/auth/email-otp/verify-email", { body: { email, otp } });
        await completeSignIn();
      },
      async sendEmailCode(email) {
        await api("/api/auth/email-otp/send-verification-otp", {
          body: { email, type: "email-verification" },
        });
      },
      async signOut(reason) {
        allowRefresh.current = false;
        await api("/api/auth/sign-out", { method: "POST", body: {} }).catch(
          () => {},
        );
        await finishLogout(reason ?? null);
      },
      endSession: finishLogout,
      async unlock(pin) {
        const check = await checkPin(pin);
        if (check.result === "ok") {
          setLocked(false);
          return null;
        }
        if (check.result === "too-many") {
          await finishLogout("Too many wrong PINs. Please log in again.");
          return "Too many wrong PINs.";
        }
        return `Wrong PIN. ${check.triesLeft} ${check.triesLeft === 1 ? "try" : "tries"} left.`;
      },
      unlockedByBiometrics: () => setLocked(false),
      lockNow: () => setLocked(true),
      refresh,
      clearEndedReason: () => setEndedReason(null),
    }),
    [
      status,
      me,
      locked,
      endedReason,
      askForPin,
      refresh,
      finishLogout,
      completeSignIn,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
