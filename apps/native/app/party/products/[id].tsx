import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { formatINR } from "@repo/core";
import { Header, QueryView, Screen, Txt } from "@/components";
import { useParty, usePartyItems } from "@/data/queries";
import { TradeRateList } from "@/lists/TradeRateList";
import { colors, radius } from "@/theme";

/** The products a customer buys or a supplier sells us, with the latest rates. */
export default function PartyProductsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const party = useParty(id);
  const items = usePartyItems(id);
  const type = party.data?.party.type;
  const supplier = type === "supplier";

  return (
    <Screen
      header={
        <Header
          title={supplier ? "Products they supply" : "Products they buy"}
          subtitle={party.data?.party.name}
        />
      }
      onRefresh={() => Promise.all([party.refetch(), items.refetch()])}
      refreshing={party.isRefetching || items.isRefetching}
    >
      <QueryView query={items}>
        {({ rows }) =>
          type ? (
            <>
              <View
                style={{
                  flexDirection: "row",
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: radius.card,
                }}
              >
                <Summary label="Products" value={String(rows.length)} />
                <Summary
                  label={supplier ? "Bought, before GST" : "Sold, before GST"}
                  value={formatINR(
                    rows.reduce((sum, r) => sum + r.value, 0),
                    { decimals: false },
                  )}
                  divider
                />
                {supplier ? (
                  <Summary
                    label="Their stock on hand"
                    value={formatINR(
                      rows.reduce((sum, r) => sum + (r.stockValue ?? 0), 0),
                      { decimals: false },
                    )}
                    divider
                  />
                ) : null}
              </View>
              <TradeRateList
                rows={rows}
                type={type}
                view="party"
                emptyTitle={
                  supplier ? "Nothing bought yet" : "Nothing sold yet"
                }
                emptyMessage={
                  supplier
                    ? "Products appear here after the first purchase bill from this supplier."
                    : "Products appear here after the first sale invoice to this customer."
                }
              />
            </>
          ) : null
        }
      </QueryView>
    </Screen>
  );
}

function Summary({
  label,
  value,
  divider,
}: {
  label: string;
  value: string;
  divider?: boolean;
}) {
  return (
    <View
      style={{
        flex: 1,
        padding: 12,
        borderLeftWidth: divider ? 1 : 0,
        borderLeftColor: colors.hairline,
      }}
    >
      <Txt variant="caption" tone="body">
        {label}
      </Txt>
      <Txt variant="heading" num adjustsFontSizeToFit numberOfLines={1}>
        {value}
      </Txt>
    </View>
  );
}
