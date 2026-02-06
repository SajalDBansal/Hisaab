import * as c from "@repo/contracts/src/settlements";
import type { Client } from "./client";

export function settlementServices(client: Client) {
  return {
    list: () => client.pages("/settlements", c.SettlementRecord),
    get: (id: string) =>
      client.request(`/settlements/${id}`, c.SettlementRecord),
    context: (input: c.SettlementContextQuery) =>
      client.request(
        `/settlements/context?${new URLSearchParams(c.SettlementContextQuery.parse(input))}`,
        c.SettlementContext,
      ),
    create: (input: c.SettlementInput) =>
      client.request("/settlements", c.SettlementRecord, {
        body: c.SettlementInput.parse(input),
      }),
    reverse: (
      id: string,
      input: {
        date: string;
        bookScope: "gst" | "nongst";
        version: number;
        reason: string;
      },
    ) =>
      client.request(`/settlements/${id}/reverse`, c.SettlementRecord, {
        body: c.SettlementReverseInput.parse(input),
      }),
    interest: (input: c.LoanInterestInput) =>
      client.request("/settlements/loan-interest", c.SettlementRecord, {
        body: c.LoanInterestInput.parse(input),
      }),
    approveCredit: (input: c.CreditApprovalInput) =>
      client.request("/settlements/credit-approvals", c.CreditApproval, {
        body: c.CreditApprovalInput.parse(input),
      }),
    approveOrderCredit: (input: c.OrderCreditApprovalInput) =>
      client.request("/settlements/order-credit-approvals", c.CreditApproval, {
        body: c.OrderCreditApprovalInput.parse(input),
      }),
  };
}
export type SettlementService = ReturnType<typeof settlementServices>;
