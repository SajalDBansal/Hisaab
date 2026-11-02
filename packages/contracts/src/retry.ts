import { z } from "zod";

const durableId = z.uuidv7();

// Updated clients use UUIDv7; older UUIDv4 requests may have lost their saved answer.
export const isDurableRequestId = (key: string) =>
  durableId.safeParse(key).success;

// Keep 74 random bits from the supplied UUID and add the UUIDv7 millisecond timestamp.
export function newRequestId(randomId: string, now = Date.now()) {
  const random = z.uuid().parse(randomId);
  const time = now.toString(16).padStart(12, "0");
  return durableId.parse(
    `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(15)}`,
  );
}
