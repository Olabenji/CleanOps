import type { OperatorCommsSnapshot } from "@cleanops/shared";
import { MessageSquare, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";

function formatKobo(kobo: number) {
  return new Intl.NumberFormat("en-NG", {
    currency: "NGN",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(kobo / 100);
}

function labelize(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  return value.replace(/_/g, " ");
}

export default function CommsView({
  busy,
  comms,
  onDispatch,
  onQueueReminders,
  onRefresh,
  onSendReminders,
  refreshing
}: {
  busy?: boolean;
  comms: OperatorCommsSnapshot | null;
  onDispatch: () => Promise<void>;
  onQueueReminders: (daysBeforeDue: 2 | 5, force: boolean) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSendReminders: (daysBeforeDue: 2 | 5, force: boolean) => Promise<void>;
  refreshing?: boolean;
}) {
  const [forceOutsideWindow, setForceOutsideWindow] = useState(false);
  const metrics = comms?.metrics;
  const preview5 = comms?.reminderPreview5;
  const preview2 = comms?.reminderPreview2;
  const recent = comms?.recent ?? [];

  return (
    <section className="panel-stack">
      <article className="panel">
        <div className="panel-header-row">
          <div>
            <p className="eyebrow">Resident messaging</p>
            <h2>Comms</h2>
            <p className="panel-subtitle">
              WhatsApp reminders, receipts, and suspension notices via Twilio, with Termii SMS
              fallback. Messages queue to the outbox; flush them when provider secrets are set.
            </p>
          </div>
          <button
            className="secondary-button"
            disabled={refreshing || busy}
            onClick={() => void onRefresh()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            Refresh
          </button>
        </div>

        <div className="reports-metric-grid">
          <div className="metric-card">
            <span>Queued</span>
            <strong>{metrics?.queued ?? 0}</strong>
          </div>
          <div className="metric-card">
            <span>Sent today</span>
            <strong>{metrics?.sentToday ?? 0}</strong>
          </div>
          <div className="metric-card">
            <span>Failed</span>
            <strong>{metrics?.failed ?? 0}</strong>
          </div>
          <div className="metric-card">
            <span>Open reminders</span>
            <strong>{metrics?.remindersQueued ?? 0}</strong>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="panel-header-row">
          <div>
            <h3>Payment reminders</h3>
            <p className="panel-subtitle">
              Due date is month-end. 5-day and 2-day windows target residents with an outstanding
              monthly tag and a valid Nigerian phone number.
            </p>
          </div>
          <label className="inline-check">
            <input
              checked={forceOutsideWindow}
              onChange={(event) => setForceOutsideWindow(event.target.checked)}
              type="checkbox"
            />
            Force queue outside window
          </label>
        </div>

        <div className="comms-reminder-grid">
          {[preview5, preview2].map((preview) => {
            if (!preview) {
              return null;
            }
            const days = preview.daysBeforeDue as 2 | 5;
            return (
              <div className="comms-reminder-card" key={days}>
                <div className="coverage-row-head">
                  <strong>{days}-day reminder</strong>
                  <span className={`pill ${preview.windowMatchesToday ? "" : "warn"}`}>
                    {preview.windowMatchesToday ? "Window is today" : `Window ${preview.targetDate}`}
                  </span>
                </div>
                <p>
                  Due {preview.dueDate} · {preview.candidates.length} candidate
                  {preview.candidates.length === 1 ? "" : "s"}
                </p>
                <div className="button-row">
                  <button
                    className="secondary-button"
                    disabled={busy || preview.candidates.length === 0}
                    onClick={() => void onQueueReminders(days, forceOutsideWindow)}
                    type="button"
                  >
                    <MessageSquare aria-hidden="true" size={16} />
                    Queue only
                  </button>
                  <button
                    className="primary-button"
                    disabled={busy || preview.candidates.length === 0}
                    onClick={() => void onSendReminders(days, forceOutsideWindow)}
                    type="button"
                  >
                    <Send aria-hidden="true" size={16} />
                    Queue &amp; send
                  </button>
                </div>
                {preview.candidates.length > 0 ? (
                  <div className="reports-table-wrap">
                    <table className="reports-table">
                      <thead>
                        <tr>
                          <th>Customer</th>
                          <th>Ward</th>
                          <th>Outstanding</th>
                          <th>Phone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.candidates.slice(0, 8).map((row) => (
                          <tr key={row.customerId}>
                            <td>{row.customerName}</td>
                            <td>{row.wardName ?? "—"}</td>
                            <td>{formatKobo(row.outstandingKobo)}</td>
                            <td>{row.phoneE164 ?? row.phone ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {preview.candidates.length > 8 ? (
                      <p className="panel-subtitle">
                        Showing 8 of {preview.candidates.length} candidates.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="empty-panel">No outstanding residents with valid phones.</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="button-row" style={{ marginTop: 16 }}>
          <button
            className="primary-button"
            disabled={busy || (metrics?.queued ?? 0) === 0}
            onClick={() => void onDispatch()}
            type="button"
          >
            <Send aria-hidden="true" size={16} />
            Flush message queue
          </button>
          <p className="panel-subtitle" style={{ margin: 0 }}>
            Requires Twilio and/or Termii secrets on the Edge Function runtime. Receipts and
            suspension notices auto-queue when payments post or a customer is suspended.
          </p>
        </div>
      </article>

      <article className="panel">
        <div className="panel-header-row">
          <div>
            <h3>Recent message outbox</h3>
            <p className="panel-subtitle">WhatsApp / SMS attempts for this operator.</p>
          </div>
        </div>

        {recent.length === 0 ? (
          <p className="empty-panel">No messaging outbox rows yet.</p>
        ) : (
          <div className="reports-table-wrap">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Customer</th>
                  <th>Kind</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>
                      <strong>{row.customerName}</strong>
                      <div className="panel-subtitle">{row.wardName ?? "—"}</div>
                    </td>
                    <td>{labelize(row.kind)}</td>
                    <td>{labelize(row.channelUsed ?? row.channel)}</td>
                    <td>
                      <span
                        className={`pill ${
                          row.status === "failed" ? "danger" : row.status === "sent" ? "" : "warn"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td>
                      {row.lastError ? (
                        <span className="inline-warn">
                          <TriangleAlert aria-hidden="true" size={14} /> {row.lastError}
                        </span>
                      ) : (
                        row.title ?? "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
