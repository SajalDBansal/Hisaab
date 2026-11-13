import { statementAsPage, type PageQuery } from "../paging";
import {
  ledgerBalance,
  ledgerStatement,
  type LedgerStatement,
} from "../accounting/reports";
import type { Ledger, Paise, TaxScope } from "../types";
import { scopeBooks } from "../accounting/bookScope";
import { clone, delay, getDb } from "./client";
import { newId } from "../mock/db";

export interface LedgerWithBalance {
  ledger: Ledger;
  balance: Paise;
}

export const ledgerService = {
  async create(input: Omit<Ledger, "id">): Promise<Ledger> {
    await delay();
    const db = getDb();
    if (
      db.ledgers.some(
        (l) => l.name.toLowerCase() === input.name.trim().toLowerCase(),
      )
    )
      throw new Error("An account with this name already exists.");
    const ledger = { ...input, id: newId("ledger"), name: input.name.trim() };
    db.ledgers.push(ledger);
    return clone(ledger);
  },
  /** Cash and bank accounts with current balances. Real API: http.get("/ledgers?kind=cash,bank") */
  async listCashAndBank(): Promise<LedgerWithBalance[]> {
    await delay();
    const { ledgers, vouchers } = getDb();
    return clone(
      ledgers.map((ledger) => ({
        ledger,
        balance: ledgerBalance(ledger, vouchers),
      })),
    );
  },

  /** Cash book or bank book. Real API: http.get<LedgerStatement & { ledger: Ledger }>(`/ledgers/${id}/statement`) */
  async statement(
    id: string,
    tax: TaxScope = "all",
  ): Promise<LedgerStatement & { ledger: Ledger }> {
    await delay();
    const { ledgers, vouchers, parties } = scopeBooks(getDb(), tax);
    const ledger = ledgers.find((l) => l.id === id);
    if (!ledger) throw new Error("Account not found");
    return clone({ ledger, ...ledgerStatement(ledger, vouchers, parties) });
  },

  /** A page of a cash or bank book. Real API: `/ledgers/${id}/statement?limit&cursor` */
  async statementPage(id: string, tax: TaxScope, query: PageQuery) {
    return statementAsPage(await this.statement(id, tax), query);
  },
};
