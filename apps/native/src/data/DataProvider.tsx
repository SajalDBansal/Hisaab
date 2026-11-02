import { FirmDetail, FirmListRow } from "@repo/contracts";
import type { Role } from "@repo/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { z } from "zod";
import { useAuth } from "../auth/AuthProvider";
import { api, ApiFailure } from "../auth/api";
import { REQUIRE_LOGIN } from "../auth/config";
import { dataStorage } from "./storage";
import { restoreFirm, selectionKey } from "./firmSelection";
import { withPendingWrites, releasePendingWrite } from "./pendingWrites";
import { remoteServices } from "./remoteServices";
import { demoServices, type Services } from "./services";
import { uploadDocumentFile } from "./documentFiles";
import { sessionStore } from "../auth/session";
import { offlineStore } from "./offlineStore";
import {
  createOfflineAccess,
  offlineAccessMaxAge,
  offlineLeaseActive,
} from "./offlineAccess";
import { createOfflineBooks, type OfflineBooks } from "./offlineBooks";
import { subscribeOfflineReconnect } from "./offlineReconnect";
import { createAttachmentDrafts } from "./attachmentDrafts";
import { attachmentStorage } from "./attachmentStorage";
import type { Transport } from "./client";
import { serverRecovery } from "./recoveryEpoch";
import {
  availableFirm,
  clearPreviousBookAccess,
  membershipScope,
} from "./accessScope";

interface DataState {
  userId: string;
  firmId: string | null;
  role: Role | null;
  accessKey: string;
  services: Services;
  offline: OfflineBooks | null;
  loading: boolean;
  error: Error | null;
  retry(): void;
}
const DataContext = createContext<DataState | null>(null);
const offlineAccess = createOfflineAccess(offlineStore);
const attachmentDrafts = createAttachmentDrafts(
  attachmentStorage,
  Crypto.randomUUID,
);

async function loadFirmSelection(userId: string) {
  let rows: z.infer<typeof FirmListRow>[];
  let expiresAt: number;
  try {
    rows = z.array(FirmListRow).parse(await api("/v1/firms"));
    await offlineAccess.save(userId, rows);
    expiresAt = Date.now() + offlineAccessMaxAge;
  } catch (error) {
    if (!(error instanceof ApiFailure) || !error.offline) throw error;
    const grant = await offlineAccess.restoreGrant(userId);
    rows = grant.rows;
    expiresAt = grant.expiresAt;
  }
  return {
    rows,
    expiresAt,
    restored: await restoreFirm(dataStorage, userId, rows),
  };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { me, status, locked } = useAuth();
  const userId = REQUIRE_LOGIN ? (me?.id ?? "signed-out") : "demo";
  // Remount the data scope on account changes, so no pending selection leaks to another login.
  return (
    <UserData
      key={userId}
      userId={userId}
      enabled={status === "signedIn" && !locked}
    >
      {children}
    </UserData>
  );
}

function UserData({
  userId,
  enabled,
  children,
}: {
  userId: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const cache = useQueryClient();
  const { endSession } = useAuth();
  useEffect(
    () =>
      serverRecovery.subscribe(() => {
        cache.removeQueries({ queryKey: ["books", userId] });
        void cache.invalidateQueries({ queryKey: ["firm-selection", userId] });
      }),
    [cache, userId],
  );
  const [selected, setSelected] = useState<string | null | undefined>();
  const firms = useQuery({
    networkMode: "always",
    queryKey: ["firm-selection", userId],
    enabled: REQUIRE_LOGIN && enabled,
    refetchInterval: 60_000,
    queryFn: () => loadFirmSelection(userId),
  });
  const firmId = REQUIRE_LOGIN
    ? availableFirm(
        selected,
        firms.data?.restored,
        offlineLeaseActive(firms.data?.expiresAt ?? 0)
          ? (firms.data?.rows ?? [])
          : [],
      )
    : "demo";
  const role: Role | null = REQUIRE_LOGIN
    ? (firms.data?.rows.find((row) => row.id === firmId)?.role ?? null)
    : "owner";
  const accessKey = REQUIRE_LOGIN ? membershipScope(firms.data?.rows) : "demo";
  const revision = sessionStore.revision;
  const identity = JSON.stringify([
    userId,
    firmId,
    role,
    accessKey,
    enabled,
    revision,
  ]);
  const activeScope = useRef(identity);
  const leaseUntil = useRef(firms.data?.expiresAt ?? 0);
  leaseUntil.current = firms.data?.expiresAt ?? 0;
  activeScope.current = identity;
  useEffect(() => {
    activeScope.current = identity;
    return () => {
      activeScope.current = "unmounted";
    };
  }, [identity]);
  useEffect(() => {
    void clearPreviousBookAccess(cache, userId, accessKey);
  }, [cache, userId, accessKey]);
  useEffect(() => {
    if (!REQUIRE_LOGIN || !enabled) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active")
        void cache.invalidateQueries({ queryKey: ["firm-selection", userId] });
    });
    return () => sub.remove();
  }, [cache, enabled, userId]);
  useEffect(() => {
    if (firms.error instanceof ApiFailure && firms.error.status === 401)
      void endSession(firms.error.message);
  }, [firms.error, endSession]);
  const onlineTransport = useMemo<Transport>(
    () => async (path, options) => {
      try {
        return await api(path, options);
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401)
          await endSession(error.message);
        if (error instanceof ApiFailure && error.status === 403)
          void cache.invalidateQueries({
            queryKey: ["firm-selection", userId],
          });
        throw error;
      }
    },
    [userId, endSession, cache],
  );
  const offline = useMemo(() => {
    if (!REQUIRE_LOGIN || !enabled || !firmId || !role) return null;
    const assertActive = () => {
      if (
        activeScope.current !== identity ||
        sessionStore.revision !== revision
      )
        throw new Error(
          "The account, firm, role or session changed. Reopen Offline books.",
        );
      if (!offlineLeaseActive(leaseUntil.current))
        throw new Error(
          "Connect to verify access. The offline membership grant has expired.",
        );
    };
    return createOfflineBooks({
      scope: { userId, firmId, role },
      store: offlineStore,
      transport: onlineTransport,
      newId: Crypto.randomUUID,
      assertActive,
      verifyAccess: async () => {
        assertActive();
        const rows = z
          .array(FirmListRow)
          .parse(await onlineTransport("/v1/firms"));
        assertActive();
        await offlineAccess.save(userId, rows);
        leaseUntil.current = Date.now() + offlineAccessMaxAge;
        cache.setQueryData(["firm-selection", userId], {
          rows,
          restored: firmId,
          expiresAt: leaseUntil.current,
        });
        if (!rows.some((row) => row.id === firmId && row.role === role))
          throw new ApiFailure(
            403,
            "ACCESS_CHANGED",
            "This firm's membership or role changed.",
          );
      },
      beforeExecute: async (entry) => {
        if (!entry.attachmentDraft) return;
        const key = entry.sourceKey ?? entry.key;
        try {
          await attachmentDrafts.checkCopies(
            { userId, firmId, role },
            {
              id: key,
              scope: { userId, firmId, target: "draft", entryId: key },
            },
            assertActive,
          );
        } catch (error) {
          throw Object.assign(
            error instanceof Error
              ? error
              : new Error("Attachment copies need attention."),
            { status: 422 },
          );
        }
      },
      confirmed: async (entry) => {
        assertActive();
        const key = entry.sourceKey ?? entry.key;
        if (entry.result)
          await attachmentDrafts.receive(
            { userId, firmId, role },
            {
              id: key,
              scope: { userId, firmId, target: "draft", entryId: key },
            },
            entry.state === "cancelled" && entry.result.state === "conflict"
              ? { state: "cancelled" }
              : entry.result,
            assertActive,
          );
        await releasePendingWrite(dataStorage, entry.pendingStorageKey, key);
      },
    });
  }, [
    userId,
    firmId,
    role,
    identity,
    revision,
    enabled,
    onlineTransport,
    cache,
  ]);
  const transport = useMemo(
    () =>
      withPendingWrites(
        offline?.transport ?? onlineTransport,
        dataStorage,
        userId,
        (text) =>
          Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
        Crypto.randomUUID,
        !!offline,
      ),
    [userId, offline, onlineTransport],
  );
  useEffect(() => {
    if (!offline) return;
    void offline.load().catch(() => {});
    const sync = () =>
      void offline
        .sync()
        .then(() => cache.invalidateQueries({ queryKey: ["books", userId] }))
        .catch(() => {});
    sync();
    const timer = setInterval(sync, 30_000);
    const unsubscribeReconnect = subscribeOfflineReconnect(() => {
      void cache
        .invalidateQueries({ queryKey: ["firm-selection", userId] })
        .then(sync)
        .catch(() => {});
    });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => {
      clearInterval(timer);
      unsubscribeReconnect();
      subscription.remove();
    };
  }, [offline, cache, userId]);

  const services = useMemo<Services>(() => {
    if (!REQUIRE_LOGIN) return demoServices;
    const remote = remoteServices(transport, firmId, uploadDocumentFile);
    const switchTo = async (id: string) => {
      // Verify access before changing the visible firm or persisting the selection.
      FirmDetail.parse(
        await api("/v1/firms/current", { headers: { "x-firm-id": id } }),
      );
      await cache.invalidateQueries({ queryKey: ["firm-selection", userId] });
      await dataStorage.set(selectionKey(userId), id);
      setSelected(id);
      cache.removeQueries({ queryKey: ["books", userId] });
    };
    return {
      ...remote,
      firmService: {
        ...remote.firmService,
        list: async () => {
          const selection = await cache.fetchQuery({
            queryKey: ["firm-selection", userId],
            queryFn: () => loadFirmSelection(userId),
            staleTime: 0,
          });
          return selection.rows.map((row) => ({
            firm: row,
            active: row.id === firmId,
            parties: row.parties,
            vouchers: row.vouchers,
          }));
        },
        switchTo,
        create: async (input) => {
          const firm = FirmDetail.parse(
            await api("/v1/firms", { body: input }),
          );
          await switchTo(firm.id);
          await cache.invalidateQueries({
            queryKey: ["firm-selection", userId],
          });
          return firm;
        },
      },
    };
  }, [transport, firmId, userId, cache]);

  return (
    <DataContext.Provider
      value={{
        userId,
        firmId,
        role,
        accessKey,
        services,
        offline,
        loading: REQUIRE_LOGIN && enabled && firms.isPending,
        error: REQUIRE_LOGIN ? firms.error : null,
        retry: () => {
          void firms.refetch();
        },
      }}
    >
      {/* Other firms can change without discarding this firm's open draft. */}
      <Fragment key={`${firmId ?? "no-firm"}:${role ?? "no-role"}`}>
        {children}
      </Fragment>
    </DataContext.Provider>
  );
}

export function useData() {
  const data = useContext(DataContext);
  if (!data) throw new Error("DataProvider is missing.");
  return data;
}
