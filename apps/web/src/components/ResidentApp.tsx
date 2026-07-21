import {
  formatCollectionFrequency,
  serviceComplaintCategories,
  type ResidentHome,
  type ResidentPayment,
  type ServiceComplaint,
  type SubmitResidentComplaintInput
} from "@cleanops/shared";
import { LogOut, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import AdminModal from "./AdminModal";
import {
  getResidentHome,
  listMyPayments,
  listMyServiceComplaints,
  startResidentPaystackCheckout,
  submitResidentComplaint,
  verifyResidentPaystackPayment
} from "../data/residentService";

const currencyFormatter = new Intl.NumberFormat("en-NG", {
  currency: "NGN",
  maximumFractionDigits: 0,
  style: "currency"
});

function formatKobo(amountKobo: number) {
  return currencyFormatter.format(amountKobo / 100);
}

function labelize(value: string) {
  return value.replace(/_/g, " ");
}

function slaLabel(complaint: ServiceComplaint) {
  if (complaint.resolvedAt) {
    return `Resolved ${new Date(complaint.resolvedAt).toLocaleString("en-GB")}`;
  }
  if (complaint.slaBreached) {
    return "SLA breached — awaiting operator response";
  }
  return `24h response due ${new Date(complaint.slaDueAt).toLocaleString("en-GB")}`;
}

const emptyForm: SubmitResidentComplaintInput = {
  title: "",
  description: "",
  category: "missed_stop"
};

export default function ResidentApp({
  fullName,
  onSignOut
}: {
  fullName: string;
  onSignOut: () => void;
}) {
  const [home, setHome] = useState<ResidentHome | null>(null);
  const [complaints, setComplaints] = useState<ServiceComplaint[]>([]);
  const [payments, setPayments] = useState<ResidentPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [customAmountNaira, setCustomAmountNaira] = useState("");
  const [form, setForm] = useState<SubmitResidentComplaintInput>(emptyForm);
  const [paymentHistoryOpen, setPaymentHistoryOpen] = useState(false);
  const [complaintHistoryOpen, setComplaintHistoryOpen] = useState(false);

  async function loadPortal(isRefresh = false) {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [nextHome, nextComplaints, nextPayments] = await Promise.all([
        getResidentHome(),
        listMyServiceComplaints(),
        listMyPayments()
      ]);
      setHome(nextHome);
      setComplaints(nextComplaints);
      setPayments(nextPayments);
      if (!customAmountNaira && nextHome.outstandingKobo > 0) {
        setCustomAmountNaira(String(Math.round(nextHome.outstandingKobo / 100)));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load your account");
      setHome(null);
      setComplaints([]);
      setPayments([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    async function boot() {
      const params = new URLSearchParams(window.location.search);
      const paystackReturn = params.get("paystack") === "return";
      const reference = params.get("reference") ?? params.get("trxref");

      if (paystackReturn || reference) {
        params.delete("paystack");
        params.delete("reference");
        params.delete("trxref");
        const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
        window.history.replaceState({}, "", next);
      }

      await loadPortal();

      if (reference) {
        try {
          const verified = await verifyResidentPaystackPayment(reference);
          setNotice(
            verified.alreadyPosted
              ? `Payment ${formatKobo(verified.amountKobo)} was already recorded.`
              : `Payment ${formatKobo(verified.amountKobo)} confirmed and added to your account.`
          );
          await loadPortal(true);
        } catch (verifyError) {
          setError(
            verifyError instanceof Error
              ? verifyError.message
              : "Payment may have succeeded, but CleanOps could not confirm it yet. Try Refresh."
          );
        }
      } else if (paystackReturn) {
        setNotice("Returned from Paystack. If your balance is unchanged, tap Refresh in a moment.");
      }
    }

    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial boot + Paystack return only
  }, []);

  async function onSubmitComplaint(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      await submitResidentComplaint(form);
      setForm(emptyForm);
      setNotice("Complaint submitted. Your PSP aims to respond within 24 hours.");
      setComplaints(await listMyServiceComplaints());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit complaint");
    } finally {
      setSubmitting(false);
    }
  }

  async function onPay(amountKobo: number) {
    setPaying(true);
    setError(null);
    setNotice(null);

    try {
      const checkout = await startResidentPaystackCheckout({ amountKobo });
      window.location.assign(checkout.authorizationUrl);
    } catch (payError) {
      setError(payError instanceof Error ? payError.message : "Unable to start Paystack checkout");
      setPaying(false);
    }
  }

  if (loading) {
    return <main className="app-shell login-shell">Loading your CleanOps account...</main>;
  }

  const parsedCustomKobo = Math.round(Number(customAmountNaira || 0) * 100);
  const canPayCustom = Number.isFinite(parsedCustomKobo) && parsedCustomKobo >= 100;

  return (
    <main className="app-shell resident-shell">
      <header className="resident-topbar">
        <div>
          <p className="eyebrow">CleanOps Resident</p>
          <h1>{home?.psp.brandName ?? home?.psp.operatorName ?? "Your PSP"}</h1>
          <p className="resident-welcome">Signed in as {fullName}</p>
        </div>
        <div className="button-row">
          <button
            className="ghost-button"
            disabled={refreshing}
            onClick={() => void loadPortal(true)}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button className="ghost-button" onClick={onSignOut} type="button">
            <LogOut aria-hidden="true" size={16} />
            Sign out
          </button>
        </div>
      </header>

      {error ? <p className="notice error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      {home ? (
        <div className="resident-grid">
          <section className="resident-card resident-card-hero">
            <p className="eyebrow">Know Your PSP</p>
            <h2>{home.psp.brandName ?? home.psp.operatorName}</h2>
            <p>{home.psp.operatorName}</p>
            {home.psp.lawmaReference ? <p className="muted">LAWMA: {home.psp.lawmaReference}</p> : null}
            <p>
              <strong>Contact:</strong>{" "}
              {home.psp.primaryContactPhone ? (
                <a href={`tel:${home.psp.primaryContactPhone}`}>{home.psp.primaryContactPhone}</a>
              ) : (
                "Ask your operator for a contact number"
              )}
            </p>
            <div className="resident-truck-row">
              {home.zoneTrucks.length === 0 ? (
                <span className="pill">No zone trucks listed yet</span>
              ) : (
                home.zoneTrucks.map((truck) => (
                  <span className="pill" key={truck.registrationNumber}>
                    {truck.registrationNumber} · {truck.status}
                  </span>
                ))
              )}
            </div>
          </section>

          <section className="resident-card">
            <p className="eyebrow">Your collection schedule</p>
            <h2>{home.zoneName}</h2>
            <p className="resident-metric">
              {formatCollectionFrequency(home.collectionsPerWeek, home.preferredWeekdays)}
            </p>
            <p>{home.address}</p>
            {home.frequencyNotes ? <p className="muted">{home.frequencyNotes}</p> : null}
            <span className={`pill ${home.serviceStatus === "suspended" ? "danger" : ""}`}>
              Service {home.serviceStatus}
            </span>
            {home.suspensionReason ? <p className="inline-error">{home.suspensionReason}</p> : null}
            {home.makeGood?.active ? (
              <p className="notice" style={{ marginTop: 12 }}>
                Your appointed collection was missed
                {home.makeGood.sourceDate
                  ? ` on ${new Date(home.makeGood.sourceDate).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric"
                    })}`
                  : ""}
                . A subsequent collection is being planned
                {home.makeGood.targetDate
                  ? ` for ${new Date(home.makeGood.targetDate).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric"
                    })}`
                  : home.makeGood.dueBy
                    ? ` (target by ${new Date(home.makeGood.dueBy).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric"
                      })})`
                    : ""}
                .
              </p>
            ) : null}
          </section>

          <section className="resident-card">
            <p className="eyebrow">This month&apos;s account</p>
            <h2>{formatKobo(home.outstandingKobo)}</h2>
            <p>Outstanding · rate {formatKobo(home.monthlyRateKobo)}</p>
            <p>Paid this month: {formatKobo(home.paidThisMonthKobo)}</p>
            {home.lastPaymentAt ? (
              <p className="muted">
                Last payment {formatKobo(home.lastPaymentAmountKobo ?? 0)}
                {home.lastPaymentChannel ? ` via ${labelize(home.lastPaymentChannel)}` : ""} ·{" "}
                {new Date(home.lastPaymentAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric"
                })}
              </p>
            ) : (
              <p className="muted">No payments recorded this account yet.</p>
            )}
            <div className="resident-pay-box">
              <label>
                Amount (naira)
                <input
                  inputMode="decimal"
                  min="1"
                  onChange={(event) => setCustomAmountNaira(event.target.value)}
                  step="1"
                  type="number"
                  value={customAmountNaira}
                />
              </label>
              <div className="button-row">
                {home.outstandingKobo >= 100 ? (
                  <button
                    className="secondary-button"
                    disabled={paying}
                    onClick={() => void onPay(home.outstandingKobo)}
                    type="button"
                  >
                    Pay outstanding
                  </button>
                ) : null}
                <button
                  className="primary-button"
                  disabled={paying || !canPayCustom}
                  onClick={() => void onPay(parsedCustomKobo)}
                  type="button"
                >
                  {paying ? "Opening Paystack..." : "Pay with Paystack"}
                </button>
              </div>
              <button
                className="ghost-button"
                onClick={() => setPaymentHistoryOpen(true)}
                type="button"
              >
                View payment history ({payments.length})
              </button>
            </div>
          </section>

          <section className="resident-card resident-card-wide">
            <p className="eyebrow">Report a service issue</p>
            <h2>Missed collection &amp; complaints</h2>
            <p className="muted">
              Your report opens a 24-hour SLA ticket for {home.psp.brandName ?? home.psp.operatorName}.
            </p>
            <form className="resident-complaint-form" onSubmit={(event) => void onSubmitComplaint(event)}>
              <label>
                Issue type
                <select
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      category: event.target.value as SubmitResidentComplaintInput["category"]
                    }))
                  }
                  value={form.category}
                >
                  {serviceComplaintCategories.map((category) => (
                    <option key={category} value={category}>
                      {labelize(category)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Short title
                <input
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="e.g. Missed Monday collection"
                  required
                  value={form.title}
                />
              </label>
              <label>
                What happened
                <textarea
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="Include the date you expected collection and any overflow risk."
                  required
                  rows={4}
                  value={form.description}
                />
              </label>
              <div className="button-row">
                <button className="primary-button" disabled={submitting} type="submit">
                  {submitting ? "Submitting..." : "Submit complaint"}
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setComplaintHistoryOpen(true)}
                  type="button"
                >
                  View complaint history ({complaints.length})
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <AdminModal
        onClose={() => setPaymentHistoryOpen(false)}
        open={paymentHistoryOpen}
        subtitle={`${payments.length} payment(s) on this account`}
        title="Payment history"
      >
        {payments.length === 0 ? (
          <p className="muted">Agent cash, operator, and Paystack payments for your account appear here.</p>
        ) : (
          <div className="resident-complaint-list">
            {payments.map((payment) => (
              <article className="resident-complaint-item" key={payment.id}>
                <div className="resident-complaint-item-head">
                  <strong>{formatKobo(payment.amountKobo)}</strong>
                  <span className="pill">{labelize(payment.channel)}</span>
                </div>
                <p className="muted">
                  {new Date(payment.paidAt).toLocaleString("en-GB")}
                  {payment.externalReference ? ` · ${payment.externalReference}` : ""}
                </p>
              </article>
            ))}
          </div>
        )}
      </AdminModal>

      <AdminModal
        onClose={() => setComplaintHistoryOpen(false)}
        open={complaintHistoryOpen}
        subtitle={`${complaints.length} complaint(s) reported`}
        title="Complaint history"
      >
        {complaints.length === 0 ? (
          <p className="muted">Submitted issues will appear here with status and SLA timing.</p>
        ) : (
          <div className="resident-complaint-list">
            {complaints.map((complaint) => (
              <article className="resident-complaint-item" key={complaint.id}>
                <div className="resident-complaint-item-head">
                  <strong>{complaint.title}</strong>
                  <span
                    className={`pill ${complaint.slaBreached && !complaint.resolvedAt ? "danger" : ""}`}
                  >
                    {labelize(complaint.status)}
                  </span>
                </div>
                <p className="muted">
                  {labelize(complaint.category)} · {slaLabel(complaint)}
                </p>
                <p>{complaint.description}</p>
                {complaint.resolutionNotes ? (
                  <p className="resident-resolution">
                    <strong>Operator note:</strong> {complaint.resolutionNotes}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </AdminModal>
    </main>
  );
}
