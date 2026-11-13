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
  unlockWithBiometrics,
} from "./pin";
import { sessionStore } from "./session";
import { createAppPrivacy } from "./appPrivacy";
import { replicaStore } from "@/replica/replicaStore";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthState {
  status: Status;
  me: Me | null;
  /** The PIN screen is showing. */
  locked: boolean;
  /** Hide app contents while inactive or checking the PIN timeout, without removing drafts. */
  concealed: boolean;
  /** Right after logging in on a phone with no PIN yet: send them to set one. */
  askForPin: boolean;
  clearAskForPin(): void;
  /** Why the person was logged out, shown on the login screen once. */
  endedReason: string | null;
  lockError: string | null;
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
  unlockBiometric(): Promise<string | null>;
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
  const [locked, setLocked] = useState(REQUIRE_LOGIN && pinSupported);
  const [concealed, setConcealed] = useState(false);
  const lockState = useRef(REQUIRE_LOGIN && pinSupported);
  const lockRevision = useRef(0);
  const logoutPending = useRef(false);
  const logoutWork = useRef<Promise<void> | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [askForPin, setAskForPin] = useState(false);

  const lock = useCallback((value: boolean) => {
    lockState.current = value;
    setLocked(value);
  }, []);

  const holdLock = useCallback(
    (message: string) => {
      lockRevision.current++;
      lock(true);
      setAskForPin(false);
      setLockError(message);
      setStatus("signedIn");
    },
    [lock],
  );

  const resetView = useCallback(
    (reason: string | null) => {
      allowRefresh.current = false;
      setMe(null);
      lock(false);
      setLockError(null);
      logoutPending.current = false;
      setAskForPin(false);
      setEndedReason(reason);
      setStatus("signedOut");
      queryClient.clear();
    },
    [queryClient, lock],
  );

  useEffect(
    () =>
      sessionStore.subscribe(() => {
        if (!pinSupported) return resetView(null);
        allowRefresh.current = false;
        logoutPending.current = true;
        holdLock("Finishing logout. Please wait.");
        setMe(null);
        queryClient.clear();
      }),
    [resetView, holdLock, queryClient],
  );

  const finishLogout = useCallback(
    (reason: string | null = null): Promise<void> => {
      if (logoutWork.current) return logoutWork.current;
      allowRefresh.current = false;
      logoutPending.current = true;
      if (pinSupported) holdLock("Finishing logout. Please wait.");
      else resetView(reason);
      const work = (async () => {
        try {
          await clearLogin();
          await removePin();
          // The books on this phone leave with the login.
          await replicaStore.clear().catch(() => undefined);
          resetView(reason);
        } catch {
          if (pinSupported) {
            holdLock(
              "Logout could not finish. The app is locked. Restore secure storage access and retry logout. Your pending entries and attachments are kept.",
            );
          } else {
            setEndedReason(
              "This view is signed out, but the browser could not save the logout. Close all Hisaab tabs, restore access to site storage and retry logout before sharing this device. Do not clear site data while entries are pending.",
            );
          }
        }
      })();
      logoutWork.current = work;
      void work.finally(() => {
        logoutWork.current = null;
      });
      return work;
    },
    [resetView, holdLock],
  );

  /** Asks the server who we are. A 401 means the login has ended. */
  const refresh = useCallback(async () => {
    if (!REQUIRE_LOGIN || !allowRefresh.current) return;
    const revision = sessionStore.revision;
    const stillCurrent = () =>
      allowRefresh.current && revision === sessionStore.revision;
    try {
      if (!(await sessionStore.canRefresh())) {
        if (stillCurrent()) {
          if (pinSupported) await finishLogout();
          else resetView(null);
        }
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
        try {
          const saved = Me.safeParse(await sessionStore.readIdentity());
          if (!stillCurrent()) return;
          if (saved.success) {
            setMe(saved.data);
            setStatus("signedIn");
          } else await finishLogout(null);
        } catch {
          if (!stillCurrent()) return;
          if (pinSupported)
            holdLock(
              "Secure storage is unavailable. Retry or log out when it is available again.",
            );
          else
            resetView(
              "Local login storage is unavailable. Restore access and try again.",
            );
        }
      } else {
        if (pinSupported)
          holdLock(
            "The login could not be checked. Retry or log out when secure storage and the connection are available.",
          );
        else {
          if (e instanceof Error) setEndedReason(e.message);
          setStatus((s) => (s === "loading" ? "signedOut" : s));
        }
      }
    }
  }, [finishLogout, resetView, holdLock]);

  // A new login is complete only after its cookie can authenticate a real request.
  const completeSignIn = useCallback(async () => {
    if (!pinSupported) await sessionStore.activate();
    const revision = sessionStore.revision;
    setEndedReason(null);
    allowRefresh.current = true;
    try {
      const current = await api<Me>("/v1/me");
      const needsPin = pinSupported && !(await hasPin());
      if (pinSupported && !needsPin) await getPinSettings();
      if (revision !== sessionStore.revision || !allowRefresh.current)
        throw new Error("The login session changed. Please try again.");
      setMe(current);
      setStatus("signedIn");
      lock(false);
      setLockError(null);
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
  }, [finishLogout, lock]);

  // On start: check the login, and lock straight away if a PIN is set
  useEffect(() => {
    if (!REQUIRE_LOGIN) return;
    let cancelled = false;
    const expected = lockRevision.current;
    void (async () => {
      try {
        if (pinSupported) {
          const configured = await hasPin();
          if (configured) await getPinSettings();
          if (
            cancelled ||
            expected !== lockRevision.current ||
            logoutPending.current
          )
            return;
          lock(configured);
        }
      } catch {
        if (
          cancelled ||
          expected !== lockRevision.current ||
          logoutPending.current
        )
          return;
        holdLock(
          "The app lock could not be read. Retry or log out when secure storage is available.",
        );
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, lock, holdLock]);

  // Privacy concealment keeps navigation and local drafts mounted during native handoffs.
  useEffect(() => {
    if (!REQUIRE_LOGIN) return;
    const privacy = createAppPrivacy({
      now: Date.now,
      isLocked: () => lockState.current,
      identity: () => `${sessionStore.revision}:${lockRevision.current}`,
      canRefresh: () => allowRefresh.current && !logoutPending.current,
      readTimeout: async () => {
        if (!pinSupported || !(await hasPin())) return null;
        return (await getPinSettings()).lockAfterMinutes * 60_000;
      },
      conceal: (value) => {
        if (pinSupported) setConcealed(value);
      },
      lock: () => {
        lockRevision.current++;
        lock(true);
      },
      fail: () =>
        holdLock(
          "The app lock could not be read. Retry or log out when secure storage is available.",
        ),
      refresh,
    });
    const sub = AppState.addEventListener(
      "change",
      (state) => void privacy.change(state),
    );
    if (AppState.currentState && AppState.currentState !== "active")
      void privacy.change(AppState.currentState);
    return () => {
      sub.remove();
      privacy.dispose();
    };
  }, [refresh, lock, holdLock]);

  const unlock = useCallback(
    async (pin?: string): Promise<string | null> => {
      if (logoutPending.current || !allowRefresh.current)
        return "Logout is incomplete. Retry logout before signing in again.";
      const revision = sessionStore.revision;
      const expected = lockRevision.current;
      try {
        if (!(await sessionStore.canRefresh())) {
          await finishLogout();
          return "Please log in again.";
        }
        if (pin === undefined) {
          if (!(await unlockWithBiometrics()))
            return "Fingerprint or face unlock was not completed. Enter your PIN.";
        } else {
          const check = await checkPin(pin);
          if (check.result === "too-many") {
            await finishLogout("Too many wrong PINs. Please log in again.");
            return "Too many wrong PINs.";
          }
          if (check.result === "wrong")
            return `Wrong PIN. ${check.triesLeft} ${check.triesLeft === 1 ? "try" : "tries"} left.`;
        }
        await refresh();
        if (!me) {
          return "Login checked. Try unlocking again.";
        }
        if (
          revision !== sessionStore.revision ||
          expected !== lockRevision.current ||
          logoutPending.current ||
          !allowRefresh.current ||
          AppState.currentState !== "active"
        )
          return "The lock or login changed. Please try again.";
        lock(false);
        setLockError(null);
        return null;
      } catch {
        if (
          revision !== sessionStore.revision ||
          expected !== lockRevision.current ||
          logoutPending.current ||
          !allowRefresh.current
        )
          return "The lock or login changed. Please try again.";
        holdLock(
          "The PIN or secure storage could not be read. Retry or log out to reset the lock.",
        );
        return "Could not unlock. Restore secure storage access and retry, or log out.";
      }
    },
    [finishLogout, holdLock, lock, me, refresh],
  );

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
      concealed,
      endedReason,
      lockError,
      askForPin,
      clearAskForPin: () => setAskForPin(false),
      async signUp(input) {
        await api("/api/auth/sign-up/email", { body: input });
      },
      async signIn(email, password, takeOver) {
        if (pinSupported) await sessionStore.activate();
        await api("/api/auth/sign-in/email", {
          body: { email, password },
          headers: takeOver ? { "x-confirm-takeover": "true" } : undefined,
        });
        await completeSignIn();
      },
      async verifyEmail(email, otp) {
        if (pinSupported) await sessionStore.activate();
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
        if (pinSupported) {
          logoutPending.current = true;
          holdLock("Finishing logout. Please wait.");
          const cookie = await sessionStore.readCookie().catch(() => null);
          // Keep only this request's cookie while durable local logout proceeds.
          // A late reply is fenced by clearLogin's session revision.
          void api("/api/auth/sign-out", {
            method: "POST",
            body: {},
            headers: cookie ? { cookie } : undefined,
          }).catch(() => {});
        } else {
          await api("/api/auth/sign-out", { method: "POST", body: {} }).catch(
            () => {},
          );
        }
        await finishLogout(reason ?? null);
      },
      endSession: finishLogout,
      unlock,
      unlockBiometric: () => unlock(),
      lockNow: () => {
        lockRevision.current++;
        lock(true);
      },
      refresh,
      clearEndedReason: () => setEndedReason(null),
    }),
    [
      status,
      me,
      locked,
      concealed,
      endedReason,
      lockError,
      askForPin,
      refresh,
      finishLogout,
      completeSignIn,
      holdLock,
      lock,
      unlock,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
