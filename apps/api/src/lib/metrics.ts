export type RequestMetric = {
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
};

type RouteMetric = {
  route: string;
  method: string;
  count: number;
  errors: number;
  totalMs: number;
  durations: number[];
};

const byRoute = new Map<string, RouteMetric>();
const lastAlertAt = new Map<string, number>();
const ALERT_COOLDOWN_MS = 5 * 60 * 1_000;

type RouteKey = Pick<RequestMetric, "method" | "route">;

function keyOf(metric: RouteKey) {
  return `${metric.method} ${metric.route}`;
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

export function recordRequest(metric: RequestMetric) {
  const key = keyOf(metric);
  const current =
    byRoute.get(key) ??
    ({
      route: metric.route,
      method: metric.method,
      count: 0,
      errors: 0,
      totalMs: 0,
      durations: [],
    } satisfies RouteMetric);
  current.count += 1;
  current.errors += metric.statusCode >= 500 ? 1 : 0;
  current.totalMs += metric.durationMs;
  current.durations.push(metric.durationMs);
  if (current.durations.length > 1_000) current.durations.shift();
  byRoute.set(key, current);
}

function routeSnapshot(metric: RouteMetric) {
  // One sort provides all percentiles; unrelated routes need no work here.
  const sorted = [...metric.durations].sort((a, b) => a - b);
  return {
    route: metric.route,
    method: metric.method,
    count: metric.count,
    errors: metric.errors,
    errorRate: metric.count ? metric.errors / metric.count : 0,
    avgMs: metric.count ? metric.totalMs / metric.count : 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
}

export function metricsSnapshot() {
  return [...byRoute.values()].map(routeSnapshot);
}

function labelValue(value: string) {
  // Prometheus label values escape backslash, quote and newline.
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}

function labels(metric: { route: string; method: string }) {
  return `method="${labelValue(metric.method)}",route="${labelValue(metric.route)}"`;
}

export function metricsText() {
  const lines = [
    "# HELP hisaab_http_requests_total HTTP requests handled by the API.",
    "# TYPE hisaab_http_requests_total counter",
  ];
  for (const metric of metricsSnapshot()) {
    lines.push(
      `hisaab_http_requests_total{${labels(metric)}} ${metric.count}`,
      `hisaab_http_errors_total{${labels(metric)}} ${metric.errors}`,
      `hisaab_http_request_duration_ms_avg{${labels(metric)}} ${metric.avgMs.toFixed(2)}`,
      `hisaab_http_request_duration_ms_p50{${labels(metric)}} ${metric.p50Ms.toFixed(2)}`,
      `hisaab_http_request_duration_ms_p95{${labels(metric)}} ${metric.p95Ms.toFixed(2)}`,
      `hisaab_http_request_duration_ms_p99{${labels(metric)}} ${metric.p99Ms.toFixed(2)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function shouldAlert(key: string, now: number) {
  const last = lastAlertAt.get(key);
  if (last !== undefined && now - last < ALERT_COOLDOWN_MS) return false;
  lastAlertAt.set(key, now);
  return true;
}

export function metricAlerts(route: RouteKey, now = Date.now()) {
  const alerts: {
    code: "HIGH_ERROR_RATE" | "SLOW_ROUTE";
    method: string;
    route: string;
    message: string;
    value: number;
  }[] = [];
  const current = byRoute.get(keyOf(route));
  if (!current || current.count < 20) return alerts;
  const metric = routeSnapshot(current);
  if (
    metric.count >= 20 &&
    metric.errorRate > 0.02 &&
    shouldAlert(`error:${metric.method}:${metric.route}`, now)
  )
    alerts.push({
      code: "HIGH_ERROR_RATE",
      method: metric.method,
      route: metric.route,
      message: "Route error rate is over 2%.",
      value: metric.errorRate,
    });
  if (
    metric.count >= 20 &&
    metric.p95Ms > 1_000 &&
    shouldAlert(`p95:${metric.method}:${metric.route}`, now)
  )
    alerts.push({
      code: "SLOW_ROUTE",
      method: metric.method,
      route: metric.route,
      message: "Route p95 is over 1 second.",
      value: metric.p95Ms,
    });
  return alerts;
}
