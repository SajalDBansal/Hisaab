import { router, useLocalSearchParams } from "expo-router";
import { backOrReplace } from "@/navigation";
import { EmptyState, Header, Screen } from "@/components";

/** Placeholder for screens that are designed on the canvas but not built yet. */
export default function ComingSoon() {
  const { title = "This screen" } = useLocalSearchParams<{ title?: string }>();
  return (
    <Screen header={<Header title={title} />}>
      <EmptyState
        icon="tool"
        title={`${title} is coming next`}
        message="This screen is on the design canvas and will be built in a later step."
        actionLabel="Go back"
        onAction={() => backOrReplace(router)}
      />
    </Screen>
  );
}
