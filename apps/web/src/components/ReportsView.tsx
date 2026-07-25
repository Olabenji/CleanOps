import type { OperatorReportsSnapshot } from "@cleanops/shared";
import {
  CalendarRange,
  ClipboardList,
  Download,
  FileBarChart2,
  MapPinned,
  MessageSquareWarning,
  RefreshCw,
  Scale,
  Truck,
  WalletCards
} from "lucide-react";
import { useState } from "react";
import { downloadCsv } from "../data/reportsService";

type ReportTab = "finance" | "coverage" | "disposal" | "service";

function formatKobo(kobo: number) {
  return new Intl.NumberFormat("en-NG", {
    currency: "NGN",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(kobo / 100);
}

function formatTonnes(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toLocaleString("en-NG", { maximumFractionDigits: 2 })} t`;
}

function monthStart(date: string) {
  return `${date.slice(0, 8)}01`;
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function labelize(value: string) {
  return value.replace(/_/g, " ");
}

function coverageBarWidth(percent: number) {
  return `${Math.max(0, Math.min(100, percent))}%`;
}

export default function ReportsView({
  operationDate,
  onLoad,
  refreshing,
  reports
}: {
  operationDate: string;
  onLoad: (fromDate: string, toDate: string) => Promise<void>;
  refreshing?: boolean;
  reports: OperatorReportsSnapshot | null;
}) {
  const [fromDate, setFromDate] = useState(() => monthStart(operationDate));
  const [toDate, setToDate] = useState(operationDate);
  const [tab, setTab] = useState<ReportTab>("finance");
  const summary = reports?.summary;
  const lawma = reports?.lawmaSummary;
  const wardCoverage = reports?.wardCoverage ?? [];
  const disposalTips = reports?.disposalTips ?? [];
  const complaints = reports?.serviceComplaints ?? [];
  const makeGoods = reports?.makeGoods ?? [];
  const rangeLabel = reports ? `${reports.fromDate} → ${reports.toDate}` : `${fromDate} → ${toDate}`;

  async function handleRefresh() {
    await onLoad(fromDate, toDate);
  }

  function applyPreset(preset: "month" | "7d" | "30d") {
    const end = operationDate;
    if (preset === "month") {
      setFromDate(monthStart(end));
      setToDate(end);
      return;
    }
    setFromDate(addDays(end, preset === "7d" ? -6 : -29));
    setToDate(end);
  }

  function exportCollections() {
    if (!reports) {
      return;
    }
    downloadCsv(
      `cleanops-collections-${reports.fromDate}-to-${reports.toDate}.csv`,
      ["paidAt", "customerName", "channel", "amountKobo", "externalReference", "collectedBy"],
      reports.collections.map((row) => [
        row.paidAt,
        row.customerName,
        row.channel,
        row.amountKobo,
        row.externalReference ?? "",
        row.collectedBy ?? ""
      ])
    );
  }

  function exportAttendance() {
    if (!reports) {
      return;
    }
    downloadCsv(
      `cleanops-attendance-${reports.fromDate}-to-${reports.toDate}.csv`,
      ["checkedInAt", "staffName", "role", "supervisorOverride", "dayPayrollEstimateKobo", "notes"],
      reports.attendance.map((row) => [
        row.checkedInAt,
        row.staffName,
        row.role,
        row.supervisorOverride,
        row.dayPayrollEstimateKobo,
        row.notes ?? ""
      ])
    );
  }

  function exportFleet() {
    if (!reports) {
      return;
    }
    downloadCsv(
      `cleanops-fleet-costs-${reports.fromDate}-to-${reports.toDate}.csv`,
      ["occurredAt", "costType", "label", "detail", "amountKobo"],
      reports.fleetCosts.map((row) => [
        row.occurredAt ?? "",
        row.costType,
        row.label,
        row.detail ?? "",
        row.amountKobo
      ])
    );
  }

  function exportSummary() {
    if (!reports) {
      return;
    }
    downloadCsv(
      `cleanops-pnl-${reports.fromDate}-to-${reports.toDate}.csv`,
      ["metric", "amountKobo"],
      [
        ["collections", reports.summary.collectionsKobo],
        ["payrollEstimate", reports.summary.payrollEstimateKobo],
        ["fuelSpend", reports.summary.fuelSpendKobo],
        ["maintenanceSpend", reports.summary.maintenanceSpendKobo],
        ["tippingFees", reports.summary.tippingFeesKobo],
        ["opsCost", reports.summary.opsCostKobo],
        ["net", reports.summary.netKobo]
      ]
    );
  }

  function exportWardCoverage() {
    if (!reports) {
      return;
    }
    downloadCsv(
      `cleanops-ward-coverage-${reports.fromDate}-to-${reports.toDate}.csv`,
      [
        "wardName",
        "stopsPlanned",
        "stopsCompleted",
        "stopsMissed",
        "makeGoodStops",
        "coveragePercent"
      ],
      wardCoverage.map((row) => [
        row.wardName,
        row.stopsPlanned,
        row.stopsCompleted,
        row.stopsMissed,
        row.makeGoodStops,
        row.coveragePercent
      ])
    );
  }

  function exportDisposal() {
    if (!reports) {
      return;
    }
    downloadCsv(
      `cleanops-disposal-tips-${reports.fromDate}-to-${reports.toDate}.csv`,
      [
        "occurredAt",
        "wardName",
        "truckRegistration",
        "dumpsiteSiteName",
        "docketNumber",
        "weighbridgeTonnes",
        "tippingFeeKobo",
        "cleared"
      ],
      disposalTips.map((row) => [
        row.occurredAt ?? "",
        row.wardName ?? "",
        row.truckRegistration ?? "",
        row.dumpsiteSiteName ?? "",
        row.docketNumber ?? "",
        row.weighbridgeTonnes ?? "",
        row.tippingFeeKobo,
        row.cleared
      ])
    );
  }

  function exportComplaints() {
    if (!reports) {
      return;
    }
    downloadCsv(
      `cleanops-complaints-${reports.fromDate}-to-${reports.toDate}.csv`,
      [
        "createdAt",
        "category",
        "title",
        "status",
        "wardName",
        "customerName",
        "slaDueAt",
        "resolvedAt",
        "slaBreached"
      ],
      complaints.map((row) => [
        row.createdAt,
        row.category,
        row.title,
        row.status,
        row.wardName ?? "",
        row.customerName ?? "",
        row.slaDueAt,
        row.resolvedAt ?? "",
        row.slaBreached
      ])
    );
  }

  function exportMakeGoods() {
    if (!reports) {
      return;
    }
    downloadCsv(
      `cleanops-make-goods-${reports.fromDate}-to-${reports.toDate}.csv`,
      [
        "customerName",
        "wardName",
        "status",
        "sourceDate",
        "targetDate",
        "dueBy",
        "attemptCount",
        "openedAt",
        "completedAt",
        "skipReason"
      ],
      makeGoods.map((row) => [
        row.customerName,
        row.wardName,
        row.status,
        row.sourceDate,
        row.targetDate,
        row.dueBy,
        row.attemptCount,
        row.openedAt,
        row.completedAt ?? "",
        row.skipReason ?? ""
      ])
    );
  }

  return (
    <section className="panel-stack reports-view">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Reports</p>
          <h2>Ops finance &amp; LAWMA evidence</h2>
          <p className="panel-subtitle">
            Period summaries for internal P&amp;L and service evidence packs. CSV exports stay available
            for finance and compliance handoff — not an official LAWMA portal submission.
          </p>
        </div>
        <span className="reports-range-chip">
          <CalendarRange aria-hidden="true" size={16} />
          {rangeLabel}
        </span>
      </header>

      <div className="entry-card reports-period-card">
        <div className="reports-period-head">
          <div>
            <h3>Report period</h3>
            <p className="muted">Presets use the operations date as the end of range.</p>
          </div>
          <div className="coverage-filter-row" role="group" aria-label="Period presets">
            <button className="chip-button" onClick={() => applyPreset("month")} type="button">
              This month
            </button>
            <button className="chip-button" onClick={() => applyPreset("7d")} type="button">
              Last 7 days
            </button>
            <button className="chip-button" onClick={() => applyPreset("30d")} type="button">
              Last 30 days
            </button>
          </div>
        </div>
        <div className="reports-period-controls">
          <label>
            From
            <input onChange={(event) => setFromDate(event.target.value)} type="date" value={fromDate} />
          </label>
          <label>
            To
            <input onChange={(event) => setToDate(event.target.value)} type="date" value={toDate} />
          </label>
          <button
            className="primary-button"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            {refreshing ? "Loading…" : "Load reports"}
          </button>
        </div>
      </div>

      <nav aria-label="Report sections" className="admin-tabs payment-subtabs">
        {(
          [
            ["finance", "Finance"],
            ["coverage", "Ward coverage"],
            ["disposal", "Disposal / tonnage"],
            ["service", "Complaints & make-good"]
          ] as const
        ).map(([id, label]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {!reports ? (
        <div className="empty-panel">
          <FileBarChart2 aria-hidden="true" size={22} />
          <div>
            <strong>No report loaded yet</strong>
            <p>Choose a period and load to preview metrics and export CSVs.</p>
          </div>
        </div>
      ) : null}

      {reports && tab === "finance" ? (
        <>
          <div className="metric-grid reports-metric-grid">
            <article className="metric-card">
              <div className="metric-card-head">
                <WalletCards aria-hidden="true" size={20} />
              </div>
              <p className="eyebrow">Collections</p>
              <strong>{formatKobo(summary?.collectionsKobo ?? 0)}</strong>
              <span className="metric-helper">{reports.collections.length} payments</span>
            </article>
            <article className="metric-card">
              <div className="metric-card-head">
                <Truck aria-hidden="true" size={20} />
              </div>
              <p className="eyebrow">Ops cost</p>
              <strong>{formatKobo(summary?.opsCostKobo ?? 0)}</strong>
              <span className="metric-helper">
                Payroll {formatKobo(summary?.payrollEstimateKobo ?? 0)} · fuel{" "}
                {formatKobo(summary?.fuelSpendKobo ?? 0)}
              </span>
            </article>
            <article className="metric-card">
              <div className="metric-card-head">
                <FileBarChart2 aria-hidden="true" size={20} />
              </div>
              <p className="eyebrow">Net</p>
              <strong>{formatKobo(summary?.netKobo ?? 0)}</strong>
              <span className="metric-helper">
                Maint {formatKobo(summary?.maintenanceSpendKobo ?? 0)} · tip{" "}
                {formatKobo(summary?.tippingFeesKobo ?? 0)}
              </span>
            </article>
          </div>

          <article className="panel reports-section">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Finance</p>
                <h3>P&amp;L and cost detail</h3>
                <p className="panel-subtitle">
                  Internal operator view: collections vs payroll estimate, fuel, maintenance, and tipping
                  fees for the selected period.
                </p>
              </div>
              <div className="reports-export-row">
                <button className="secondary-button" onClick={exportSummary} type="button">
                  <Download aria-hidden="true" size={16} />
                  P&amp;L CSV
                </button>
                <button className="secondary-button" onClick={exportCollections} type="button">
                  <Download aria-hidden="true" size={16} />
                  Collections
                </button>
                <button className="secondary-button" onClick={exportAttendance} type="button">
                  <Download aria-hidden="true" size={16} />
                  Attendance
                </button>
                <button className="secondary-button" onClick={exportFleet} type="button">
                  <Download aria-hidden="true" size={16} />
                  Fleet costs
                </button>
              </div>
            </div>

            <div className="reports-breakdown">
              <div>
                <span>Collections</span>
                <strong>{formatKobo(reports.summary.collectionsKobo)}</strong>
              </div>
              <div>
                <span>Payroll estimate</span>
                <strong>{formatKobo(reports.summary.payrollEstimateKobo)}</strong>
              </div>
              <div>
                <span>Fuel</span>
                <strong>{formatKobo(reports.summary.fuelSpendKobo)}</strong>
              </div>
              <div>
                <span>Maintenance</span>
                <strong>{formatKobo(reports.summary.maintenanceSpendKobo)}</strong>
              </div>
              <div>
                <span>Tipping fees</span>
                <strong>{formatKobo(reports.summary.tippingFeesKobo)}</strong>
              </div>
              <div className="reports-breakdown-net">
                <span>Net</span>
                <strong>{formatKobo(reports.summary.netKobo)}</strong>
              </div>
            </div>

            <div className="reports-preview-grid">
              <section>
                <h4>Collections preview</h4>
                {reports.collections.length === 0 ? (
                  <p className="muted">No payments in range.</p>
                ) : (
                  <div className="reports-table-wrap">
                    <table className="reports-table">
                      <thead>
                        <tr>
                          <th>Customer</th>
                          <th>Channel</th>
                          <th>Amount</th>
                          <th>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.collections.slice(0, 8).map((row) => (
                          <tr key={row.paymentId}>
                            <td>{row.customerName}</td>
                            <td>{row.channel}</td>
                            <td>{formatKobo(row.amountKobo)}</td>
                            <td>{new Date(row.paidAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section>
                <h4>Attendance preview</h4>
                {reports.attendance.length === 0 ? (
                  <p className="muted">No check-ins in range.</p>
                ) : (
                  <div className="reports-table-wrap">
                    <table className="reports-table">
                      <thead>
                        <tr>
                          <th>Staff</th>
                          <th>Role</th>
                          <th>Day estimate</th>
                          <th>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.attendance.slice(0, 8).map((row) => (
                          <tr key={row.attendanceId}>
                            <td>{row.staffName}</td>
                            <td>{labelize(row.role)}</td>
                            <td>{formatKobo(row.dayPayrollEstimateKobo)}</td>
                            <td>{new Date(row.checkedInAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section>
                <h4>Fleet costs preview</h4>
                {reports.fleetCosts.length === 0 ? (
                  <p className="muted">No fuel, maintenance, or tipping costs in range.</p>
                ) : (
                  <div className="reports-table-wrap">
                    <table className="reports-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Label</th>
                          <th>Amount</th>
                          <th>When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.fleetCosts.slice(0, 8).map((row) => (
                          <tr key={`${row.costType}-${row.id}`}>
                            <td>{row.costType}</td>
                            <td>{row.label}</td>
                            <td>{formatKobo(row.amountKobo)}</td>
                            <td>
                              {row.occurredAt ? new Date(row.occurredAt).toLocaleString() : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </article>
        </>
      ) : null}

      {reports && tab === "coverage" ? (
        <>
          <div className="metric-grid reports-metric-grid">
            <article className="metric-card">
              <MapPinned aria-hidden="true" size={20} />
              <p className="eyebrow">Coverage</p>
              <strong>{lawma?.coveragePercent ?? 0}%</strong>
              <span className="metric-helper">
                {lawma?.stopsCompleted ?? 0} of {lawma?.stopsPlanned ?? 0} stops completed
              </span>
            </article>
            <article className="metric-card">
              <ClipboardList aria-hidden="true" size={20} />
              <p className="eyebrow">Missed / skipped</p>
              <strong>{lawma?.stopsMissed ?? 0}</strong>
              <span className="metric-helper">Stops marked skipped or missed in range</span>
            </article>
            <article className="metric-card">
              <RefreshCw aria-hidden="true" size={20} />
              <p className="eyebrow">Open make-goods</p>
              <strong>{lawma?.makeGoodsOpenNow ?? 0}</strong>
              <span className="metric-helper">Still open or scheduled recoveries</span>
            </article>
          </div>

          <article className="panel reports-section">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Service coverage</p>
                <h3>Collection coverage by ward</h3>
                <p className="panel-subtitle">
                  Planned vs completed route stops by ward for the period. Useful for monthly service
                  performance packs and missed-collection follow-up.
                </p>
              </div>
              <button
                className="secondary-button"
                disabled={wardCoverage.length === 0}
                onClick={exportWardCoverage}
                type="button"
              >
                <Download aria-hidden="true" size={16} />
                Coverage CSV
              </button>
            </div>

            {wardCoverage.length === 0 ? (
              <p className="muted">No route stops in this period.</p>
            ) : (
              <div className="reports-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>Ward</th>
                      <th>Planned</th>
                      <th>Completed</th>
                      <th>Missed</th>
                      <th>Make-good stops</th>
                      <th>Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wardCoverage.map((row) => (
                      <tr key={row.wardId}>
                        <td>
                          <strong>{row.wardName}</strong>
                        </td>
                        <td>{row.stopsPlanned}</td>
                        <td>{row.stopsCompleted}</td>
                        <td>{row.stopsMissed}</td>
                        <td>{row.makeGoodStops}</td>
                        <td>
                          <div className="reports-coverage-cell">
                            <div className="reports-coverage-track" aria-hidden="true">
                              <span
                                className="reports-coverage-fill"
                                style={{ width: coverageBarWidth(row.coveragePercent) }}
                              />
                            </div>
                            <span>{row.coveragePercent}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </>
      ) : null}

      {reports && tab === "disposal" ? (
        <>
          <div className="metric-grid reports-metric-grid">
            <article className="metric-card">
              <Scale aria-hidden="true" size={20} />
              <p className="eyebrow">Weighbridge tonnes</p>
              <strong>{formatTonnes(lawma?.weighbridgeTonnes)}</strong>
              <span className="metric-helper">Sum of recorded tip tickets in range</span>
            </article>
            <article className="metric-card">
              <Truck aria-hidden="true" size={20} />
              <p className="eyebrow">Disposal tips</p>
              <strong>{lawma?.disposalTips ?? 0}</strong>
              <span className="metric-helper">
                {lawma?.tipsWithDocket ?? 0} with docket number
              </span>
            </article>
            <article className="metric-card">
              <FileBarChart2 aria-hidden="true" size={20} />
              <p className="eyebrow">Docket coverage</p>
              <strong>
                {lawma && lawma.disposalTips > 0
                  ? `${Math.round((lawma.tipsWithDocket / lawma.disposalTips) * 100)}%`
                  : "—"}
              </strong>
              <span className="metric-helper">Tips that include a disposal receipt</span>
            </article>
          </div>

          <article className="panel reports-section">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Disposal evidence</p>
                <h3>Dumpsite tips &amp; tonnage</h3>
                <p className="panel-subtitle">
                  Disposal runs with site, docket, and weighbridge tonnes from field logs — core LAWMA
                  P1 disposal evidence already captured in CleanOps.
                </p>
              </div>
              <button
                className="secondary-button"
                disabled={disposalTips.length === 0}
                onClick={exportDisposal}
                type="button"
              >
                <Download aria-hidden="true" size={16} />
                Disposal CSV
              </button>
            </div>

            {disposalTips.length === 0 ? (
              <p className="muted">No dumpsite runs recorded in this period.</p>
            ) : (
              <div className="reports-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Ward / truck</th>
                      <th>Site</th>
                      <th>Docket</th>
                      <th>Tonnes</th>
                      <th>Fee</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disposalTips.slice(0, 40).map((row) => (
                      <tr key={row.runId}>
                        <td>
                          {row.occurredAt ? new Date(row.occurredAt).toLocaleString() : "—"}
                        </td>
                        <td>
                          <strong>{row.wardName ?? "—"}</strong>
                          <div className="muted">{row.truckRegistration ?? "No truck"}</div>
                        </td>
                        <td>{row.dumpsiteSiteName ?? "—"}</td>
                        <td>{row.docketNumber ?? "—"}</td>
                        <td>{formatTonnes(row.weighbridgeTonnes)}</td>
                        <td>{formatKobo(row.tippingFeeKobo)}</td>
                        <td>
                          <span className={`pill ${row.cleared ? "" : "warn"}`}>
                            {row.cleared ? "Cleared" : "In progress"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </>
      ) : null}

      {reports && tab === "service" ? (
        <>
          <div className="metric-grid reports-metric-grid">
            <article className="metric-card">
              <MessageSquareWarning aria-hidden="true" size={20} />
              <p className="eyebrow">Complaints opened</p>
              <strong>{lawma?.complaintsOpened ?? 0}</strong>
              <span className="metric-helper">
                {lawma?.complaintsResolved ?? 0} resolved · {lawma?.complaintsSlaBreached ?? 0} SLA
                breached
              </span>
            </article>
            <article className="metric-card">
              <RefreshCw aria-hidden="true" size={20} />
              <p className="eyebrow">Make-goods opened</p>
              <strong>{lawma?.makeGoodsOpened ?? 0}</strong>
              <span className="metric-helper">
                {lawma?.makeGoodsCompleted ?? 0} completed in period
              </span>
            </article>
            <article className="metric-card">
              <ClipboardList aria-hidden="true" size={20} />
              <p className="eyebrow">Still open</p>
              <strong>{lawma?.makeGoodsOpenNow ?? 0}</strong>
              <span className="metric-helper">Open or scheduled recoveries (any age)</span>
            </article>
          </div>

          <article className="panel reports-section">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Customer service</p>
                <h3>Complaints (24h SLA)</h3>
                <p className="panel-subtitle">
                  Service complaints logged in the period with SLA status. Aligns with LAWMA P1
                  complaint-response evidence already tracked under Compliance.
                </p>
              </div>
              <button
                className="secondary-button"
                disabled={complaints.length === 0}
                onClick={exportComplaints}
                type="button"
              >
                <Download aria-hidden="true" size={16} />
                Complaints CSV
              </button>
            </div>

            {complaints.length === 0 ? (
              <p className="muted">No complaints created in this period.</p>
            ) : (
              <div className="reports-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Category</th>
                      <th>Ward / customer</th>
                      <th>Status</th>
                      <th>SLA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complaints.slice(0, 40).map((row) => (
                      <tr key={row.complaintId}>
                        <td>
                          <strong>{row.title}</strong>
                          <div className="muted">{new Date(row.createdAt).toLocaleString()}</div>
                        </td>
                        <td>{labelize(row.category)}</td>
                        <td>
                          {row.wardName ?? "—"}
                          <div className="muted">{row.customerName ?? "No customer"}</div>
                        </td>
                        <td>{labelize(row.status)}</td>
                        <td>
                          <span className={`pill ${row.slaBreached && !row.resolvedAt ? "danger" : ""}`}>
                            {row.resolvedAt
                              ? "Resolved"
                              : row.slaBreached
                                ? "Breached"
                                : `Due ${new Date(row.slaDueAt).toLocaleString()}`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="panel reports-section">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Recovery</p>
                <h3>Missed stops &amp; make-good</h3>
                <p className="panel-subtitle">
                  Unserviced recoveries opened or completed in the period, plus any still-open items.
                  Supports weekly pickup obligation tracking.
                </p>
              </div>
              <button
                className="secondary-button"
                disabled={makeGoods.length === 0}
                onClick={exportMakeGoods}
                type="button"
              >
                <Download aria-hidden="true" size={16} />
                Make-good CSV
              </button>
            </div>

            {makeGoods.length === 0 ? (
              <p className="muted">No make-good recoveries for this period.</p>
            ) : (
              <div className="reports-table-wrap">
                <table className="reports-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Ward</th>
                      <th>Status</th>
                      <th>Source → target</th>
                      <th>Attempts</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {makeGoods.slice(0, 40).map((row) => (
                      <tr key={row.makeGoodId}>
                        <td>
                          <strong>{row.customerName}</strong>
                        </td>
                        <td>{row.wardName}</td>
                        <td>
                          <span
                            className={`pill ${
                              row.status === "open" || row.status === "scheduled" ? "warn" : ""
                            }`}
                          >
                            {labelize(row.status)}
                          </span>
                        </td>
                        <td>
                          {row.sourceDate} → {row.targetDate}
                          <div className="muted">Due {row.dueBy}</div>
                        </td>
                        <td>{row.attemptCount}</td>
                        <td>{row.skipReason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </>
      ) : null}
    </section>
  );
}
