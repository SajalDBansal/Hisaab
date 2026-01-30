import Redis from "ioredis";

export type RedisClient = Redis;

export function createRedis(url: string) {
  return new Redis(url, {
    connectTimeout: 1_000,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
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
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
}
