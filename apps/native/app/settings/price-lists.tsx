import { useState } from "react";
import { View } from "react-native";
import {
  can,
  canSeeCosts,
  formatINR,
  parsePriceListCsv,
  parseRupees,
  priceListSummary,
  type PriceList,
  type PriceListMode,
  type PriceListRate,
  type PriceListSide,
} from "@repo/core";
import {
  Button,
  Checkbox,
  Chip,
  ChipRow,
  Header,
  IconButton,
  ListRow,
  Notice,
  PickerSheet,
  QueryView,
  Screen,
  TextField,
  Txt,
  showError,
} from "@/components";
import { usePriceLists, useSavePriceList } from "@/data/catalogHooks";
import { useData } from "@/data/DataProvider";
import { pickImportFile } from "@/data/importFiles";
import { useItems } from "@/data/queries";
import { space } from "@/theme";

/** Price lists (doc 37, T36): sale and purchase rates by party. */
export default function PriceListsScreen() {
  const query = usePriceLists();
  const { role } = useData();
  const canEdit = !!role && can(role, "settings");
  const [editing, setEditing] = useState<{ row?: PriceList } | undefined>();
  return (
    <Screen
      header={
        <Header
          close
          title="Price lists"
          subtitle="Rates by customer or supplier"
        />
      }
    >
      {editing ? (
        <PriceListEditor
          key={editing.row?.id ?? "new"}
          original={editing.row}
          done={() => setEditing(undefined)}
        />
      ) : null}
      <QueryView query={query}>
        {(lists) => (
          <View style={{ gap: space.sm }}>
            {lists.length === 0 ? (
              <Txt tone="body">No price lists yet.</Txt>
            ) : null}
            {lists.map((row, i) => (
              <ListRow
                key={row.id}
                title={`${row.name} · ${row.side === "sale" ? "Sale" : "Purchase"}`}
                subtitle={priceListSummary(row)}
                last={i === lists.length - 1}
                chevron={canEdit}
                onPress={canEdit ? () => setEditing({ row }) : undefined}
              />
            ))}
            {canEdit && !editing ? (
              <Button
                label="Add a price list"
                icon="plus"
                size="sm"
                onPress={() => setEditing({})}
              />
            ) : null}
            <Txt variant="caption" tone="body">
              Assign a list to a customer or supplier on their page, or make one
              the default for its side. A new line on a bill starts at the
              party&apos;s list rate, else the item&apos;s own price; the last
              rate for the party is still shown on each line. Per-item lists can
              be filled from a CSV: item code or name, rate in rupees, and
              optionally the unit.
            </Txt>
          </View>
        )}
      </QueryView>
    </Screen>
  );
}

function PriceListEditor({
  original,
  done,
}: {
  original?: PriceList;
  done: () => void;
}) {
  const { role } = useData();
  const items = useItems();
  const save = useSavePriceList();
  const [name, setName] = useState(original?.name ?? "");
  const [side, setSide] = useState<PriceListSide>(original?.side ?? "sale");
  const [mode, setMode] = useState<PriceListMode>(original?.mode ?? "percent");
  const [percentText, setPercentText] = useState(
    original?.percent !== undefined ? String(original.percent) : "",
  );
  const [rates, setRates] = useState<PriceListRate[]>(original?.rates ?? []);
  const [isDefault, setIsDefault] = useState(original?.isDefault ?? false);
  const [active, setActive] = useState(original?.active ?? true);
  const [csv, setCsv] = useState("");
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const allItems = (items.data ?? []).map((r) => r.item);
  const itemOf = (id: string) => allItems.find((i) => i.id === id);

  const importCsv = (text: string) => {
    const result = parsePriceListCsv(text, allItems);
    setCsvErrors(result.errors);
    if (result.errors.length) return;
    // Imported rates replace the same item and unit; others stay.
    setRates((prev) => [
      ...prev.filter(
        (r) =>
          !result.rates.some(
            (n) => n.itemId === r.itemId && (n.unit ?? "") === (r.unit ?? ""),
          ),
      ),
      ...result.rates,
    ]);
    setCsv("");
  };

  const submit = async () => {
    try {
      await save.mutateAsync({
        input: {
          name: name.trim(),
          side,
          mode,
          ...(mode === "percent" ? { percent: Number(percentText) || 0 } : {}),
          rates: mode === "rates" ? rates : [],
          isDefault,
          active,
        },
        id: original?.id,
        version: original?.version,
      });
      done();
    } catch (error) {
      showError("Couldn't save the price list", error);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Txt variant="heading">
        {original ? `Edit ${original.name}` : "New price list"}
      </Txt>
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        maxLength={60}
        placeholder="e.g. Wholesale"
      />
      {original ? (
        <Txt tone="body">
          {side === "sale" ? "Sale" : "Purchase"} list (the side can&apos;t
          change)
        </Txt>
      ) : (
        <ChipRow>
          <Chip
            label="Sale"
            selected={side === "sale"}
            onPress={() => setSide("sale")}
          />
          {canSeeCosts(role) ? (
            <Chip
              label="Purchase"
              selected={side === "purchase"}
              onPress={() => setSide("purchase")}
            />
          ) : null}
        </ChipRow>
      )}
      <ChipRow>
        <Chip
          label="% of item price"
          selected={mode === "percent"}
          onPress={() => setMode("percent")}
        />
        <Chip
          label="Rate per item"
          selected={mode === "rates"}
          onPress={() => setMode("rates")}
        />
      </ChipRow>
      {mode === "percent" ? (
        <TextField
          label={`Markup % on the ${side} price (minus for a discount)`}
          value={percentText}
          onChangeText={(t) => setPercentText(t.replace(/[^\d.-]/g, ""))}
          keyboardType="numbers-and-punctuation"
          placeholder="e.g. -5"
        />
      ) : (
        <View style={{ gap: space.sm }}>
          <Txt variant="bodyStrong">Items · {rates.length}</Txt>
          {rates.map((r, i) => {
            const item = itemOf(r.itemId);
            return (
              <View
                key={`${r.itemId}:${r.unit ?? ""}`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Txt numberOfLines={1}>{item?.name ?? "Removed item"}</Txt>
                  <Txt variant="caption" tone="body">
                    per {r.unit ?? item?.unit ?? ""} · item price{" "}
                    {item
                      ? formatINR(
                          side === "sale" ? item.salePrice : item.purchasePrice,
                        )
                      : "—"}
                  </Txt>
                </View>
                <View style={{ width: 110 }}>
                  <TextField
                    label="Rate ₹"
                    value={(r.rate / 100).toFixed(2)}
                    onChangeText={(t) =>
                      setRates((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, rate: parseRupees(t) ?? 0 } : x,
                        ),
                      )
                    }
                    keyboardType="decimal-pad"
                  />
                </View>
                <IconButton
                  icon="trash-2"
                  label={`Remove ${item?.name ?? "item"}`}
                  onPress={() =>
                    setRates((prev) => prev.filter((_, j) => j !== i))
                  }
                />
              </View>
            );
          })}
          <Button
            label="Add item"
            icon="plus"
            size="sm"
            onPress={() => setPicker(true)}
          />
          <TextField
            label="Import from CSV (code or name, rate, unit)"
            value={csv}
            onChangeText={setCsv}
            multiline
            placeholder={"OIL1, 120.50\nSOAP, 1500, Box"}
          />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button
              label="Import pasted rows"
              size="sm"
              disabled={!csv.trim()}
              onPress={() => importCsv(csv)}
            />
            <Button
              label="Choose CSV file"
              icon="upload"
              size="sm"
              onPress={async () => {
                try {
                  const file = await pickImportFile();
                  if (file) importCsv(file.text);
                } catch (e) {
                  showError("Couldn't read the file", e);
                }
              }}
            />
          </View>
          {csvErrors.length ? (
            <Notice
              text={`Nothing imported. ${csvErrors.slice(0, 5).join(" ")}${
                csvErrors.length > 5
                  ? ` …and ${csvErrors.length - 5} more.`
                  : ""
              }`}
            />
          ) : null}
        </View>
      )}
      <Checkbox
        label={`Default for ${side === "sale" ? "customers" : "suppliers"}`}
        note="Used for parties that have no list of their own."
        checked={isDefault}
        onChange={setIsDefault}
      />
      <Checkbox
        label="Active"
        note="Switched off: bills use the item prices again."
        checked={active}
        onChange={setActive}
      />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button
          label="Save"
          icon="check"
          variant="primary"
          loading={save.isPending}
          onPress={() => void submit()}
        />
        <Button label="Cancel" onPress={done} />
      </View>
      <PickerSheet
        visible={picker}
        title="Add item"
        searchPlaceholder="Search name or code"
        onClose={() => setPicker(false)}
        onSelect={(id) => {
          const item = itemOf(id);
          if (item && !rates.some((r) => r.itemId === id && !r.unit))
            setRates((prev) => [
              ...prev,
              {
                itemId: id,
                rate: side === "sale" ? item.salePrice : item.purchasePrice,
              },
            ]);
          setPicker(false);
        }}
        options={allItems.map((i) => ({
          id: i.id,
          title: i.name,
          subtitle: i.code || undefined,
        }))}
      />
    </View>
  );
}
