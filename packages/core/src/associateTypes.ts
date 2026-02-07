import type { ID, ISODate } from "./types";

/** Issued names and rule details remain unchanged when an associate profile is edited. */
export interface DeliverySnapshot {
  associateId: ID;
  reference: string;
  name: string;
  vehicle: string;
  phone?: string;
  printPhone: boolean;
  profileVersion: number;
}
export interface CommissionSnapshot {
  associateId: ID;
  name: string;
  ruleVersion: number;
  payableAccountId: ID;
  rate: number;
  effectiveFrom: ISODate;
  itemIds: ID[];
  groups: string[];
}
