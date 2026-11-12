import { z } from "zod";
import { Id } from "./common";
import { Role } from "./firms";

// The live connection carries notices, never book data or writes: the app
// refetches through the normal routes, where roles and redaction apply.

/** Ask the API for a one-time pass to the live service, for the open firm. */
export const LiveTicket = z.discriminatedUnion("enabled", [
  z.object({
    enabled: z.literal(true),
    ticket: z.string(),
    /** wss:// address of the live service. */
    url: z.string(),
    expiresAt: z.string(),
  }),
  z.object({ enabled: z.literal(false) }),
]);

export const LivePlatform = z.enum(["app", "web"]);

/** Messages the app sends. The first one must be `hello`. */
export const LiveClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    ticket: z.string().min(1).max(2048),
    platform: LivePlatform,
    device: z.string().trim().max(80).optional(),
  }),
]);

/** Messages the live service sends. */
export const LiveServerMessage = z.discriminatedUnion("type", [
  /** Connected. `version` is the firm's data version right now. */
  z.object({
    type: z.literal("ready"),
    firmId: Id,
    version: z.string(),
    beatMs: z.number().int().positive(),
  }),
  /** Something in the firm's books changed; refetch what is on screen. */
  z.object({ type: z.literal("changed"), version: z.string() }),
  /** Notices may have been missed; refetch everything. */
  z.object({ type: z.literal("resync") }),
  /** Someone came online or went offline (sent to roles that manage the team). */
  z.object({ type: z.literal("presence") }),
  /** This person's firms or roles changed; reload the firm list. */
  z.object({ type: z.literal("access") }),
  /** Keeps idle connections open and lets the app notice a dead one. */
  z.object({ type: z.literal("beat") }),
]);

/** Why the live service closed a connection. The app reacts to each. */
export const LIVE_CLOSE = {
  /** Server restarting or shutting down: reconnect soon. */
  restart: 1012,
  /** Session ended, ticket bad or expired: get a new ticket (or sign in again). */
  unauthorized: 4401,
  /** No longer a member of this firm, or the role changed: reload firms first. */
  accessChanged: 4403,
  /** Too many open connections for this person. */
  tooMany: 4429,
  /** The app broke the protocol. */
  invalid: 4400,
} as const;

/** One device that has the app open. */
export const LiveDevice = z.object({
  platform: LivePlatform,
  device: z.string(),
  since: z.string(),
});

/** Who is in the firm, who is online now and when each was last active. */
export const FirmPresence = z.object({
  members: z.array(
    z.object({
      memberId: Id,
      userId: Id,
      name: z.string(),
      role: Role,
      online: z.boolean(),
      devices: z.array(LiveDevice),
      lastActiveAt: z.string().nullable(),
    }),
  ),
});

export type LiveTicket = z.infer<typeof LiveTicket>;
export type LiveClientMessage = z.infer<typeof LiveClientMessage>;
export type LiveServerMessage = z.infer<typeof LiveServerMessage>;
export type LiveDevice = z.infer<typeof LiveDevice>;
export type FirmPresence = z.infer<typeof FirmPresence>;
