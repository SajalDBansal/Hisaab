# 04. First Real Workflow

[Documentation index](README.md)

## Connected

Signed-in Expo sessions now use the API for firms, customers/suppliers, items,
units, cash/bank accounts, vouchers, Home, Reports, Accounts, GST, invoice
settings reads, printable vouchers, search and notifications. Demo services are
used only when `EXPO_PUBLIC_REQUIRE_LOGIN=false`, never as an error fallback.

The first login without a firm opens firm creation. The selected firm ID is saved
per user and checked against server membership on restart. Requests and query
keys are scoped to the user and firm; switching firms resets open forms.

### Response parity

| API                             | Added or verified                                                         |
| ------------------------------- | ------------------------------------------------------------------------- |
| `GET /v1/firms`                 | Full firm profile, role, party and voucher counts                         |
| `GET /v1/parties`               | Balance and overdue totals on each paginated row                          |
| `GET /v1/parties/:id`           | Bills, open bills, ageing, credit-limit warning and transactions          |
| `GET /v1/items/:id`             | Stock quantity/value, movements and profit                                |
| `GET /v1/ledgers/:id/statement` | Cash/bank movements and running balances                                  |
| `GET /v1/settings/invoice`      | Invoice settings and bank name; empty bank selection is valid             |
| Voucher detail and dashboard    | Typed invoice totals, conversion links and composition figures            |
| Lists                           | Native adapters follow pagination instead of silently stopping at 50 rows |

Existing flat master fields remain in detail responses. The adapter preserves
the service shapes already used by the screens. Edit forms submit the version
they opened with using `If-Match`; they do not fetch a newer version to overwrite
someone else's changes.

Supported financial and master saves use the durable outbox and original-operation
receipts described in [offline books](17-offline-books.md). Offline saves remain
pending until the server confirms them; retrying preserves the original request
and key. Online-only actions still require connectivity. Migration 0025 retains
their committed retry answers beyond the seven-day response cache; clients must
keep the original key. Reconcile an unknown result before submitting a new entry.

## Run And Check

1. Use a staging database for these sample entries. Apply pending migrations with
   `bun run --cwd apps/api db:migrate` after backing up and stopping writes.
2. Start the API: `bun run --cwd apps/api dev`.
3. Keep `EXPO_PUBLIC_REQUIRE_LOGIN=true`. The phone must use the computer's LAN
   address in `EXPO_PUBLIC_API_URL`, not `localhost`. Leave the URL empty to use
   Expo's LAN host detection, or update the existing override when your IP changes.
4. Restart Expo with a cleared bundle: `bun run --cwd apps/native start --clear`.
   Open Expo Go on the same Wi-Fi; allow Node/Bun through the private-network firewall.
5. Create a firm, customer and item with an opening quantity. Save an unpaid sale.
6. Open Receive Payment, choose that customer, enter the invoice amount, select
   Cash and allocate it to the sale. Cash uses the server's account ID.
7. Check Home, sales, outstanding, stock, cash statement and trial balance. Close
   and reopen the app, then restart the API and repeat the reads. The login and
   selected firm should remain, without duplicate vouchers or demo balances.

## Related Workflows

Use [document storage](15-document-storage.md), [offline books](17-offline-books.md),
[book controls](07-accounting-controls.md), [ledger workflows](06-ledger-workflows.md)
and [firm recovery](19-backup-recovery.md) for their configuration and limits.
The [module guide](03-backend-modules.md) links the remaining business guides.

After an uncertain save, reconcile its original result before submitting another
entry. Follow the operation receipt and pending-upload guidance for supported
retries. Manually check phone connectivity, restart and permissions on the
intended device before relying on the workflow for business use.
