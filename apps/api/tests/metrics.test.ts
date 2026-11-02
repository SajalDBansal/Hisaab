import { expect, test } from "bun:test";
import {
  recordRequest,
  metricsSnapshot,
  metricAlerts,
  metricsText,
} from "../src/lib/metrics";

test("percentiles use recent samples while counters remain cumulative", () => {
  for (let durationMs = 1; durationMs <= 1_200; durationMs++)
    recordRequest({
      method: "GET",
      route: "/sample",
      statusCode: durationMs <= 60 ? 500 : 200,
      durationMs,
    });
  expect(
    metricsSnapshot().find((row) => row.route === "/sample"),
  ).toMatchObject({
    count: 1_200,
    errors: 60,
    errorRate: 0.05,
    avgMs: 600.5,
    p50Ms: 700,
    p95Ms: 1_150,
    p99Ms: 1_190,
  });
  expect(metricsText()).toContain(
    'hisaab_http_requests_total{method="GET",route="/sample"} 1200',
  );
});

test("alerts check only the affected route and preserve cooldown", () => {
  const route = { method: "POST", route: "/slow" };
  for (let i = 0; i < 20; i++)
    recordRequest({ ...route, statusCode: 500, durationMs: 2_000 });
  expect(metricAlerts({ method: "GET", route: "/health" }, 0)).toEqual([]);
  expect(metricAlerts(route, 0).map((alert) => alert.code)).toEqual([
    "HIGH_ERROR_RATE",
    "SLOW_ROUTE",
  ]);
  expect(metricAlerts(route, 299_999)).toEqual([]);
  expect(metricAlerts(route, 300_000)).toHaveLength(2);
});

test("checking one route avoids full aggregation with 120 populated routes", () => {
  for (let route = 0; route < 120; route++)
    for (let i = 0; i < 1_000; i++)
      recordRequest({
        method: "GET",
        route: `/benchmark/${route}`,
        statusCode: 200,
        durationMs: (i * 7919) % 2000,
      });
  const start = performance.now();
  for (let i = 0; i < 100; i++)
    metricAlerts({ method: "GET", route: "/benchmark/0" });
  const affectedMs = (performance.now() - start) / 100;
  const fullStart = performance.now();
  for (let i = 0; i < 20; i++) metricsSnapshot();
  const fullMs = (performance.now() - fullStart) / 20;
  expect(affectedMs).toBeLessThan(fullMs / 5);
});
