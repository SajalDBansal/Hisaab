import { router } from "expo-router";
import { backOrReplace } from "@/navigation";
import { useState } from "react";
import { Image, Pressable, Switch, View } from "react-native";
import { pickBrandingImage } from "@/documents/brandingImage";
import {
  DEFAULT_NUMBERING,
  financialYear,
  formatVoucherNumber,
  today,
  type InvoiceSettingsView,
  type InvoiceTemplate,
  type NumberingRule,
  type VoucherType,
} from "@repo/core";
import {
  Button,
  Card,
  FooterBar,
  Header,
  PickerSheet,
  QueryView,
  Screen,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { voucherTypeLabel } from "@/data/labels";
import {
  useBranding,
  useInvoiceSettings,
  useSaveBranding,
  useLedgers,
  useUpdateInvoiceSettings,
} from "@/data/queries";
import { colors, radius, space } from "@/theme";

const TEMPLATES: { value: InvoiceTemplate; label: string; note: string }[] = [
  { value: "classic", label: "Classic", note: "Boxed table, Tally style" },
  { value: "modern", label: "Modern", note: "Clean, lots of space" },
  { value: "compact", label: "Compact", note: "Fits thermal printers" },
];
const TYPES: VoucherType[] = [
  "sale",
  "purchase",
  "receipt",
  "payment",
  "expense",
  "journal",
  "credit-note",
  "debit-note",
  "contra",
  "estimate",
  "sales-order",
  "delivery-note",
  "purchase-order",
];

/** Invoice look, terms, bank details and voucher numbering. */
export default function InvoiceSettingsScreen() {
  const settings = useInvoiceSettings();
  if (settings.data) return <Form initial={settings.data} />;
  return (
    <Screen header={<Header close title="Invoice and numbering" />}>
      <QueryView query={settings}>{() => null}</QueryView>
    </Screen>
  );
}

function Form({ initial }: { initial: InvoiceSettingsView }) {
  const ledgers = useLedgers();
  const update = useUpdateInvoiceSettings();
  const [template, setTemplate] = useState(initial.template);
  const [terms, setTerms] = useState(initial.terms);
  const [showBank, setShowBank] = useState(initial.showBankDetails);
  const [bankId, setBankId] = useState(initial.bankLedgerId);
  const [prefixes, setPrefixes] = useState(initial.prefixes);
  // Kept as text while typing; checked and converted on save.
  const [numbering, setNumbering] = useState(
    () =>
      Object.fromEntries(
        TYPES.map((t) => {
          const rule = { ...DEFAULT_NUMBERING, ...initial.numbering?.[t] };
          return [
            t,
            {
              start: String(rule.start),
              digits: String(rule.digits),
              showYear: rule.showYear,
            },
          ];
        }),
      ) as Record<
        VoucherType,
        { start: string; digits: string; showYear: boolean }
      >,
  );
  const [openType, setOpenType] = useState<VoucherType | null>(null);
  const [pickBank, setPickBank] = useState(false);
  const [account, setAccount] = useState({
    accountName: initial.bankAccount?.accountName ?? "",
    accountNumber: initial.bankAccount?.accountNumber ?? "",
    ifsc: initial.bankAccount?.ifsc ?? "",
    upiId: initial.bankAccount?.upiId ?? "",
  });
  const setAcc = (k: keyof typeof account) => (t: string) =>
    setAccount({
      ...account,
      [k]:
        k === "ifsc"
          ? t
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "")
              .slice(0, 11)
          : k === "accountNumber"
            ? t.replace(/\D/g, "").slice(0, 18)
            : t,
    });
  const ifscOk = !account.ifsc || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(account.ifsc);
  const fy = financialYear(today()).short;
  const bankName =
    ledgers.data?.find((l) => l.ledger.id === bankId)?.ledger.name ??
    initial.bankName;
  const badPrefix = TYPES.find((t) => !/^[A-Z0-9-]{1,5}$/.test(prefixes[t]));
  const ruleOf = (t: VoucherType): NumberingRule | null => {
    const n = numbering[t];
    const start = Number(n.start);
    const digits = Number(n.digits);
    if (!/^\d{1,8}$/.test(n.start) || start < 1) return null;
    if (!/^[1-8]$/.test(n.digits)) return null;
    return { start, digits, showYear: n.showYear };
  };
  const badRule = TYPES.find((t) => !ruleOf(t));
  const problem = badPrefix
    ? `${voucherTypeLabel[badPrefix]} prefix: 1–5 capital letters or digits.`
    : badRule
      ? `${voucherTypeLabel[badRule]}: start from 1 or more, with 1 to 8 digits.`
      : null;
  const setRule = (
    t: VoucherType,
    patch: Partial<{ start: string; digits: string; showYear: boolean }>,
  ) => setNumbering({ ...numbering, [t]: { ...numbering[t], ...patch } });

  const save = async () => {
    if (problem || !ifscOk) return;
    try {
      await update.mutateAsync({
        template,
        terms: terms.trim(),
        showBankDetails: showBank,
        bankLedgerId: bankId,
        bankAccount: account.accountNumber
          ? {
              accountName: account.accountName.trim(),
              accountNumber: account.accountNumber,
              ifsc: account.ifsc,
              upiId: account.upiId.trim() || undefined,
            }
          : undefined,
        prefixes,
        numbering: Object.fromEntries(
          TYPES.map((t) => [t, ruleOf(t) ?? DEFAULT_NUMBERING]),
        ),
      });
      backOrReplace(router, "/settings");
    } catch (e) {
      showError("Couldn't save", e);
    }
  };

  return (
    <Screen
      header={
        <Header
          close
          title="Invoice and numbering"
          subtitle="Applies to new vouchers"
        />
      }
      footer={
        <FooterBar>
          <Txt
            variant="caption"
            tone={problem ? "give" : "body"}
            style={{ flex: 1 }}
          >
            {problem ?? "Old vouchers keep their numbers."}
          </Txt>
          <Button
            label="Save"
            variant="primary"
            onPress={save}
            loading={update.isPending}
            disabled={!!problem}
          />
        </FooterBar>
      }
    >
      <View style={{ gap: space.sm }}>
        <Txt variant="heading">Print format</Txt>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {TEMPLATES.map((t) => (
            <Pressable
              key={t.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: template === t.value }}
              onPress={() => setTemplate(t.value)}
              style={{
                flex: 1,
                padding: 10,
                gap: 8,
                borderRadius: radius.card,
                borderWidth: template === t.value ? 2 : 1,
                borderColor:
                  template === t.value ? colors.ink : colors.hairline,
              }}
            >
              <TemplatePreview kind={t.value} />
              <View>
                <Txt variant="label">{t.label}</Txt>
                <Txt variant="caption" tone="body">
                  {t.note}
                </Txt>
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      <TextField
        label="Terms and conditions"
        value={terms}
        onChangeText={setTerms}
        multiline
      />

      <Card style={{ gap: space.md }}>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
        >
          <View style={{ flex: 1 }}>
            <Txt variant="bodyStrong">Print bank details</Txt>
            <Txt variant="caption" tone="body">
              So customers can pay by NEFT / UPI
            </Txt>
          </View>
          <Switch
            value={showBank}
            onValueChange={setShowBank}
            accessibilityLabel="Print bank details"
            trackColor={{ true: colors.ink, false: colors.hairlineStrong }}
            thumbColor={colors.canvas}
            // Web only: keep the thumb white when on
            {...({ activeThumbColor: colors.canvas } as object)}
          />
        </View>
        {showBank ? (
          <>
            <View style={{ flexDirection: "row" }}>
              <SelectField
                label="Bank"
                value={bankName}
                onPress={() => setPickBank(true)}
              />
            </View>
            <View style={{ flexDirection: "row" }}>
              <TextField
                label="Account holder"
                value={account.accountName}
                onChangeText={setAcc("accountName")}
              />
            </View>
            <View style={{ flexDirection: "row", gap: space.md }}>
              <TextField
                label="Account number"
                value={account.accountNumber}
                onChangeText={setAcc("accountNumber")}
                keyboardType="number-pad"
                mono
              />
              <TextField
                label="IFSC"
                value={account.ifsc}
                onChangeText={setAcc("ifsc")}
                mono
                error={ifscOk ? undefined : "11 characters, e.g. HDFC0001234"}
              />
            </View>
            <View style={{ flexDirection: "row" }}>
              <TextField
                label="UPI id (optional)"
                value={account.upiId}
                onChangeText={setAcc("upiId")}
                placeholder="e.g. shop@okhdfcbank"
              />
            </View>
          </>
        ) : null}
      </Card>

      <BrandingSection />

      <View style={{ gap: space.sm }}>
        <Txt variant="heading">Voucher numbering</Txt>
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: radius.card,
            paddingHorizontal: 14,
          }}
        >
          {TYPES.map((t, i) => {
            const rule = ruleOf(t);
            const open = openType === t;
            return (
              <View
                key={t}
                style={{
                  paddingVertical: 8,
                  gap: space.sm,
                  borderBottomWidth: i === TYPES.length - 1 ? 0 : 1,
                  borderBottomColor: colors.hairlineSoft,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    accessibilityLabel={`${voucherTypeLabel[t]} number format`}
                    onPress={() => setOpenType(open ? null : t)}
                    style={{ flex: 1 }}
                  >
                    <Txt variant="bodyStrong">{voucherTypeLabel[t]}</Txt>
                    <Txt variant="caption" tone="body" num>
                      {rule
                        ? formatVoucherNumber(
                            prefixes[t] || "?",
                            fy,
                            rule.start,
                            rule,
                          )
                        : "Check the format"}
                      {open ? "" : "  ·  Change format"}
                    </Txt>
                  </Pressable>
                  <View style={{ width: 96, flexDirection: "row" }}>
                    <TextField
                      label={`${voucherTypeLabel[t]} prefix`}
                      hideLabel
                      value={prefixes[t]}
                      onChangeText={(text) =>
                        setPrefixes({
                          ...prefixes,
                          [t]: text.toUpperCase().replace(/\s/g, ""),
                        })
                      }
                      mono
                    />
                  </View>
                </View>
                {open && (
                  <View style={{ gap: space.sm }}>
                    <View style={{ flexDirection: "row", gap: space.md }}>
                      <View style={{ flex: 1 }}>
                        <TextField
                          label="Start from"
                          value={numbering[t].start}
                          keyboardType="number-pad"
                          onChangeText={(text) =>
                            setRule(t, {
                              start: text.replace(/\D/g, "").slice(0, 8),
                            })
                          }
                          mono
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <TextField
                          label="Digits"
                          value={numbering[t].digits}
                          keyboardType="number-pad"
                          onChangeText={(text) =>
                            setRule(t, {
                              digits: text.replace(/\D/g, "").slice(0, 1),
                            })
                          }
                          mono
                        />
                      </View>
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.md,
                      }}
                    >
                      <Txt style={{ flex: 1 }}>Show the year in the number</Txt>
                      <Switch
                        accessibilityLabel={`Show the year in ${voucherTypeLabel[t]} numbers`}
                        value={numbering[t].showYear}
                        onValueChange={(showYear) => setRule(t, { showYear })}
                      />
                    </View>
                    <Txt variant="caption" tone="body">
                      {numbering[t].showYear
                        ? "Numbers restart every financial year."
                        : "One running number across all years, so no number repeats."}{" "}
                      A higher start skips ahead; numbers already used are never
                      given again.
                    </Txt>
                  </View>
                )}
              </View>
            );
          })}
        </View>
        <Txt variant="caption" tone="body">
          Tap a voucher type to change its starting number, digits or year.
        </Txt>
      </View>

      <PickerSheet
        visible={pickBank}
        title="Bank account"
        onClose={() => setPickBank(false)}
        onSelect={(id) => {
          setBankId(id);
          setPickBank(false);
        }}
        options={(ledgers.data ?? [])
          .filter((l) => l.ledger.kind === "bank")
          .map((l) => ({ id: l.ledger.id, title: l.ledger.name }))}
      />
    </Screen>
  );
}

/** Tiny drawing of each print format, made of grey bars. */
function TemplatePreview({ kind }: { kind: InvoiceTemplate }) {
  const bar = (w: string | number, h = 4, dark = false) => (
    <View
      style={{
        width: w as number,
        height: h,
        borderRadius: 2,
        backgroundColor: dark ? colors.ink : colors.hairlineStrong,
      }}
    />
  );
  return (
    <View
      style={{
        height: 76,
        padding: 6,
        gap: 4,
        borderRadius: 6,
        backgroundColor: colors.surfaceSoft,
        borderWidth: kind === "classic" ? 1 : 0,
        borderColor: colors.hairlineStrong,
        alignItems: kind === "compact" ? "center" : "stretch",
      }}
    >
      {bar(kind === "modern" ? "60%" : "45%", 6, true)}
      {bar("80%")}
      {kind === "classic" ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.hairlineStrong,
            padding: 3,
            gap: 3,
          }}
        >
          {bar("100%", 3)}
          {bar("100%", 3)}
          {bar("100%", 3)}
        </View>
      ) : (
        <>
          {bar(kind === "compact" ? "70%" : "100%", 3)}
          {bar(kind === "compact" ? "70%" : "100%", 3)}
          {bar(kind === "compact" ? "70%" : "100%", 3)}
        </>
      )}
      {bar("40%", 5, true)}
    </View>
  );
}

/**
 * Firm logo and the signatory's signature or stamp, printed on documents
 * (doc 37, T16). Saved at once, apart from the rest of this screen.
 */
function BrandingSection() {
  const branding = useBranding();
  const save = useSaveBranding();
  const [busy, setBusy] = useState<"logo" | "signature" | null>(null);
  const current = branding.data;
  const update = async (which: "logo" | "signature", pick: boolean) => {
    if (!current) return;
    setBusy(which);
    try {
      const image = pick
        ? await pickBrandingImage(which === "logo" ? 600 : 400)
        : null;
      if (pick && !image) return;
      await save.mutateAsync({
        logo: which === "logo" ? image : current.logo,
        signature: which === "signature" ? image : current.signature,
        version: current.version,
      });
    } catch (e) {
      showError("Couldn't save the image", e);
    } finally {
      setBusy(null);
    }
  };
  const row = (which: "logo" | "signature", title: string, note: string) => {
    const uri = current?.[which];
    return (
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
      >
        <View
          style={{
            width: 96,
            height: 56,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: radius.card,
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {uri ? (
            <Image
              source={{ uri }}
              accessibilityLabel={title}
              style={{ width: 92, height: 52 }}
              resizeMode="contain"
            />
          ) : (
            <Txt variant="caption" tone="body">
              None
            </Txt>
          )}
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Txt variant="bodyStrong">{title}</Txt>
          <Txt variant="caption" tone="body">
            {note}
          </Txt>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button
              label={uri ? "Change" : "Choose image"}
              size="sm"
              onPress={() => update(which, true)}
              loading={busy === which}
              disabled={!current || busy !== null}
            />
            {uri ? (
              <Button
                label="Remove"
                size="sm"
                onPress={() => update(which, false)}
                disabled={busy !== null}
              />
            ) : null}
          </View>
        </View>
      </View>
    );
  };
  return (
    <View style={{ gap: space.sm }}>
      <Txt variant="heading">Logo and signature</Txt>
      {row("logo", "Logo", "Printed at the top of every bill and order")}
      {row(
        "signature",
        "Signature or stamp",
        "Printed above Authorised signatory",
      )}
    </View>
  );
}
