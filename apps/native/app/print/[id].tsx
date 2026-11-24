import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { PAGE_WIDTH, retailLayout, type PrintLayout } from "@repo/core";
import {
  Button,
  FooterBar,
  Header,
  HtmlPreview,
  QueryView,
  Screen,
  Segmented,
  Txt,
  showError,
} from "@/components";
import { printHtml, sharePdf, whatsappText } from "@/data/print";
import { useInvoiceSettings, usePrintable, useVoucher } from "@/data/queries";
import { space } from "@/theme";

/** Preview a voucher as it will print, then share it as a PDF, print it or send a WhatsApp message. */
export default function PrintScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const settings = useInvoiceSettings();
  const [template, setTemplate] = useState<PrintLayout | undefined>();
  // Retail bills (doc 37, T02) open on the firm's thermal roll.
  const retail = !!useVoucher(id).data?.voucher.retail;
  const saved: PrintLayout | undefined = settings.data
    ? retail
      ? retailLayout(settings.data)
      : settings.data.template
    : undefined;
  const chosen = template ?? saved ?? "classic";
  const doc = usePrintable(id, chosen);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      showError("Couldn't share", e);
    } finally {
      setBusy(false);
    }
  };

  const d = doc.data;
  return (
    <Screen
      header={
        <Header
          title={
            d ? `${d.title[0]}${d.title.slice(1).toLowerCase()}` : "Preview"
          }
          subtitle="Share as PDF or print"
        />
      }
      footer={
        d ? (
          <FooterBar>
            {d.phone ? (
              <Button
                label="Message"
                icon="message-circle"
                onPress={() => run(() => whatsappText(d.phone, d.shareText))}
              />
            ) : null}
            <Button
              label="Print"
              icon="printer"
              onPress={() => run(() => printHtml(d.html))}
            />
            <Button
              label="Share PDF"
              icon="share-2"
              variant="primary"
              loading={busy}
              onPress={() => run(() => sharePdf(d.html, d.fileName, d.title))}
              style={{ flex: 1 }}
            />
          </FooterBar>
        ) : null
      }
    >
      <Segmented
        value={chosen}
        onChange={setTemplate}
        options={[
          { value: "classic", label: "Classic" },
          { value: "modern", label: "Modern" },
          { value: "compact", label: "80 mm" },
          { value: "compact-58", label: "58 mm" },
        ]}
      />
      <QueryView query={doc}>
        {(p) => (
          <View style={{ gap: space.sm }}>
            <HtmlPreview
              html={p.html}
              height={
                chosen === "compact" || chosen === "compact-58" ? 760 : 560
              }
              pageWidth={PAGE_WIDTH[chosen]}
            />
            <Txt variant="caption" tone="body">
              {template && template !== saved
                ? "Previewing another format. Change the default in Settings → Invoice and numbering."
                : "Share PDF sends the bill as a PDF file — pick WhatsApp, Gmail or any app. Message only sends a short WhatsApp text with the amount."}
            </Txt>
          </View>
        )}
      </QueryView>
    </Screen>
  );
}
