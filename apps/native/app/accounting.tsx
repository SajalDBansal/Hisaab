import { router } from "expo-router";
import { useState } from "react";
import { useReportScope } from "@/data/reportScope";
import { View } from "react-native";
import { formatDate, type ChartGroup } from "@repo/core";
import {
  Button,
  EmptyState,
  Header,
  ListRow,
  Money,
  PickerSheet,
  PagedView,
  QueryView,
  Screen,
  TaxScopeFilter,
  Segmented,
  SelectField,
  TextField,
  Txt,
} from "@/components";
import { accountHref, drCr } from "@/data/labels";
import { useChart } from "@/data/queries";
import { useVoucherPages } from "@/data/pagedQueries";
import { space } from "@/theme";

/** One workspace for account masters and non-trade entries. */
export default function AccountingWorkspace() {
  const [tab, setTab] = useState<"ledgers" | "journals">("ledgers");
  const chart = useChart();
  const [scope] = useReportScope();
  const journals = useVoucherPages(
    { types: "journal", scope },
    tab === "journals",
  );
  return (
    <Screen
      header={<Header title="Ledgers & journals" />}
      onEndReached={tab === "journals" ? journals.loadMore : undefined}
    >
      <TaxScopeFilter />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <Button
          label="New ledger"
          icon="plus"
          variant="primary"
          onPress={() => router.push("/account/new")}
        />
        <Button
          label="Loan / capital"
          icon="repeat"
          onPress={() => router.push("/journal/financing")}
        />
        <Button
          label="Journal"
          icon="edit-3"
          onPress={() => router.push("/journal/new")}
        />
        <Button
          label="Customer"
          icon="user-plus"
          onPress={() => router.push("/party/new?type=customer")}
        />
        <Button
          label="Supplier"
          icon="user-plus"
          onPress={() => router.push("/party/new?type=supplier")}
        />
      </View>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "ledgers", label: "Ledgers" },
          { value: "journals", label: "Journals" },
        ]}
      />
      {tab === "ledgers" ? (
        <QueryView query={chart}>
          {(groups) => <LedgerList groups={groups} />}
        </QueryView>
      ) : (
        <PagedView list={journals} noun="journals">
          {({ items: visible }) =>
            visible.length ? (
              <View>
                {visible.map((v, i) => (
                  <ListRow
                    key={v.id}
                    title={v.number}
                    subtitle={`${formatDate(v.date)} - ${v.narration ?? v.status}`}
                    right={<Money value={v.amount} />}
                    onPress={() => router.push(`/voucher/${v.id}`)}
                    last={i === visible.length - 1}
                  />
                ))}
              </View>
            ) : (
              <EmptyState icon="book-open" title="No journals yet" />
            )
          }
        </PagedView>
      )}
    </Screen>
  );
}

function LedgerList({ groups }: { groups: ChartGroup[] }) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [picking, setPicking] = useState(false);
  const rows = groups
    .flatMap((g) => g.accounts)
    .filter(
      (a) =>
        (group === "all" || a.group === group) &&
        a.name.toLowerCase().includes(search.toLowerCase()),
    );
  return (
    <View style={{ gap: space.md }}>
      <TextField
        label="Search ledgers"
        value={search}
        onChangeText={setSearch}
      />
      <SelectField
        label="Group"
        value={group === "all" ? "All groups" : group}
        onPress={() => setPicking(true)}
      />
      {rows.map((a, i) => (
        <ListRow
          key={a.key}
          title={a.name}
          subtitle={a.group}
          right={
            <Txt variant="small" num>
              {drCr(a.balance)}
            </Txt>
          }
          onPress={() => router.push(accountHref(a.key))}
          last={i === rows.length - 1}
        />
      ))}
      {!rows.length ? (
        <EmptyState icon="book-open" title="No ledgers found" />
      ) : null}
      <PickerSheet
        visible={picking}
        title="Account group"
        onClose={() => setPicking(false)}
        options={[
          { id: "all", title: "All groups" },
          ...groups.map((g) => ({ id: g.group.name, title: g.group.name })),
        ]}
        onSelect={(id) => {
          setGroup(id);
          setPicking(false);
        }}
      />
    </View>
  );
}
