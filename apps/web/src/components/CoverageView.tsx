import type { CoverageMakeGoodItem, OperatorCoverageSnapshot } from "@cleanops/shared";
import { AlertTriangle, CalendarCheck2, ClipboardList, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

type CoverageFilter = "active" | "due_today" | "overdue" | "open" | "scheduled" | "completed";

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function statusLabel(item: CoverageMakeGoodItem) {
  if (item.overdue) {
    return "overdue";
  }
  return item.status.replace(/_/g, " ");
}

function statusClass(item: CoverageMakeGoodItem) {
  if (item.overdue) {
    return "pill danger";
  }
  if (item.dueToday) {
    return "pill warn";
  }
  if (item.status === "completed") {
    return "pill";
  }
  return "pill";
}

export default function CoverageView({
  coverage,
  operationDate,
  onRefresh,
  refreshing
}: {
  coverage: OperatorCoverageSnapshot | null;
  operationDate: string;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  const [filter, setFilter] = useState<CoverageFilter>("active");
  const metrics = coverage?.metrics;
  const items = coverage?.items ?? [];

  const filtered = useMemo(() => {
    switch (filter) {
      case "due_today":
        return items.filter((item) => item.dueToday && item.status !== "completed");
      case "overdue":
        return items.filter((item) => item.overdue);
      case "open":
        return items.filter((item) => item.status === "open");
      case "scheduled":
        return items.filter((item) => item.status === "scheduled");
      case "completed":
        return items.filter((item) => item.status === "completed");
      case "active":
      default:
        return items.filter((item) => item.status === "open" || item.status === "scheduled");
    }
  }, [filter, items]);

  const coveragePct =
    metrics && metrics.stopsDueToday > 0
      ? Math.round((metrics.stopsCompletedToday / metrics.stopsDueToday) * 100)
      : null;

  return (
    <section className="panel-stack">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Coverage</p>
          <h2>Make-good &amp; daily coverage</h2>
          <p className="panel-subtitle">
            Open recoveries, SLA windows, and due-today vs completed stops for{" "}
            {formatDate(operationDate)}.
          </p>
        </div>
        <button className="secondary-button" disabled={refreshing} onClick={onRefresh} type="button">
          <RefreshCw aria-hidden="true" size={16} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <div className="metric-grid">
        <article className="metric-card">
          <ClipboardList aria-hidden="true" size={20} />
          <p className="eyebrow">Recoveries due today</p>
          <strong>{metrics?.dueToday ?? 0}</strong>
          <span className="metric-helper">{metrics?.completedToday ?? 0} completed today</span>
        </article>
        <article className="metric-card">
          <AlertTriangle aria-hidden="true" size={20} />
          <p className="eyebrow">Overdue make-goods</p>
          <strong>{metrics?.overdue ?? 0}</strong>
          <span className="metric-helper">
            {metrics?.open ?? 0} open · {metrics?.scheduled ?? 0} scheduled
          </span>
        </article>
        <article className="metric-card">
          <div className="metric-card-head">
            <CalendarCheck2 aria-hidden="true" size={20} />
            {coveragePct != null ? (
              <span
                aria-hidden="true"
                className="metric-ring"
                style={{ ["--ring-progress" as string]: `${coveragePct * 3.6}deg` }}
              >
                {coveragePct}%
              </span>
            ) : null}
          </div>
          <p className="eyebrow">Day coverage</p>
          <strong>
            {metrics?.stopsCompletedToday ?? 0}/{metrics?.stopsDueToday ?? 0}
          </strong>
          <span className="metric-helper">
            {coveragePct == null ? "No stops planned" : `${coveragePct}% completed`}
            {metrics?.makeGoodStopsToday
              ? ` · ${metrics.makeGoodStopsToday} make-good stop${metrics.makeGoodStopsToday === 1 ? "" : "s"}`
              : ""}
          </span>
          {(metrics?.stopsClosedForRecovery ?? 0) > 0 ? (
            <p className="metric-note">
              {metrics!.stopsClosedForRecovery} stop
              {metrics!.stopsClosedForRecovery === 1 ? " was" : "s were"} closed for recovery
              tomorrow — do not expect full day coverage
              {typeof metrics?.expectedCompletableToday === "number"
                ? ` (expect up to ${metrics.expectedCompletableToday}/${metrics.stopsDueToday})`
                : ""}
              .
            </p>
          ) : null}
        </article>
        <article className="metric-card">
          <RefreshCw aria-hidden="true" size={20} />
          <p className="eyebrow">Recent completions</p>
          <strong>{metrics?.completedRecent ?? 0}</strong>
          <span className="metric-helper">Completed in last 14 days</span>
        </article>
      </div>

      <div className="coverage-filter-row">
        {(
          [
            ["active", "Active"],
            ["due_today", "Due today"],
            ["overdue", "Overdue"],
            ["open", "Open"],
            ["scheduled", "Scheduled"],
            ["completed", "Completed"]
          ] as const
        ).map(([id, label]) => (
          <button
            className={filter === id ? "chip-button active" : "chip-button"}
            key={id}
            onClick={() => setFilter(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <article className="empty-panel">
          <CalendarCheck2 aria-hidden="true" size={22} />
          <div>
            <strong>No recoveries in this filter</strong>
            <p>Plan routes or close incomplete routes to open make-good obligations.</p>
          </div>
        </article>
      ) : (
        <div className="table-like coverage-list">
          {filtered.map((item) => (
            <article className="stack-row coverage-row" key={item.id}>
              <div>
                <div className="coverage-row-head">
                  <strong>{item.customerName}</strong>
                  <span className={statusClass(item)}>{statusLabel(item)}</span>
                </div>
                <p>
                  {item.zoneName} · missed {formatDate(item.sourceDate)}
                  {item.skipReason ? ` · ${item.skipReason}` : ""}
                </p>
              </div>
              <div>
                <p className="eyebrow">Target / SLA</p>
                <strong>{formatDate(item.targetDate)}</strong>
                <p>
                  Due by {formatDate(item.dueBy)}
                  {item.overdue ? (
                    <span className="inline-warn">
                      {" "}
                      <AlertTriangle aria-hidden="true" size={12} /> past SLA
                    </span>
                  ) : null}
                </p>
              </div>
              <div>
                <p className="eyebrow">Attempts</p>
                <strong>{item.attemptCount}</strong>
                <p>
                  {item.status === "completed"
                    ? `Completed ${formatDate(item.completedAt)}`
                    : item.dueToday
                      ? "Due on selected day"
                      : "Awaiting recovery"}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="muted coverage-footnote">
        <ClipboardList aria-hidden="true" size={14} /> Map and skip-trend analytics stay deferred;
        this board is the coverage list for open recoveries.
      </p>
    </section>
  );
}
