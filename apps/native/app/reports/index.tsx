import { router, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  Avatar,
  EmptyState,
  Header,
  IconButton,
  ListRow,
  PickerSheet,
  QueryView,
  Screen,
  TaxScopeFilter,
  Txt,
  type IconName,
} from "@/components";
import { space } from "@/theme";
import { useGstMode } from "@/data/gstMode";
import { useLedgers } from "@/data/queries";

interface Report {
  title: string;
  note: string;
  icon: IconName;
  href: Href | "cash-book";
}

const SECTIONS: { title: string; reports: Report[] }[] = [
  {
    title: "Business",
    reports: [
      {
        title: "Profit & loss",
        note: "Gross and net profit for the year",
        icon: "trending-up",
        href: "/final-accounts?view=pl",
      },
      {
        title: "Balance sheet",
        note: "What the business owns and owes",
        icon: "layers",
        href: "/final-accounts?view=bs",
      },
      {
        title: "Trial balance",
        note: "Every account's Dr / Cr balance",
        icon: "columns",
        href: "/final-accounts?view=tb",
      },
    ],
  },
  {
    title: "Parties",
    reports: [
      {
        title: "Receivables",
        note: "Who owes you, with ageing",
        icon: "arrow-down-left",
        href: "/reports/outstanding?type=customer",
      },
      {
        title: "Payables",
        note: "Whom you owe, with ageing",
        icon: "arrow-up-right",
        href: "/reports/outstanding?type=supplier",
      },
    ],
  },
  {
    title: "Sales & purchase",
    reports: [
      {
        title: "Sales summary",
        note: "By month, customer and item",
        icon: "file-text",
        href: "/reports/trade?kind=sale",
      },
      {
        title: "Purchase summary",
        note: "By month, supplier and item",
        icon: "shopping-cart",
        href: "/reports/trade?kind=purchase",
      },
      {
        title: "Expense summary",
        note: "Where the money went",
        icon: "credit-card",
        href: "/reports/expenses",
      },
    ],
  },
  {
    title: "Stock",
    reports: [
      {
        title: "Stock summary",
        note: "Quantity and value by group",
        icon: "package",
        href: "/reports/stock",
      },
    ],
  },
  {
    title: "Books",
    reports: [
      {
        title: "Day Book",
        note: "Every voucher, newest first",
        icon: "list",
        href: "/daybook",
      },
      {
        title: "Cash book",
        note: "Cash in and out",
        icon: "dollar-sign",
        href: "cash-book",
      },
      {
        title: "Bank books",
        note: "Each bank account",
        icon: "credit-card",
        href: "/banking",
      },
      {
        title: "GST summary",
        note: "Tax to pay and returns",
        icon: "percent",
        href: "/gst",
      },
    ],
  },
];

/** All reports in one list, grouped the way an accountant looks for them. */
export default function ReportsScreen() {
  const gst = useGstMode();
  return (
    <Screen
      header={
        <Header
          title="Reports"
          right={
            <IconButton
              icon="download"
              label="Download reports"
              onPress={() => router.push("/settings/reports")}
            />
          }
          subtitle={
            gst.on ? "Books, parties, stock, GST" : "Books, parties, stock"
          }
        />
      }
    >
      <TaxScopeFilter />
      {SECTIONS.map((s) => (
        <View key={s.title}>
          <Txt variant="heading" style={{ marginBottom: space.xs }}>
            {s.title}
          </Txt>
          {s.reports
            .filter((r) => r.href !== "/gst" || gst.on)
            .map((r, i, list) =>
              r.href === "cash-book" ? (
                <CashBookLink key={r.title} last={i === list.length - 1} />
              ) : (
                <ListRow
                  key={r.title}
                  left={<Avatar icon={r.icon} />}
                  title={r.title}
                  subtitle={r.note}
                  chevron
                  onPress={() => {
                    if (r.href !== "cash-book") router.push(r.href);
                  }}
                  last={i === list.length - 1}
                />
              ),
            )}
        </View>
      ))}
    </Screen>
  );
}

/** Resolve real firm cash accounts instead of using the demo-only "cash" id. */
function CashBookLink({ last }: { last: boolean }) {
  const ledgers = useLedgers();
  const [picking, setPicking] = useState(false);
  return (
    <QueryView query={ledgers}>
      {(rows) => {
        const cash = rows.filter(({ ledger }) => ledger.kind === "cash");
        if (!cash.length) return <EmptyState title="No cash accounts" />;
        return (
          <>
            <ListRow
              left={<Avatar icon="dollar-sign" />}
              title="Cash book"
              subtitle="Cash in and out"
              chevron
              last={last}
              onPress={() => {
                if (cash.length === 1)
                  router.push(`/ledger/${cash[0].ledger.id}`);
                else setPicking(true);
              }}
            />
            <PickerSheet
              visible={picking}
              title="Cash account"
              options={cash.map(({ ledger }) => ({
                id: ledger.id,
                title: ledger.name,
              }))}
              onClose={() => setPicking(false)}
              onSelect={(id) => {
                setPicking(false);
                router.push(`/ledger/${id}`);
              }}
            />
          </>
        );
      }}
    </QueryView>
  );
}
