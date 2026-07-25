import type { RouteDetail, RouteStop } from "@cleanops/shared";
import { Building2, ChartNoAxesCombined, Leaf, Route as RouteIcon, Truck, Wallet } from "lucide-react";

function pickActiveRoutes(routes: RouteDetail[]): RouteDetail[] {
  return [...routes]
    .filter((route) => route.status !== "cancelled")
    .sort((a, b) => a.zoneName.localeCompare(b.zoneName));
}

function isResolvedStop(status: RouteStop["status"]) {
  return status === "completed" || status === "skipped" || status === "missed_reported";
}

function isCompletedStop(status: RouteStop["status"]) {
  return status === "completed";
}

function isSkippedStop(status: RouteStop["status"]) {
  return status === "skipped" || status === "missed_reported";
}

function nodeClassForStop(status: RouteStop["status"]) {
  if (isCompletedStop(status)) {
    return "route-monitor-node completed";
  }
  if (isSkippedStop(status)) {
    return "route-monitor-node skipped";
  }
  return "route-monitor-node remaining";
}

function estimateSlot(route: RouteDetail, stopSequence: number) {
  const base = route.startedAt
    ? new Date(route.startedAt)
    : new Date(`${route.scheduledDate}T08:00:00`);
  const minutes = Math.max(stopSequence - 1, 0) * 12;
  const slot = new Date(base.getTime() + minutes * 60_000);
  return slot.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Keep schematics readable when a ward has dozens/hundreds of stops. */
function sampleStopsForSchematic(stops: RouteStop[], maxNodes = 14): RouteStop[] {
  const ordered = [...stops].sort((a, b) => a.stopSequence - b.stopSequence);
  if (ordered.length <= maxNodes) {
    return ordered;
  }

  const indices = new Set<number>([0, ordered.length - 1]);
  const firstPending = ordered.findIndex((stop) => stop.status === "pending");
  if (firstPending >= 0) {
    for (let i = Math.max(0, firstPending - 2); i <= Math.min(ordered.length - 1, firstPending + 2); i += 1) {
      indices.add(i);
    }
  }

  const step = (ordered.length - 1) / (maxNodes - 1);
  for (let i = 0; i < maxNodes; i += 1) {
    indices.add(Math.round(i * step));
  }

  return [...indices]
    .sort((a, b) => a - b)
    .slice(0, maxNodes)
    .map((index) => ordered[index]);
}

function RouteProgressSchematic({
  stops,
  zoneName,
  gradientId
}: {
  stops: RouteStop[];
  zoneName: string;
  gradientId: string;
}) {
  const ordered = sampleStopsForSchematic(stops);
  const count = Math.max(ordered.length, 1);
  const width = 560;
  const height = 148;
  const padX = 36;
  const padY = 28;
  const usable = width - padX * 2;

  const points = ordered.map((stop, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const x = padX + usable * t;
    const y = padY + 48 + Math.sin(t * Math.PI) * 36 + (index % 2 === 0 ? -6 : 8);
    return {
      stop,
      x,
      y,
      resolved: isResolvedStop(stop.status)
    };
  });

  const pathD = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  const truckIndex = (() => {
    const firstPending = points.findIndex((point) => !point.resolved);
    if (firstPending === -1) {
      return points.length - 1;
    }
    return Math.max(firstPending - 1, 0);
  })();

  const truck = points[truckIndex];
  const firstPendingIndex = points.findIndex((point) => !point.resolved);
  const bridgeFrom = firstPendingIndex > 0 ? points[firstPendingIndex - 1] : null;
  const bridgeTo = firstPendingIndex >= 0 ? points[firstPendingIndex] : null;

  return (
    <svg
      aria-label={`Schematic route progress for ${zoneName}`}
      className="route-monitor-svg"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#d8eee0" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#eef5ef" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <rect fill={`url(#${gradientId})`} height={height} rx="14" width={width} />
      {pathD ? (
        <>
          <path className="route-monitor-path remaining" d={pathD} fill="none" />
          {points.map((point, index) => {
            if (index === 0 || !point.resolved) {
              return null;
            }
            const prev = points[index - 1];
            if (!prev?.resolved) {
              return null;
            }
            return (
              <line
                className="route-monitor-path completed"
                key={`seg-${point.stop.id}`}
                x1={prev.x}
                x2={point.x}
                y1={prev.y}
                y2={point.y}
              />
            );
          })}
          {bridgeFrom && bridgeTo ? (
            <line
              className="route-monitor-path advance"
              key={`advance-${bridgeFrom.stop.id}-${bridgeTo.stop.id}`}
              x1={bridgeFrom.x}
              x2={bridgeTo.x}
              y1={bridgeFrom.y}
              y2={bridgeTo.y}
            />
          ) : null}
        </>
      ) : null}
      {points.map((point) => (
        <g key={point.stop.id}>
          <circle
            className={nodeClassForStop(point.stop.status)}
            cx={point.x}
            cy={point.y}
            r="10"
          />
          <text className="route-monitor-node-label" textAnchor="middle" x={point.x} y={point.y + 3.5}>
            {point.stop.stopSequence}
          </text>
        </g>
      ))}
      {truck ? (
        <g className="route-monitor-truck" transform={`translate(${truck.x - 12} ${truck.y - 30})`}>
          <rect fill="#1a7f45" height="20" rx="5" width="24" />
          <rect fill="#146638" height="10" rx="3" width="9" x="18" y="5" />
          <circle cx="7" cy="20" fill="#102017" r="3" />
          <circle cx="18" cy="20" fill="#102017" r="3" />
        </g>
      ) : null}
    </svg>
  );
}

function WardProgressCard({
  route,
  onOpenRoutes
}: {
  route: RouteDetail;
  onOpenRoutes: (routeId?: string) => void;
}) {
  const orderedStops = [...route.stops].sort((a, b) => a.stopSequence - b.stopSequence);
  const completedCount = orderedStops.filter((stop) => isCompletedStop(stop.status)).length;
  const skippedCount = orderedStops.filter((stop) => isSkippedStop(stop.status)).length;
  const remainingCount = orderedStops.filter((stop) => stop.status === "pending").length;
  const total = Math.max(orderedStops.length, 1);
  const completedPct = Math.round((completedCount / total) * 100);
  const skippedPct = Math.round((skippedCount / total) * 100);
  const gradientId = `routeMonitorWash-${route.id}`;

  return (
    <article className="route-monitor-ward-card">
      <div className="route-monitor-ward-head">
        <div>
          <p className="eyebrow">{route.status.replace("_", " ")}</p>
          <h3>{route.zoneName}</h3>
          <p className="panel-subtitle">
            {route.driverName} · {route.truckRegistration}
          </p>
        </div>
        <button className="text-link-button" onClick={() => onOpenRoutes(route.id)} type="button">
          Open →
        </button>
      </div>

      <div className="route-monitor-progress-track" aria-hidden="true">
        <span className="completed" style={{ width: `${completedPct}%` }} />
        <span className="skipped" style={{ width: `${skippedPct}%` }} />
      </div>

      <RouteProgressSchematic
        gradientId={gradientId}
        stops={orderedStops}
        zoneName={route.zoneName}
      />

      <div className="route-monitor-legend compact">
        <span>
          <i className="legend-line completed" aria-hidden="true" /> {completedCount} done
        </span>
        <span>
          <i className="legend-dot skipped" aria-hidden="true" /> {skippedCount} skipped
        </span>
        <span>
          <i className="legend-line remaining" aria-hidden="true" /> {remainingCount} left
        </span>
      </div>
    </article>
  );
}

export default function DashboardRouteMonitor({
  routes,
  activeVehicleCount,
  onOpenRoutes
}: {
  routes: RouteDetail[];
  activeVehicleCount: number;
  onOpenRoutes: (routeId?: string) => void;
}) {
  const activeRoutes = pickActiveRoutes(routes);

  if (activeRoutes.length === 0) {
    return (
      <section className="route-monitor" aria-label="Route monitoring">
        <article className="panel route-monitor-empty">
          <RouteIcon aria-hidden="true" size={22} />
          <div>
            <strong>No route progress to show</strong>
            <p>Plan today&apos;s runs from Routes to populate the ward progress board.</p>
          </div>
          <button className="secondary-button" onClick={() => onOpenRoutes()} type="button">
            Open Routes
          </button>
        </article>
      </section>
    );
  }

  const totals = activeRoutes.reduce(
    (acc, route) => {
      for (const stop of route.stops) {
        if (isCompletedStop(stop.status)) {
          acc.completed += 1;
        } else if (isSkippedStop(stop.status)) {
          acc.skipped += 1;
        } else if (stop.status === "pending") {
          acc.remaining += 1;
        }
      }
      return acc;
    },
    { completed: 0, skipped: 0, remaining: 0 }
  );

  const nextStops = activeRoutes.flatMap((route) =>
    [...route.stops]
      .filter((stop) => stop.status === "pending")
      .sort((a, b) => a.stopSequence - b.stopSequence)
      .slice(0, 2)
      .map((stop) => ({ route, stop }))
  );

  return (
    <section className="route-monitor" aria-label="Route monitoring">
      <article className="panel route-monitor-map">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Route progress</p>
            <h2>All wards · {activeRoutes.length} active</h2>
            <p className="panel-subtitle">
              Concurrent day runs across the PSP fleet. Schematics sample stops when a ward is large.
            </p>
          </div>
          <RouteIcon aria-hidden="true" />
        </div>

        <div className="route-monitor-wards">
          {activeRoutes.map((route) => (
            <WardProgressCard key={route.id} onOpenRoutes={onOpenRoutes} route={route} />
          ))}
        </div>

        <div className="route-monitor-legend">
          <span>
            <i className="legend-line completed" aria-hidden="true" /> Completed ({totals.completed})
          </span>
          <span>
            <i className="legend-dot skipped" aria-hidden="true" /> Skipped ({totals.skipped})
          </span>
          <span>
            <i className="legend-line remaining" aria-hidden="true" /> Remaining ({totals.remaining})
          </span>
          <span>
            <Truck aria-hidden="true" size={14} /> Active vehicles ({activeVehicleCount})
          </span>
        </div>
      </article>

      <article className="panel route-monitor-next">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Next stops</p>
            <h2>Across {activeRoutes.length} wards</h2>
            <p className="panel-subtitle">Next two pending stops from each active ward run.</p>
          </div>
        </div>
        {nextStops.length === 0 ? (
          <p className="panel-subtitle">No pending stops on today&apos;s runs.</p>
        ) : (
          <div className="route-monitor-table multi-ward" role="table">
            <div className="route-monitor-table-head" role="row">
              <span role="columnheader">Ward</span>
              <span role="columnheader">#</span>
              <span role="columnheader">Location</span>
              <span role="columnheader">Est.</span>
            </div>
            {nextStops.map(({ route, stop }) => (
              <button
                className="route-monitor-table-row as-button"
                key={stop.id}
                onClick={() => onOpenRoutes(route.id)}
                role="row"
                type="button"
              >
                <span className="route-monitor-ward-chip" role="cell">
                  {route.zoneName}
                </span>
                <span className="route-monitor-stop-index" role="cell">
                  {stop.stopSequence}
                </span>
                <span role="cell">
                  <strong>{stop.customerName}</strong>
                  <small>
                    {route.truckRegistration} · {stop.address}
                  </small>
                </span>
                <span role="cell">{estimateSlot(route, stop.stopSequence)}</span>
              </button>
            ))}
          </div>
        )}
        <button className="text-link-button" onClick={() => onOpenRoutes()} type="button">
          View all route plans →
        </button>
      </article>
    </section>
  );
}

export function DashboardBrandFooter({
  brandName,
  operatorName,
  zoneHint
}: {
  brandName?: string | null;
  operatorName: string;
  zoneHint?: string | null;
}) {
  const org = brandName?.trim() || operatorName;

  return (
    <footer className="dashboard-brand-footer" aria-label="Operator mission">
      <div className="dashboard-brand-identity">
        <span className="dashboard-brand-icon" aria-hidden="true">
          <Building2 size={18} />
        </span>
        <div>
          <strong>{org}</strong>
          <small>
            Licensed PSP operator
            {zoneHint ? ` · ${zoneHint}` : ""}
          </small>
        </div>
      </div>
      <div className="dashboard-brand-pillars">
        <div>
          <ChartNoAxesCombined aria-hidden="true" size={16} />
          <strong>Data-driven ops</strong>
          <span>Decide from live day progress.</span>
        </div>
        <div>
          <RouteIcon aria-hidden="true" size={16} />
          <strong>Improve efficiency</strong>
          <span>Keep routes and crews moving.</span>
        </div>
        <div>
          <Wallet aria-hidden="true" size={16} />
          <strong>Increase revenue</strong>
          <span>Drive collections and compliance.</span>
        </div>
        <div>
          <Leaf aria-hidden="true" size={16} />
          <strong>Cleaner communities</strong>
          <span>Deliver a cleaner local ward.</span>
        </div>
      </div>
    </footer>
  );
}
