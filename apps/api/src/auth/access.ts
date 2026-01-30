import { PERMISSIONS, ROLES, type Permission, type Role } from "@repo/core";
import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  ownerAc,
} from "better-auth/plugins/organization/access";

// One list of roles and permissions, the one in @repo/core, feeds both our own
// checks (`can(role, permission)`) and Better Auth's checks on members and invitations.
const statements = {
  ...defaultStatements,
  ...(Object.fromEntries(PERMISSIONS.map((p) => [p.key, ["use"]])) as Record<
    Permission,
    ["use"]
  >),
};

const ac = createAccessControl(statements);

const roleFor = (role: Role) => {
  const can = ROLES.find((r) => r.role === role)?.can ?? [];
  return ac.newRole({
    // Team permission = may invite, change roles and remove members
    ...(can.includes("team") ? ownerAc.statements : {}),
    ...Object.fromEntries(can.map((p) => [p, ["use"]])),
  } as Parameters<typeof ac.newRole>[0]);
};

const roles = {
  owner: roleFor("owner"),
  accountant: roleFor("accountant"),
  sales: roleFor("sales"),
  viewer: roleFor("viewer"),
};

export const firmAccess = { ac, roles };
