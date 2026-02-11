# @repo/contracts

One zod schema for every request and response of the Hisaab API. The server checks requests with them; the app uses the same ones in its forms, so the two can't disagree.

```ts
import { PartyInput, check } from "@repo/contracts";

const problems = check(PartyInput, form); // null, or { name: "Enter the party name.", phone: "..." }
```

## What is here

| File           | Schemas                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common.ts`    | `Id`, `Paise`, `IsoDate`, `Gstin`, `Phone`, `ApiError`, `PageQuery`, `pageOf()`, header schemas                                                       |
| `firms.ts`     | `Firm`, `NewFirmInput`, `FirmUpdate`                                                                                                                  |
| `parties.ts`   | `Party`, `PartyInput`                                                                                                                                 |
| `items.ts`     | `Item`, `ItemInput`, `Unit`, `NewUnitInput`                                                                                                           |
| `ledgers.ts`   | `Ledger`, `LedgerInput`                                                                                                                               |
| `vouchers.ts`  | `NewInvoiceInput`, `NewMoneyInput`, `NewExpenseInput`, `NewJournalInput`, `NewContraInput`, `NewOrderInput`, `NewNoteInput`, `CancelInput`, `Voucher` |
| `settings.ts`  | `InvoiceSettings`, `ReminderSettings`, `UserPreferences`                                                                                              |
| `documents.ts` | `NewDocumentInput`, `UploadRequest`, `StoredDocument`                                                                                                 |
| `audit.ts`     | `AuditEntry`                                                                                                                                          |

Keep report and GST reply schemas aligned with their endpoints.

## Rules

- **Shape rules live here** (required, formats, ranges, "debits equal credits"). **Rules that need other data stay in the server's service** (duplicate names, credit limit, whether a bill can still be edited).
- Messages are written for a shop owner and match the app's current form messages.
- Money is always whole paise; dates are `YYYY-MM-DD`.
- Keep schemas aligned with the matching types in `@repo/core` when changing contracts.
