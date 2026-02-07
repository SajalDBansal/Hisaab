import type { ReactNode } from "react";
import { EmptyState } from "@/components";
import { useAssociateAccess } from "@/data/associateHooks";

export function AssociateGate({ children }: { children: ReactNode }) {
  const access = useAssociateAccess();
  if (!access.write)
    return (
      <EmptyState title="Only owners and accountants can access associates" />
    );
  if (!access.connected)
    return <EmptyState title="Sign in to a connected firm" />;
  return children;
}
