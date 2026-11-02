import type { UseQueryResult } from "@tanstack/react-query";
import { StyleSheet, View } from "react-native";
import { colors, radius, space } from "@/theme";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";

/** Grey placeholder rows shown while data loads. */
export function LoadingList({ rows = 4 }: { rows?: number }) {
  return (
    <View
      style={{ gap: space.lg }}
      accessibilityLabel="Loading"
      accessibilityState={{ busy: true }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <View
          key={i}
          style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
        >
          <View
            style={[
              styles.bone,
              { width: 40, height: 40, borderRadius: radius.pill },
            ]}
          />
          <View style={{ flex: 1, gap: space.sm }}>
            <View style={[styles.bone, { width: "70%" }]} />
            <View style={[styles.bone, { width: "40%" }]} />
          </View>
          <View style={[styles.bone, { width: 64 }]} />
        </View>
      ))}
    </View>
  );
}

/** Friendly message with an optional action, for empty lists and "no results". */
export function EmptyState({
  icon = "inbox",
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.center}>
      <View style={styles.iconCircle}>
        <Icon name={icon} size={24} />
      </View>
      <Txt variant="heading" center>
        {title}
      </Txt>
      {message ? (
        <Txt variant="small" tone="body" center style={{ maxWidth: 280 }}>
          {message}
        </Txt>
      ) : null}
      {actionLabel ? (
        <Button label={actionLabel} onPress={onAction} size="sm" />
      ) : null}
    </View>
  );
}

export function ErrorState({
  onRetry,
  error,
}: {
  onRetry?: () => void;
  error?: unknown;
}) {
  // No connection (status 0): explain instead of reporting a failure.
  const offline = error as { status?: number; offline?: boolean } | null;
  if (offline?.status === 0 || offline?.offline)
    return (
      <EmptyState
        icon="wifi-off"
        title="You're offline"
        message="This screen needs a connection, or it wasn't part of the last download. Downloaded books stay readable; connect to see this."
        actionLabel="Try again"
        onAction={onRetry}
      />
    );
  return (
    <EmptyState
      icon="alert-circle"
      title="Couldn't load this"
      message="Something went wrong while fetching data. Your saved entries are safe."
      actionLabel="Try again"
      onAction={onRetry}
    />
  );
}

/**
 * Shows loading / error states for a query and renders `children(data)` when ready.
 * Keeps every screen's data handling the same and easy to read.
 */
export function QueryView<T>({
  query,
  children,
  loading,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => React.ReactNode;
  loading?: React.ReactNode;
}) {
  if (query.isPending) return <>{loading ?? <LoadingList />}</>;
  if (query.isError || query.data === undefined)
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <>{children(query.data)}</>;
}

const styles = StyleSheet.create({
  bone: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.hairlineSoft,
  },
  center: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
});
