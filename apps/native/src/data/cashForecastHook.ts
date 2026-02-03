import { can } from "@repo/core";
import type { CashForecastRequest } from "@repo/contracts/src/cashForecast";
import { useAuth } from "../auth/AuthProvider";
import { useData } from "./DataProvider";
import { useServiceMutation } from "./scopedHooks";

/** Keep late responses isolated when the user, firm or report permissions change. */
export function useCashForecast() {
  const data = useData();
  const auth = useAuth();
  return useServiceMutation({
    mutationFn: async (services, input: CashForecastRequest) => {
      if (
        auth.status !== "signedIn" ||
        auth.locked ||
        !data.role ||
        !can(data.role, "reports")
      )
        throw new Error("Report access is required for this firm.");
      return services.cashForecastService.forecast(input);
    },
  });
}
