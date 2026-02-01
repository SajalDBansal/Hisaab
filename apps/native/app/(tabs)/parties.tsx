import { router } from "expo-router";
import { useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import type { PartyListRow, PartyType } from "@repo/core";
import {
  Avatar,
  Balance,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  Icon,
  ListRow,
  Money,
  QueryView,
  Screen,
  Segmented,
  TabTitle,
  Txt,
} from "@/components";
import { useParties } from "@/data/queries";
import { colors, radius, space } from "@/theme";
import { useGstMode } from "@/data/gstMode";

type Tab = PartyType | "all";
type Sort = "balance" | "name";

export default function PartiesScreen() {
  const gst = useGstMode();
  const [tab, setTab] = useState<Tab>("customer");
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [withBalance, setWithBalance] = useState(false);
  const [sort, setSort] = useState<Sort>("balance");
  const parties = useParties(tab === "all" ? undefined : tab);

  return (
    <Screen
      header={
        <TabTitle
          title="Parties"
          right={
            <Button
              label="Add party"
              size="sm"
              icon="plus"
              onPress={() =>
                router.push(
                  `/party/new?type=${tab === "supplier" ? "supplier" : "customer"}`,
                )
              }
            />
          }
        />
      }
      onRefresh={() => parties.refetch()}
      refreshing={parties.isRefetching}
      contentStyle={{ gap: space.lg, paddingTop: space.xs }}
    >
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "customer", label: "Customers" },
          { value: "supplier", label: "Suppliers" },
          { value: "all", label: "All" },
        ]}
      />

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          minHeight: 44,
          paddingHorizontal: space.lg,
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceSoft,
        }}
      >
        <Icon name="search" size={18} color={colors.body} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={
            gst.on ? "Search name, phone or GSTIN" : "Search name or phone"
          }
          placeholderTextColor={colors.mute}
          accessibilityLabel="Search parties"
          style={{ flex: 1, fontSize: 14, minHeight: 40, color: colors.ink }}
        />
      </View>

      <ChipRow>
        <Chip
          label="Overdue"
          selected={overdueOnly}
          onPress={() => setOverdueOnly(!overdueOnly)}
        />
        <Chip
          label="Has balance"
          selected={withBalance}
          onPress={() => setWithBalance(!withBalance)}
        />
        <Chip
          label={sort === "balance" ? "Sort: Balance" : "Sort: Name"}
          selected
          onPress={() => setSort(sort === "balance" ? "name" : "balance")}
        />
      </ChipRow>

      <QueryView query={parties}>
        {(rows) => (
          <PartyList
            rows={rows}
            search={search}
            overdueOnly={overdueOnly}
            withBalance={withBalance}
            sort={sort}
          />
        )}
      </QueryView>
    </Screen>
  );
}

function PartyList({
  rows,
  search,
  overdueOnly,
  withBalance,
  sort,
}: {
  rows: PartyListRow[];
  search: string;
  overdueOnly: boolean;
  withBalance: boolean;
  sort: Sort;
}) {
  const gst = useGstMode();
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(
        (r) =>
          !q ||
          `${r.party.name} ${r.party.phone} ${r.party.gstin ?? ""}`
            .toLowerCase()
            .includes(q),
      )
      .filter((r) => !overdueOnly || r.overdueAmount > 0)
      .filter((r) => !withBalance || r.balance !== 0)
      .sort((a, b) =>
        sort === "name"
          ? a.party.name.localeCompare(b.party.name)
          : Math.abs(b.balance) - Math.abs(a.balance),
      );
  }, [rows, search, overdueOnly, withBalance, sort]);

  const youGet = rows
    .filter((r) => r.balance > 0)
    .reduce((s, r) => s + r.balance, 0);
  const youGive = rows
    .filter((r) => r.balance < 0)
    .reduce((s, r) => s - r.balance, 0);

  return (
    <>
      <View style={{ flexDirection: "row", gap: space.md }}>
        <Card style={{ flex: 1, paddingVertical: space.md }}>
          <Txt variant="small" tone="body">
            You'll get
          </Txt>
          <Money value={youGet} variant="heading" tone="get" />
        </Card>
        <Card style={{ flex: 1, paddingVertical: space.md }}>
          <Txt variant="small" tone="body">
            You'll give
          </Txt>
          <Money value={youGive} variant="heading" tone="give" />
        </Card>
      </View>

      <Txt variant="small" tone="body" style={{ marginBottom: -space.sm }}>
        {visible.length} {visible.length === 1 ? "party" : "parties"}
      </Txt>

      {visible.length === 0 ? (
        <EmptyState
          icon="users"
          title="No parties match"
          message="Clear the search or filters to see everyone."
        />
      ) : (
        <View>
          {visible.map((r, i) => (
            <ListRow
              key={r.party.id}
              left={<Avatar name={r.party.name} />}
              title={r.party.name}
              subtitle={
                <Txt variant="small" tone="body" numberOfLines={1}>
                  {r.party.gstin || !gst.on
                    ? r.party.phone
                    : `Unregistered · ${r.party.phone}`}
                  {r.overdueAmount > 0 ? (
                    <Txt
                      variant="small"
                      tone="warn"
                    >{` · Overdue ${r.maxOverdueDays}d`}</Txt>
                  ) : null}
                </Txt>
              }
              right={<Balance value={r.balance} />}
              onPress={() => router.push(`/party/${r.party.id}`)}
              last={i === visible.length - 1}
            />
          ))}
        </View>
      )}
    </>
  );
}
