import Redis from "ioredis";

export type RedisClient = Redis;

export function createRedis(url: string, timeoutMs = 2_000) {
  return new Redis(url, {
    connectTimeout: 1_000,
    commandTimeout: timeoutMs,
    // Close blackholed sockets so the next connection can serve requests.
    socketTimeout: timeoutMs,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    // A timed-out mutation may already have run; do not replay it implicitly.
    autoResendUnfulfilledCommands: false,
  });
}

export function createJobRedis(url: string) {
  return new Redis(url, {
    connectTimeout: 1_000,
    maxRetriesPerRequest: null,
  });
}

// HTTP producers must not wait indefinitely for a disconnected job broker.
export function createQueueRedis(url: string) {
  return new Redis(url, {
    connectTimeout: 1_000,
    commandTimeout: 5_000,
    socketTimeout: 5_000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
}
