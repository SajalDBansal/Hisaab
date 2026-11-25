/**
 * Retail bill (doc 37, T02): a quick walk-in sale on one screen. Scan or pick
 * items, adjust quantity and rate (with GST included), choose how the customer
 * paid, save and print on the thermal roll. The server makes a normal sale in
 * the retail series (RI/26-27/0001) with the whole amount received now; GST,
 * stock (oldest first), postings and GSTR-1 work as for any sale.
 *
 * Online only (owner decision): without a connection the form says so and
 * does not save. The bill goes to "Cash customer"; the buyer's name and phone
 * are optional and only printed.
 */
import { usePriceLists } from "@/data/catalogHooks";
import { isVariantParent, priceListFor, priceListRate } from "@repo/core";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { newRequestId } from "@repo/contracts";
import {
  applyGstMode,
  calcInvoice,
  exclusiveRate,
  formatINR,
  formatQty,
  inclusiveRate,
  itemTaxType,
  parseRupees,
  roleFlag,
  today,
  billsCarryGst,
  type InvoiceLine,
  type Item,
  type SaleMarginInput,
} from "@repo/core";
import {
  Badge,
  Button,
  Card,
  FooterBar,
  Header,
  IconButton,
  Money,
  Notice,
  PickerSheet,
  Screen,
  Segmented,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useData } from "@/data/DataProvider";
import {
  useCreateRetailSale,
  useInvoiceSettings,
  useItems,
  useLedgers,
  useNextNumber,
  useSaleMargin,
  useStockLots,
} from "@/data/queries";
import { useDebounced } from "@/data/useDebounced";
import { useGstMode } from "@/data/gstMode";
import { useOfflineBooks } from "@/data/useOfflineBooks";
import { colors, space } from "@/theme";

type PaidBy = "cash" | "upi" | "card";

interface RetailLine {
  key: number;
  itemId: string;
  qty: string;
  /** Rupees, with GST included when the bill carries GST. */
  rate: string;
}

export function RetailForm() {
  const { role } = useData();
  const { online } = useOfflineBooks();
  const gst = useGstMode();
  const items = useItems();
  const ledgers = useLedgers();
  const settings = useInvoiceSettings();
  const date = today();
  const stock = useStockLots(date);
  const number = useNextNumber(
    "sale",
    gst.mode === "off" ? "nongst-retail" : "retail",
    date,
  );
  const create = useCreateRetailSale();

  const [lines, setLines] = useState<RetailLine[]>([]);
  const [scan, setScan] = useState("");
  const [scanError, setScanError] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [paidBy, setPaidBy] = useState<PaidBy>("cash");
  const [bankId, setBankId] = useState("");
  const [picker, setPicker] = useState<"item" | "bank" | null>(null);
  // One key per bill, so a retry after a lost reply never saves it twice.
  const [requestKey, setRequestKey] = useState(() =>
    newRequestId(Crypto.randomUUID()),
  );

  const carriesGst = billsCarryGst(gst.mode, "sale");
  const itemById = (id: string): Item | undefined =>
    items.data?.find((r) => r.item.id === id)?.item;
  const gstOf = (item: Item | undefined) =>
    carriesGst && item && itemTaxType(item) === "taxable" ? item.gstRate : 0;
  // Variant parents are never billed; their variants are (doc 37, T35).
  const sellable = (items.data ?? []).filter(
    (r) => !r.item.notForSale && !isVariantParent(r.item),
  );
  // The firm's default sale price list (doc 37, T36) prices walk-in bills too.
  const priceList = priceListFor(usePriceLists().data, undefined, "sale");
  const retailRate = (item: Item) => {
    const listed = priceListRate(priceList, item);
    return listed && !listed.unit ? listed.rate : item.salePrice;
  };

  const addItem = (item: Item) =>
    setLines((prev) => {
      const same = prev.find((l) => l.itemId === item.id);
      if (same)
        return prev.map((l) =>
          l === same ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l,
        );
      return [
        ...prev,
        {
          key: Date.now() + prev.length,
          itemId: item.id,
          qty: "1",
          rate: (inclusiveRate(retailRate(item), gstOf(item)) / 100).toFixed(2),
        },
      ];
    });
  const update = (key: number, patch: Partial<RetailLine>) =>
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );

  /** A barcode scanner types the item code and Enter; a name works too when only one matches. */
  const onScan = () => {
    const text = scan.trim().toLowerCase();
    if (!text) return;
    const byCode = sellable.find((r) => r.item.code?.toLowerCase() === text);
    const byName = sellable.filter((r) =>
      r.item.name.toLowerCase().includes(text),
    );
    const found = byCode ?? (byName.length === 1 ? byName[0] : undefined);
    if (found) {
      addItem(found.item);
      setScan("");
      setScanError("");
    } else
      setScanError(
        byName.length > 1
          ? "Several items match. Pick one from the list."
          : "No item has this code.",
      );
  };

  // An item in both books (GST and non-GST stock) sells from the GST book here;
  // the full sale form lets the user choose.
  const booksOf = (itemId: string) =>
    new Set(
      (stock.data ?? [])
        .filter((lot) => lot.itemId === itemId && lot.qty > 0)
        .map((lot) => lot.bookScope),
    );
  const invoiceLines: InvoiceLine[] = lines.flatMap((l) => {
    const item = itemById(l.itemId);
    const qty = Number(l.qty);
    const typed = parseRupees(l.rate) ?? 0;
    if (!item || !(qty > 0) || !(typed > 0)) return [];
    const gstRate = gstOf(item);
    return [
      {
        itemId: item.id,
        qty,
        rate: gstRate ? exclusiveRate(typed, gstRate) : typed,
        gstRate: gstRate as InvoiceLine["gstRate"],
        taxType: itemTaxType(item),
        ...(booksOf(item.id).size > 1 ? { bookScope: "gst" as const } : {}),
      },
    ];
  });
  const complete = lines.length > 0 && invoiceLines.length === lines.length;
  const totals = calcInvoice({
    lines: applyGstMode(invoiceLines, gst.mode, "sale"),
    charges: [],
    interState: false,
  });

  // Profit margin pill (doc 37, T12) for roles with the "see profit margin" right.
  const marginDraft: SaleMarginInput | null =
    roleFlag(role, "viewProfitMargin") && online && complete
      ? { date, lines: invoiceLines }
      : null;
  const marginWanted = marginDraft ? JSON.stringify(marginDraft) : "";
  const marginAsked = useDebounced(marginWanted, 500);
  const marginQuery = useSaleMargin(
    marginAsked ? (JSON.parse(marginAsked) as SaleMarginInput) : null,
  );
  const margin =
    marginWanted &&
    marginAsked === marginWanted &&
    marginQuery.isSuccess &&
    !marginQuery.isFetching
      ? marginQuery.data.total
      : undefined;

  const cashLedger = ledgers.data?.find(
    (r) => r.ledger.kind === "cash",
  )?.ledger;
  const banks = (ledgers.data ?? []).filter((r) => r.ledger.kind === "bank");
  const bank =
    banks.find((r) => r.ledger.id === bankId)?.ledger ??
    banks.find((r) => r.ledger.id === settings.data?.bankLedgerId)?.ledger ??
    banks[0]?.ledger;
  const ledger = paidBy === "cash" ? cashLedger : bank;

  const problem = !online
    ? "Retail bills need an internet connection."
    : !lines.length
      ? "Add at least one item."
      : !complete
        ? "Each item needs a quantity and a rate."
        : !ledger
          ? paidBy === "cash"
            ? "Add a cash account first."
            : "Add a bank account for UPI and card payments."
          : undefined;

  const save = async () => {
    if (problem || !ledger) return;
    try {
      const saved = await create.mutateAsync({
        requestKey,
        input: {
          date,
          lines: invoiceLines,
          buyer:
            buyerName.trim() || buyerPhone.trim()
              ? {
                  name: buyerName.trim() || undefined,
                  phone: buyerPhone.trim() || undefined,
                }
              : undefined,
          paidBy: { mode: paidBy, ledgerId: ledger.id },
        },
      });
      setRequestKey(newRequestId(Crypto.randomUUID()));
      router.replace(`/print/${saved[0]!.id}`);
    } catch (e) {
      showError("Couldn't save", e);
    }
  };

  return (
    <Screen
      header={
        <Header
          close
          title="Retail bill"
          subtitle={number.data ? `${number.data} · Cash customer` : undefined}
        />
      }
      footer={
        <FooterBar>
          <View style={{ flex: 1 }}>
            <Txt variant="caption" tone="body">
              {`Total · ${paidBy === "cash" ? "Cash" : paidBy === "upi" ? "UPI" : "Card"}`}
            </Txt>
            <Money value={totals.grandTotal} variant="heading" />
          </View>
          <Button
            label="Save & print"
            icon="printer"
            variant="primary"
            disabled={!!problem}
            loading={create.isPending}
            onPress={() => void save()}
          />
        </FooterBar>
      }
    >
      {!online ? (
        <Notice
          tone="warn"
          text="You are offline. Retail bills are saved only online; connect to make one."
        />
      ) : null}

      <View
        style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-end" }}
      >
        <View style={{ flex: 1 }}>
          <TextField
            label="Scan or type item code"
            value={scan}
            onChangeText={(t) => {
              setScan(t);
              setScanError("");
            }}
            onSubmitEditing={onScan}
            placeholder="Barcode, code or name, then Enter"
            autoCapitalize="none"
            error={scanError || undefined}
          />
        </View>
        <Button label="Items" icon="search" onPress={() => setPicker("item")} />
      </View>

      {lines.map((l) => {
        const item = itemById(l.itemId);
        const line = invoiceLines.find((x) => x.itemId === l.itemId);
        const amount = line
          ? calcInvoice({
              lines: applyGstMode([line], gst.mode, "sale"),
              charges: [],
              interState: false,
            }).lines[0]?.total
          : undefined;
        return (
          <Card key={l.key} variant="outline">
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{item?.name ?? "Item"}</Txt>
                <Txt variant="caption" tone="body">
                  {gstOf(item) ? `GST ${gstOf(item)}% included` : item?.unit}
                </Txt>
              </View>
              {amount !== undefined ? <Money value={amount} /> : null}
              <IconButton
                icon="trash-2"
                label={`Remove ${item?.name ?? "item"}`}
                onPress={() =>
                  setLines((prev) => prev.filter((x) => x.key !== l.key))
                }
              />
            </View>
            <View
              style={{
                flexDirection: "row",
                gap: space.sm,
                alignItems: "flex-end",
              }}
            >
              <IconButton
                icon="minus"
                label="One less"
                outlined
                onPress={() =>
                  update(l.key, {
                    qty: String(Math.max(1, (Number(l.qty) || 1) - 1)),
                  })
                }
              />
              <View style={{ flex: 1 }}>
                <TextField
                  label={`Qty (${item?.unit ?? ""})`}
                  value={l.qty}
                  keyboardType="decimal-pad"
                  onChangeText={(qty) => update(l.key, { qty })}
                />
              </View>
              <IconButton
                icon="plus"
                label="One more"
                outlined
                onPress={() =>
                  update(l.key, { qty: String((Number(l.qty) || 0) + 1) })
                }
              />
              <View style={{ flex: 1.3 }}>
                <TextField
                  label={carriesGst ? "Rate incl. GST ₹" : "Rate ₹"}
                  value={l.rate}
                  keyboardType="decimal-pad"
                  onChangeText={(rate) => update(l.key, { rate })}
                />
              </View>
            </View>
          </Card>
        );
      })}

      {lines.length ? (
        <Card variant="soft">
          {totals.tax ? (
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Txt tone="body">GST included</Txt>
              <Money value={totals.tax} tone="body" />
            </View>
          ) : null}
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <Txt variant="bodyStrong">Total</Txt>
            <Money value={totals.grandTotal} variant="bodyStrong" />
          </View>
          {margin && margin.margin !== null ? (
            <View style={{ flexDirection: "row" }}>
              <Badge
                tone={margin.margin < 0 ? "bad" : "ok"}
                label={`Margin ${formatINR(margin.margin)}${
                  margin.marginPercent === null
                    ? ""
                    : ` · ${margin.marginPercent}%`
                }`}
              />
            </View>
          ) : null}
        </Card>
      ) : (
        <Txt tone="body" center>
          Scan a barcode or pick items to start the bill.
        </Txt>
      )}

      <Txt variant="label" tone="body">
        Paid by
      </Txt>
      <Segmented
        value={paidBy}
        onChange={setPaidBy}
        options={[
          { value: "cash", label: "Cash" },
          { value: "upi", label: "UPI" },
          { value: "card", label: "Card" },
        ]}
      />
      {paidBy !== "cash" ? (
        <SelectField
          label="Deposit to"
          value={bank?.name}
          placeholder="Pick a bank account"
          onPress={() => setPicker("bank")}
        />
      ) : (
        <Txt variant="caption" tone="body">
          {cashLedger ? `Deposit to ${cashLedger.name}` : "No cash account"}
        </Txt>
      )}

      <Txt variant="label" tone="body">
        Customer (optional, printed on the bill)
      </Txt>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <TextField
            label="Name"
            value={buyerName}
            onChangeText={setBuyerName}
            maxLength={80}
            autoCapitalize="words"
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            label="Phone"
            value={buyerPhone}
            onChangeText={setBuyerPhone}
            keyboardType="phone-pad"
            maxLength={15}
          />
        </View>
      </View>
      {problem && lines.length ? (
        <Txt variant="caption" style={{ color: colors.give }}>
          {problem}
        </Txt>
      ) : null}

      <PickerSheet
        visible={picker === "item"}
        title="Add item"
        searchPlaceholder="Search name, code or HSN"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          const item = itemById(id);
          if (item) addItem(item);
          setPicker(null);
        }}
        options={sellable.map((r) => ({
          id: r.item.id,
          title: r.item.name,
          subtitle:
            r.item.kind === "service"
              ? "Service"
              : `${formatQty(r.item, r.qty)} in stock`,
          right: (
            <Money
              value={inclusiveRate(retailRate(r.item), gstOf(r.item))}
              variant="small"
            />
          ),
        }))}
      />
      <PickerSheet
        visible={picker === "bank"}
        title="Deposit to"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setBankId(id);
          setPicker(null);
        }}
        options={banks.map((r) => ({ id: r.ledger.id, title: r.ledger.name }))}
      />
    </Screen>
  );
}
