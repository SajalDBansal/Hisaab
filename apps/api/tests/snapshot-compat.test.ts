import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { VoucherSnapshot } from "@repo/contracts";
import { blankBooks, captureVoucherSnapshot } from "@repo/core";

// Vouchers issued before migration 0031 froze invoice settings without
// `numbering`; their snapshots must still pass the API and backup contracts.
test("a voucher snapshot frozen before numbering rules still validates", () => {
  const books = blankBooks(
    {
      id: randomUUID(),
      name: "F",
      city: "Mathura",
      stateCode: "09",
      gstRegistration: "regular",
      gstin: "09AAAAA0000A1Z0",
    },
    "2026-10-26",
  );
  const snapshot = captureVoucherSnapshot(books, undefined, []);
  const { numbering: _numbering, ...oldSettings } = snapshot.settings;
  void _numbering;
  const result = VoucherSnapshot.safeParse({ ...snapshot, settings: oldSettings });
  assert.ok(result.success, JSON.stringify(result.error?.issues));
  assert.ok(VoucherSnapshot.safeParse(snapshot).success);
});
