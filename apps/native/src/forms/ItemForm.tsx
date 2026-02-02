/**
 * Add or edit an item: tax (HSN + GST rate, hidden when the firm has no GST), units, prices and stock.
 */
import { router } from "expo-router";
import { backOrReplace } from "@/navigation";
import { useMemo, useState } from "react";
import { BookScopeField, useBookScope } from "@/components/BookScopeField";
import { Switch, View } from "react-native";
import {
  checkItem,
  formatINR,
  itemWarnings,
  marginPercent,
  parseRupees,
  suggestItemCode,
  itemTaxType,
  TAX_TYPES,
  taxTypeLabel,
  type GstRate,
  type TaxType,
  type Item,
  type ItemInput,
} from "@repo/core";
import {
  AmountField,
  Button,
  Card,
  Checkbox,
  Chip,
  FooterBar,
  Header,
  Notice,
  Screen,
  TextField,
  Txt,
  showError,
} from "@/components";
import { toRupeeText } from "@/data/labels";
import { setPicked } from "@/data/picked";
import { useItems, useSaveItem, useUnits } from "@/data/queries";
import { AddUnitSheet } from "./AddUnitSheet";
import { useGstMode } from "@/data/gstMode";
import { colors, space } from "@/theme";
import { ItemInput as ItemInputSchema } from "@repo/contracts";
import {
  OpeningLotsEditor,
  openingLotDrafts,
  openingLotsInput,
} from "./OpeningLotsEditor";

const RATES: GstRate[] = [5, 18, 40];
const NEW_GROUP = "+ New group";

const digitsOnly = (t: string) => t.replace(/\D/g, "");

export function ItemForm({
  item,
  used,
  pick,
}: {
  /** Editing this item; leave out to add a new one. */
  item?: Item;
  /** The item is already on bills: its unit can't change. */
  used?: boolean;
  /** Opened from a sale/purchase picker: hand the new item back to it. */
  pick?: boolean;
}) {
  const items = useItems();
  const [version] = useState(item?.version);
  const save = useSaveItem(item?.id, version);
  const unitList = useUnits();
  const others = useMemo(
    () => (items.data ?? []).map((r) => r.item),
    [items.data],
  );
  const groups = useMemo(
    () => [...new Set(others.map((i) => i.group))].sort(),
    [others],
  );

  const gst = useGstMode();
  const [name, setName] = useState(item?.name ?? "");
  const [code, setCode] = useState(item?.code ?? "");
  const [group, setGroup] = useState(item?.group ?? "");
  const [newGroup, setNewGroup] = useState(false);
  const [hsn, setHsn] = useState(item?.hsn ?? "");
  const [taxType, setTaxType] = useState<TaxType>(
    item ? itemTaxType(item) : "taxable",
  );
  /** The "GST applies" box: ticked for taxable and nil-rated (0%) goods. */
  const gstOnFor = (t: TaxType) => t === "taxable" || t === "nil";
  const [gstRate, setGstRate] = useState<GstRate>(
    item && item.gstRate > 0 ? item.gstRate : 18,
  );
  const gstOn = gstOnFor(taxType);
  const [unit, setUnit] = useState(item?.unit ?? "Nos");
  const [hasAlt, setHasAlt] = useState(!!item?.altUnit);
  // Which picker the "+ New unit" sheet should fill when a unit is added
  const [addingUnit, setAddingUnit] = useState<"main" | "alt" | null>(null);
  const [altName, setAltName] = useState(item?.altUnit?.name ?? "Box");
  // Switched-on units, plus whatever this item already uses (even if switched off since)
  const unitNames = useMemo(() => {
    const on = (unitList.data ?? [])
      .filter((u) => u.enabled)
      .map((u) => u.name);
    return [...new Set([...on, ...(item ? [item.unit] : [])])];
  }, [unitList.data, item]);
  const altChoices = useMemo(
    () =>
      [
        ...new Set([
          ...unitNames,
          ...(item?.altUnit ? [item.altUnit.name] : []),
        ]),
      ].filter((u) => u !== unit),
    [unitNames, unit, item],
  );
  const [altFactor, setAltFactor] = useState(
    String(item?.altUnit?.factor ?? 12),
  );
  const [purchaseText, setPurchaseText] = useState(
    toRupeeText(item?.purchasePrice ?? 0),
  );
  const [saleText, setSaleText] = useState(toRupeeText(item?.salePrice ?? 0));
  const [mrpText, setMrpText] = useState(toRupeeText(item?.mrp ?? 0));
  const [opening, setOpening] = useState(String(item?.openingStock ?? ""));
  const [separateLots, setSeparateLots] = useState(!!item?.openingLots);
  const [openingLots, setOpeningLots] = useState(() =>
    openingLotDrafts(item?.openingLots),
  );
  const [openingBookScope, setOpeningBookScope] = useBookScope();
  const [openingCost, setOpeningCost] = useState(
    toRupeeText(item?.openingCost ?? item?.purchasePrice ?? 0),
  );
  const [reorder, setReorder] = useState(String(item?.reorderLevel ?? ""));
  const [showErrors, setShowErrors] = useState(false);

  const suggestedCode = suggestItemCode(
    name || "Item",
    others.filter((o) => o.id !== item?.id),
  );
  const input: ItemInput = {
    name,
    code: code || suggestedCode,
    group: group || "General",
    hsn,
    taxType,
    gstRate: taxType === "taxable" ? gstRate : 0,
    unit,
    altUnit: hasAlt
      ? { name: altName, factor: Number(altFactor || "0") }
      : undefined,
    purchasePrice: parseRupees(purchaseText) ?? 0,
    salePrice: parseRupees(saleText) ?? 0,
    mrp: parseRupees(mrpText) ?? 0,
    openingStock: separateLots
      ? openingLotsInput(openingLots).reduce((sum, lot) => sum + lot.qty, 0)
      : Number(opening || "0"),
    openingLots: separateLots ? openingLotsInput(openingLots) : undefined,
    openingCost: parseRupees(openingCost) ?? 0,
    openingBookScope: item?.openingBookScope ?? openingBookScope,
    reorderLevel: Number(reorder || "0"),
    ...(item?.batch ? { batch: item.batch } : {}),
  };
  const errors = checkItem(input, others, item?.id, gst.mode);
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : undefined);
  const contract = ItemInputSchema.safeParse(input);
  const firstError =
    Object.values(errors)[0] ??
    (!contract.success ? contract.error.issues[0]?.message : undefined);
  const warnings = itemWarnings(input);
  const margin = marginPercent(input.purchasePrice, input.salePrice);

  const submit = async () => {
    setShowErrors(true);
    if (firstError) return;
    try {
      const saved = await save.mutateAsync(input);
      if (pick) setPicked("item", saved.id);
      if (item || pick) backOrReplace(router, `/item/${saved.id}`);
      else router.replace(`/item/${saved.id}`);
    } catch (e) {
      showError("Couldn't save", e);
    }
  };

  return (
    <Screen
      header={
        <Header
          close
          title={item ? "Edit item" : "New item"}
          subtitle={item?.name ?? "Goods you buy and sell"}
        />
      }
      footer={
        <FooterBar>
          <View style={{ flex: 1 }}>
            <Txt variant="small" num>
              {input.salePrice
                ? `${formatINR(input.salePrice)} / ${unit}${
                    !gst.regular
                      ? ""
                      : taxType === "taxable"
                        ? ` + ${gstRate}% GST`
                        : ` · ${taxTypeLabel(taxType)}`
                  }`
                : "Enter a sale price"}
            </Txt>
            <Txt
              variant="caption"
              tone={showErrors && firstError ? "give" : "body"}
              numberOfLines={2}
            >
              {showErrors && firstError
                ? firstError
                : margin !== null
                  ? `Margin ${margin}%`
                  : " "}
            </Txt>
          </View>
          <Button
            label={item ? "Save changes" : "Save item"}
            variant="primary"
            onPress={submit}
            loading={save.isPending}
          />
        </FooterBar>
      }
    >
      <TextField
        label="Item name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Tata Tea Gold 500 g"
        error={err("name")}
      />
      <View style={{ flexDirection: "row", gap: space.md }}>
        <TextField
          label="Code"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder={name.trim() ? suggestedCode : "Auto from name"}
          mono
          error={err("code")}
        />
        {gst.on ? (
          <TextField
            label={
              taxType === "nongst" || !gst.regular
                ? "HSN (optional)"
                : "HSN code"
            }
            value={hsn}
            onChangeText={(t) => setHsn(digitsOnly(t).slice(0, 8))}
            keyboardType="number-pad"
            placeholder={taxType === "nongst" ? "Not needed" : "4–8 digits"}
            mono
            error={err("hsn")}
          />
        ) : null}
      </View>

      <View style={{ gap: space.sm }}>
        <Txt variant="label" tone="charcoal">
          Group
        </Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {[...groups, NEW_GROUP].map((g) => (
            <Chip
              key={g}
              label={g}
              selected={g === NEW_GROUP ? newGroup : !newGroup && group === g}
              onPress={() => {
                if (g === NEW_GROUP) {
                  setNewGroup(true);
                  setGroup("");
                } else {
                  setNewGroup(false);
                  setGroup(g);
                }
              }}
            />
          ))}
        </View>
        {newGroup ? (
          <TextField
            label="New group name"
            value={group}
            onChangeText={setGroup}
            placeholder="e.g. Snacks"
          />
        ) : null}
      </View>

      {gst.on ? (
        <Card style={{ gap: space.sm }}>
          {gst.composition ? (
            <Txt variant="caption" tone="body">
              Composition firm: you don't charge GST to customers. The rate
              below is what your supplier charges you; it becomes part of your
              cost.
            </Txt>
          ) : null}
          <Checkbox
            label="GST applies to this item"
            checked={gstOn}
            onChange={(on) =>
              setTaxType(on ? (gstRate ? "taxable" : "nil") : "exempt")
            }
          />
          {gstOn ? (
            <>
              <Txt variant="label" tone="charcoal">
                GST slab
              </Txt>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                }}
              >
                <Chip
                  label="0% (nil-rated)"
                  selected={taxType === "nil"}
                  onPress={() => setTaxType("nil")}
                />
                {RATES.map((r) => (
                  <Chip
                    key={r}
                    label={`${r}%`}
                    selected={taxType === "taxable" && gstRate === r}
                    onPress={() => {
                      setTaxType("taxable");
                      setGstRate(r);
                    }}
                  />
                ))}
              </View>
            </>
          ) : (
            <>
              <Txt variant="label" tone="charcoal">
                Why no GST?
              </Txt>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                }}
              >
                {TAX_TYPES.filter(
                  (t) => t.value === "exempt" || t.value === "nongst",
                ).map((t) => (
                  <Chip
                    key={t.value}
                    label={t.label}
                    selected={taxType === t.value}
                    onPress={() => setTaxType(t.value)}
                  />
                ))}
              </View>
            </>
          )}
          <Txt variant="caption" tone="body">
            {TAX_TYPES.find((t) => t.value === taxType)?.note}
          </Txt>
          {err("gstRate") ? (
            <Txt variant="caption" tone="give">
              {err("gstRate")}
            </Txt>
          ) : null}
        </Card>
      ) : null}

      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "baseline" }}>
          <Txt variant="bodyStrong" style={{ flex: 1 }}>
            Unit
          </Txt>
          <Txt
            variant="small"
            tone="body"
            accessibilityRole="link"
            onPress={() => router.push("/settings/units")}
          >
            Manage units
          </Txt>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {unitNames.map((u) => (
            <Chip
              key={u}
              label={u}
              selected={unit === u}
              onPress={() => (used ? undefined : setUnit(u))}
            />
          ))}
          {used ? null : (
            <Chip label="+ New unit" onPress={() => setAddingUnit("main")} />
          )}
        </View>
        {used ? (
          <Txt variant="caption" tone="body">
            Locked: this item is already on bills, so its unit can't change.
          </Txt>
        ) : null}
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
        >
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">Also sold in a bigger unit</Txt>
            <Txt variant="caption" tone="body">
              e.g. 1 Box = 12 {unit}. Stock still counts in {unit}.
            </Txt>
          </View>
          <Switch
            value={hasAlt}
            onValueChange={(on) => {
              setHasAlt(on);
              if (on && (!altName || altName === unit))
                setAltName(altChoices[0] ?? "");
            }}
            accessibilityLabel="Second unit"
            trackColor={{ true: colors.ink, false: colors.hairlineStrong }}
            thumbColor={colors.canvas}
            {...({ activeThumbColor: colors.canvas } as object)}
          />
        </View>
        {hasAlt ? (
          <View style={{ gap: space.sm }}>
            <Txt variant="label" tone="charcoal">
              Second unit
            </Txt>
            <View
              style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
            >
              {altChoices.map((u) => (
                <Chip
                  key={u}
                  label={u}
                  selected={altName === u}
                  onPress={() => setAltName(u)}
                />
              ))}
              <Chip label="+ New unit" onPress={() => setAddingUnit("alt")} />
            </View>
            <View style={{ flexDirection: "row" }}>
              <TextField
                label={`${unit} in 1 ${altName || "unit"}`}
                value={altFactor}
                onChangeText={(t) => setAltFactor(digitsOnly(t).slice(0, 4))}
                keyboardType="number-pad"
              />
            </View>
            {err("altUnit") ? (
              <Txt variant="caption" tone="give">
                {err("altUnit")}
              </Txt>
            ) : null}
          </View>
        ) : null}
      </Card>

      <Card style={{ gap: space.md }}>
        <Txt variant="bodyStrong">
          Prices per {unit}
          {gst.regular ? " (before GST)" : ""}
        </Txt>
        <View style={{ flexDirection: "row", gap: space.md }}>
          <AmountField
            label="Purchase ₹"
            value={purchaseText}
            onChangeText={setPurchaseText}
            error={err("purchasePrice")}
          />
          <AmountField
            label="Sale ₹"
            value={saleText}
            onChangeText={setSaleText}
            error={err("salePrice")}
          />
        </View>
        <View style={{ flexDirection: "row", gap: space.md }}>
          <AmountField
            label="MRP ₹ (optional)"
            value={mrpText}
            onChangeText={setMrpText}
            error={err("mrp")}
          />
          <View
            style={{ flex: 1, justifyContent: "flex-end", paddingBottom: 12 }}
          >
            {margin !== null ? (
              <Txt variant="small" tone={margin < 0 ? "give" : "body"} num>
                {formatINR(input.salePrice - input.purchasePrice)} per {unit} ·{" "}
                {margin}%
              </Txt>
            ) : null}
          </View>
        </View>
      </Card>

      <Card style={{ gap: space.md }}>
        <Txt variant="bodyStrong">Stock</Txt>
        {!used && !item?.openingLots ? (
          <Checkbox
            label="Separate opening stock lots"
            checked={separateLots}
            onChange={setSeparateLots}
          />
        ) : null}
        {separateLots ? (
          <OpeningLotsEditor
            rows={openingLots}
            onChange={setOpeningLots}
            disabled={used}
          />
        ) : (
          <>
            {!item ? (
              <BookScopeField
                value={openingBookScope}
                onChange={setOpeningBookScope}
              />
            ) : null}
            <AmountField
              label="Opening cost per unit"
              value={openingCost}
              onChangeText={setOpeningCost}
              editable={!used}
            />
          </>
        )}
        <View style={{ flexDirection: "row", gap: space.md }}>
          <TextField
            label={`Opening stock (${unit})`}
            editable={!used && !separateLots}
            value={separateLots ? String(input.openingStock) : opening}
            onChangeText={(t) => setOpening(digitsOnly(t))}
            keyboardType="number-pad"
            placeholder="0"
            error={err("openingStock")}
          />
          <TextField
            label={`Warn below (${unit})`}
            value={reorder}
            onChangeText={(t) => setReorder(digitsOnly(t))}
            keyboardType="number-pad"
            placeholder="0"
            error={err("reorderLevel")}
          />
        </View>
        {item && used ? (
          <Txt variant="caption" tone="body">
            Opening stock is locked because this item has entries.
          </Txt>
        ) : null}
      </Card>

      {warnings.map((w) => (
        <Notice key={w} text={w} />
      ))}
      <AddUnitSheet
        visible={addingUnit !== null}
        onClose={() => setAddingUnit(null)}
        onAdded={(u) =>
          addingUnit === "alt" ? setAltName(u.name) : setUnit(u.name)
        }
      />
    </Screen>
  );
}
