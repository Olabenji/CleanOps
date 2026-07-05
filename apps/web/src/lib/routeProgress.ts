import type { RouteDetail } from "@cleanops/shared";

export function deriveRouteProgress(route: RouteDetail): RouteDetail {
  if (route.status === "cancelled") {
    return route;
  }

  const pendingCount = route.stops.filter((stop) => stop.status === "pending").length;
  const resolvedStops = route.stops.length - pendingCount;
  const resolvedTimestamps = route.stops
    .filter((stop) => stop.status !== "pending" && stop.completedAt)
    .map((stop) => stop.completedAt as string)
    .sort();

  const firstResolvedAt = resolvedTimestamps[0] ?? null;
  const lastResolvedAt = resolvedTimestamps[resolvedTimestamps.length - 1] ?? null;

  let status = route.status;
  let startedAt = route.startedAt;
  let completedAt = route.completedAt;

  if (route.stops.length > 0 && pendingCount === 0) {
    status = "completed";
    startedAt = startedAt ?? firstResolvedAt;
    completedAt = completedAt ?? lastResolvedAt ?? firstResolvedAt;
  } else if (resolvedStops > 0) {
    if (status === "scheduled" || status === "completed") {
      status = "in_progress";
    }

    startedAt = startedAt ?? firstResolvedAt;
    if (pendingCount > 0) {
      completedAt = null;
    }
  }

  return {
    ...route,
    status,
    startedAt,
    completedAt,
    completedStops: resolvedStops,
    totalStops: route.stops.length,
    delayed: status === "in_progress" && resolvedStops / Math.max(route.stops.length, 1) < 0.35
  };
}
