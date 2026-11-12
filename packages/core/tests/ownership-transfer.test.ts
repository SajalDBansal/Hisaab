import { describe, expect, test } from "bun:test";
import { buildSeed } from "../src/mock/seed";
import { transferOwnership } from "../src/mock/db";

describe("handing over the firm", () => {
  test("the new owner is the only owner; the old owner takes the chosen role", () => {
    const db = buildSeed();
    transferOwnership(db, {
      memberId: "u2",
      previousOwnerRole: "sales",
      confirmName: ` ${db.firm.name.toUpperCase()} `,
    });
    expect(db.team.filter((m) => m.role === "owner").map((m) => m.id)).toEqual([
      "u2",
    ]);
    expect(db.team.find((m) => m.id === "u1")?.role).toBe("sales");
  });

  test("refuses a wrong firm name, an inactive member or oneself", () => {
    const db = buildSeed();
    const name = db.firm.name;
    const go =
      (memberId: string, confirmName = name) =>
      () =>
        transferOwnership(db, {
          memberId,
          previousOwnerRole: "accountant",
          confirmName,
        });
    expect(go("u2", "Another firm")).toThrow("firm name");
    expect(go("u4")).toThrow("not found");
    expect(go("u1")).toThrow("another team member");
    expect(db.team.find((m) => m.id === "u1")?.role).toBe("owner");
  });

  test("only the owner can hand over the firm", () => {
    const db = buildSeed();
    db.currentUserId = "u3";
    expect(() =>
      transferOwnership(db, {
        memberId: "u2",
        previousOwnerRole: "accountant",
        confirmName: db.firm.name,
      }),
    ).toThrow("Only the owner");
  });
});
