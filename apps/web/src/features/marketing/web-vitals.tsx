"use client";

import { useReportWebVitals } from "next/web-vitals";

// RUM for public pages only (07 §7): 10 % sample, metric name/value/rating + path — no PII, no
// cookies, no third parties. Sent with sendBeacon to a same-origin endpoint that logs it.
const SAMPLED = typeof Math !== "undefined" && Math.random() < 0.1;

export function WebVitals() {
  useReportWebVitals((metric) => {
    if (!SAMPLED || typeof navigator === "undefined" || !navigator.sendBeacon) return;
    const body = JSON.stringify({
      name: metric.name,
      value: Math.round(metric.value * 100) / 100,
      rating: metric.rating,
      path: window.location.pathname,
    });
    navigator.sendBeacon("/api/vitals", new Blob([body], { type: "application/json" }));
  });
  return null;
}
