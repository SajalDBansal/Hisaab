import { router, type Href } from "expo-router";
import { View } from "react-native";
import { can, roleInfo } from "@repo/core";
import {
  Avatar,
  Badge,
  Card,
  Header,
  ListRow,
  QueryView,
  Screen,
  Txt,
  type IconName,
} from "@/components";
import { APP_NAME } from "@/data/labels";
import { useData } from "@/data/DataProvider";

import { useFirm, useTeam } from "@/data/queries";
import { space } from "@/theme";

interface Row {
  title: string;
  note: string;
  icon: IconName;
  href: Href;
  /** Hidden unless the current user has this permission. */
  needs?: "settings" | "team" | "reports" | "accounts";
  ownerOnly?: boolean;
}

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: "You",
    rows: [
      {
        title: "Account and devices",
        note: "Email, mobile, who is logged in where",
        icon: "user",
        href: "/settings/account",
      },
      {
        title: "App lock",
        note: "PIN for this phone",
        icon: "lock",
        href: "/settings/pin",
      },
    ],
  },
  {
    title: "Business",
    rows: [
      {
        title: "Business associates",
        note: "Delivery profiles, commissions and payouts",
        icon: "users",
        href: "/associates",
        needs: "accounts",
      },
      {
        title: "Settlements",
        note: "Advances, refunds and corrections",
        icon: "repeat",
        href: "/settlements",
        needs: "reports",
      },
      {
        title: "Inventory adjustments",
        note: "Counts, losses and landed costs",
        icon: "package",
        href: "/inventory",
        needs: "reports",
      },
      {
        title: "Book controls",
        note: "Opening balances, period close and reopening history",
        icon: "lock",
        href: "/settings/books",
        needs: "settings",
      },
      {
        title: "Download reports",
        note: "Financial statements, books and ledgers",
        icon: "download",
        href: "/settings/reports",
        needs: "reports",
      },
      {
        title: "Cash forecast",
        note: "Expected collections and payments",
        icon: "trending-up",
        href: "/reports/cash-forecast",
        needs: "reports",
      },
      {
        title: "Loan register",
        note: "Loan terms, schedules and repayment journals",
        icon: "briefcase",
        href: "/loans",
        needs: "reports",
      },
      {
        title: "Import records",
        note: "Masters, opening bills, balances and stock",
        icon: "upload",
        href: "/settings/imports",
        needs: "settings",
      },
      {
        title: "Pending uploads",
        note: "Saved attachment retries on this device",
        icon: "upload-cloud",
        href: "/settings/pending-uploads",
      },
      {
        title: "Documents",
        note: "Bills, challans, receipts and supporting files",
        icon: "folder",
        href: "/documents",
      },
      {
        title: "Firm profile",
        note: "Name, address, GSTIN, PAN",
        icon: "briefcase",
        href: "/settings/firm",
        needs: "settings",
      },
      {
        title: "Units",
        note: "Nos, Kg, Box … switch on, off or add your own",
        icon: "box",
        href: "/settings/units",
        needs: "settings",
      },
      {
        title: "Edit log",
        note: "Every entry created, changed or cancelled",
        icon: "clock",
        href: "/audit",
        needs: "reports",
      },
      {
        title: "Invoice and numbering",
        note: "Print format, terms, bank details, prefixes",
        icon: "file-text",
        href: "/settings/invoice",
        needs: "settings",
      },
    ],
  },
  {
    title: "People",
    rows: [
      {
        title: "Team and roles",
        note: "Who can see and do what",
        icon: "users",
        href: "/settings/team",
      },
    ],
  },
  {
    title: "App",
    rows: [
      {
        title: "Offline books",
        note: "Downloaded books and pending entries",
        icon: "database",
        href: "/settings/offline-books",
      },
      {
        title: "Reminders",
        note: "WhatsApp payment reminders",
        icon: "bell",
        href: "/settings/reminders",
      },
      {
        title: "Backup and sync",
        note: "Backup file, restore, cloud sync",
        icon: "cloud",
        href: "/settings/backup",
        ownerOnly: true,
      },
    ],
  },
];

export default function SettingsScreen() {
  const { role } = useData();
  const firm = useFirm();
  const team = useTeam();
  const me = team.data?.members.find((m) => m.id === team.data?.currentUserId);

  return (
    <Screen
      header={<Header title={"Settings"} subtitle={firm.data?.name ?? ""} />}
    >
      <QueryView query={firm}>
        {(f) => (
          <Card
            onPress={
              role && can(role, "settings")
                ? () => router.push("/settings/firm")
                : undefined
            }
            style={{ gap: space.sm }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
              }}
            >
              <Avatar name={f.name} size={48} />
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong" style={{ fontWeight: "600" }}>
                  {f.name}
                </Txt>
                <Txt variant="small" tone="body">
                  {[f.address, f.city].filter(Boolean).join(", ")}
                </Txt>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {f.gstin ? <Badge label={`GSTIN ${f.gstin}`} /> : null}
              <Badge label={`FY ${f.fyLabel}`} />
              {me ? (
                <Badge label={`You: ${roleInfo(me.role).label}`} tone="ink" />
              ) : null}
            </View>
          </Card>
        )}
      </QueryView>

      {SECTIONS.map((s) => {
        const rows = s.rows.filter(
          (r) =>
            (!r.ownerOnly || role === "owner") &&
            (!r.needs || (!!role && can(role, r.needs))),
        );
        if (rows.length === 0) return null;
        return (
          <View key={s.title}>
            <Txt variant="heading" style={{ marginBottom: space.xs }}>
              {s.title}
            </Txt>
            {rows.map((r, i) => (
              <ListRow
                key={r.title}
                left={<Avatar icon={r.icon} />}
                title={r.title}
                subtitle={r.note}
                chevron
                onPress={() => router.push(r.href)}
                last={i === rows.length - 1}
              />
            ))}
          </View>
        );
      })}

      <Txt variant="caption" tone="body" center>
        {APP_NAME} 0.1.0
      </Txt>
    </Screen>
  );
}
