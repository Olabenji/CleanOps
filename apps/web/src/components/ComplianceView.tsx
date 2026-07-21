import type {
  BillDelivery,
  ComplianceCase,
  CustomerLedgerItem,
  ServiceComplaint,
  VehicleBrandingChecklist
} from "@cleanops/shared";
import {
  complianceCaseTypes,
  serviceComplaintCategories,
  type CreateComplianceCaseInput,
  type CreateServiceComplaintInput,
  type RecordBillDeliveryInput,
  type RecordVehicleBrandingChecklistInput
} from "@cleanops/shared";
import { AlertTriangle, ClipboardCheck, MessageSquareWarning, WalletCards } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

type ComplianceTab = "complaints" | "compliance" | "bills" | "checklists";

const CHECKLIST_ITEMS = [
  ["wardInscriptionOk", "Ward inscription"],
  ["phoneDisplayedOk", "Phone displayed"],
  ["colourCodingOk", "Colour coding"],
  ["amberLightOk", "Amber light"],
  ["nettingOrTarpaulinOk", "Netting / tarpaulin"],
  ["gangPpeOk", "Gang PPE"]
] as const;

function formatKobo(amountKobo: number) {
  return `₦${(amountKobo / 100).toLocaleString("en-NG")}`;
}

function labelize(value: string) {
  return value.replace(/_/g, " ");
}

function slaLabel(complaint: ServiceComplaint) {
  if (complaint.resolvedAt) {
    return "Resolved";
  }
  if (complaint.slaBreached) {
    return "SLA breached";
  }
  return `Due ${new Date(complaint.slaDueAt).toLocaleString("en-GB")}`;
}

export default function ComplianceView({
  billDeliveries,
  billPeriodStart,
  checklists,
  complaints,
  complianceCases,
  customerLedger,
  onCreateComplaint,
  onCreateComplianceCase,
  onRecordBillDelivery,
  onRecordChecklist,
  onUpdateComplaintStatus,
  onUpdateComplianceStatus,
  trucks
}: {
  billDeliveries: BillDelivery[];
  billPeriodStart: string;
  checklists: VehicleBrandingChecklist[];
  complaints: ServiceComplaint[];
  complianceCases: ComplianceCase[];
  customerLedger: CustomerLedgerItem[];
  onCreateComplaint: (input: CreateServiceComplaintInput) => Promise<void>;
  onCreateComplianceCase: (input: CreateComplianceCaseInput) => Promise<void>;
  onRecordBillDelivery: (input: RecordBillDeliveryInput) => Promise<void>;
  onRecordChecklist: (input: RecordVehicleBrandingChecklistInput) => Promise<void>;
  onUpdateComplaintStatus: (
    id: string,
    status: ServiceComplaint["status"],
    notes?: string
  ) => Promise<void>;
  onUpdateComplianceStatus: (
    id: string,
    status: ComplianceCase["status"],
    notes?: string
  ) => Promise<void>;
  trucks: Array<{ id: string; registrationNumber: string }>;
}) {
  const [tab, setTab] = useState<ComplianceTab>("complaints");
  const [error, setError] = useState<string | null>(null);
  const [complaintForm, setComplaintForm] = useState({
    title: "",
    description: "",
    category: "missed_stop" as CreateServiceComplaintInput["category"],
    customerId: ""
  });
  const [caseForm, setCaseForm] = useState({
    title: "",
    description: "",
    caseType: "illegal_dumping" as CreateComplianceCaseInput["caseType"],
    customerId: ""
  });
  const [billForm, setBillForm] = useState({
    customerId: "",
    amountNaira: "",
    note: ""
  });
  const [checklistForm, setChecklistForm] = useState({
    truckId: "",
    wardInscriptionOk: true,
    phoneDisplayedOk: true,
    colourCodingOk: true,
    amberLightOk: true,
    nettingOrTarpaulinOk: true,
    gangPpeOk: true,
    notes: ""
  });

  const openComplaints = complaints.filter((item) => !item.resolvedAt);
  const breached = openComplaints.filter((item) => item.slaBreached).length;
  const openCases = complianceCases.filter((item) => item.status !== "closed");

  async function submitComplaint(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onCreateComplaint({
        title: complaintForm.title,
        description: complaintForm.description,
        category: complaintForm.category,
        source: "operator",
        customerId: complaintForm.customerId || null
      });
      setComplaintForm({ title: "", description: "", category: "missed_stop", customerId: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create complaint");
    }
  }

  async function submitCase(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onCreateComplianceCase({
        caseType: caseForm.caseType,
        title: caseForm.title,
        description: caseForm.description,
        customerId: caseForm.customerId || null
      });
      setCaseForm({ title: "", description: "", caseType: "illegal_dumping", customerId: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create compliance case");
    }
  }

  async function submitBill(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onRecordBillDelivery({
        customerId: billForm.customerId,
        billPeriodStart,
        amountKobo: Math.round(Number(billForm.amountNaira || 0) * 100),
        status: "delivered",
        deliveryNote: billForm.note || null
      });
      setBillForm({ customerId: "", amountNaira: "", note: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record bill delivery");
    }
  }

  async function submitChecklist(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onRecordChecklist({
        truckId: checklistForm.truckId,
        wardInscriptionOk: checklistForm.wardInscriptionOk,
        phoneDisplayedOk: checklistForm.phoneDisplayedOk,
        colourCodingOk: checklistForm.colourCodingOk,
        amberLightOk: checklistForm.amberLightOk,
        nettingOrTarpaulinOk: checklistForm.nettingOrTarpaulinOk,
        gangPpeOk: checklistForm.gangPpeOk,
        notes: checklistForm.notes || null
      });
      setChecklistForm((current) => ({ ...current, truckId: "", notes: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record checklist");
    }
  }

  return (
    <>
      <nav aria-label="Compliance sections" className="admin-tabs payment-subtabs compliance-tabs">
        {(
          [
            ["complaints", "Complaints"],
            ["compliance", "Compliance cases"],
            ["bills", "Bill delivery"],
            ["checklists", "Vehicle / PPE"]
          ] as const
        ).map(([id, label]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => {
              setTab(id);
              setError(null);
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {error ? <p className="inline-error compliance-error">{error}</p> : null}

      <section className="workflow-grid routes-workflow compliance-workflow">
        <article className="panel">
          {tab === "complaints" ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Inbox</p>
                  <h2>Service complaints</h2>
                  <p className="panel-subtitle">
                    {openComplaints.length} open · {breached} past 24h SLA
                  </p>
                </div>
                <MessageSquareWarning aria-hidden="true" />
              </div>
              <div className="stack-list">
                {complaints.length === 0 ? (
                  <p className="admin-empty">
                    <AlertTriangle aria-hidden="true" size={16} /> No complaints logged yet.
                  </p>
                ) : null}
                {complaints.map((complaint) => (
                  <div className="admin-row admin-row-stack" key={complaint.id}>
                    <div className="admin-row-copy">
                      <div className="admin-row-head">
                        <strong>{complaint.title}</strong>
                        <span
                          className={`pill ${complaint.slaBreached && !complaint.resolvedAt ? "danger" : ""}`}
                        >
                          {complaint.status}
                        </span>
                      </div>
                      <span>
                        {labelize(complaint.category)} · {complaint.customerName ?? "No customer"}
                      </span>
                      <span>{slaLabel(complaint)}</span>
                      <small>{complaint.description}</small>
                    </div>
                    {!complaint.resolvedAt ? (
                      <div className="button-row admin-row-actions">
                        {complaint.status === "open" ? (
                          <button
                            onClick={() => void onUpdateComplaintStatus(complaint.id, "acknowledged")}
                            type="button"
                          >
                            Acknowledge
                          </button>
                        ) : null}
                        <button
                          onClick={() =>
                            void onUpdateComplaintStatus(complaint.id, "resolved", "Resolved in ops")
                          }
                          type="button"
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => void onUpdateComplaintStatus(complaint.id, "escalated")}
                          type="button"
                        >
                          Escalate
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {tab === "compliance" ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Evidence log</p>
                  <h2>Compliance cases</h2>
                  <p className="panel-subtitle">
                    {openCases.length} open · {complianceCases.length} total
                  </p>
                </div>
                <AlertTriangle aria-hidden="true" />
              </div>
              <div className="stack-list">
                {complianceCases.length === 0 ? (
                  <p className="admin-empty">
                    <AlertTriangle aria-hidden="true" size={16} /> No compliance cases yet.
                  </p>
                ) : null}
                {complianceCases.map((item) => (
                  <div className="admin-row admin-row-stack" key={item.id}>
                    <div className="admin-row-copy">
                      <div className="admin-row-head">
                        <strong>{item.title}</strong>
                        <span className="pill">{item.status}</span>
                      </div>
                      <span>
                        {labelize(item.caseType)} · {item.customerName ?? "Unlinked"}
                      </span>
                      <small>{item.description}</small>
                    </div>
                    {item.status !== "closed" ? (
                      <div className="button-row admin-row-actions">
                        <button
                          onClick={() =>
                            void onUpdateComplianceStatus(item.id, "closed", "Closed after review")
                          }
                          type="button"
                        >
                          Close
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {tab === "bills" ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Bill period</p>
                  <h2>{billPeriodStart}</h2>
                  <p className="panel-subtitle">
                    {billDeliveries.length} delivery record(s) this period
                  </p>
                </div>
                <WalletCards aria-hidden="true" />
              </div>
              <div className="stack-list">
                {billDeliveries.length === 0 ? (
                  <p className="admin-empty">
                    <AlertTriangle aria-hidden="true" size={16} /> No bill deliveries recorded for this
                    period.
                  </p>
                ) : null}
                {billDeliveries.map((item) => (
                  <div className="admin-row" key={item.id}>
                    <div className="admin-row-copy">
                      <strong>{item.customerName}</strong>
                      <div className="admin-row-meta">
                        <span>
                          {formatKobo(item.amountKobo)}
                          {item.deliveredAt
                            ? ` · ${new Date(item.deliveredAt).toLocaleString("en-GB")}`
                            : ""}
                        </span>
                        <span className="pill">{item.status}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {tab === "checklists" ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Dispatch gate</p>
                  <h2>Vehicle / PPE checks</h2>
                  <p className="panel-subtitle">{checklists.length} recorded for this operations date</p>
                </div>
                <ClipboardCheck aria-hidden="true" />
              </div>
              <div className="stack-list">
                {checklists.length === 0 ? (
                  <p className="admin-empty">
                    <AlertTriangle aria-hidden="true" size={16} /> No checklists for this operations date
                    yet.
                  </p>
                ) : null}
                {checklists.map((item) => (
                  <div className="admin-row" key={item.id}>
                    <div className="admin-row-copy">
                      <strong>{item.truckRegistration}</strong>
                      <div className="admin-row-meta">
                        <span>
                          {item.checkedByName ?? "Staff"} ·{" "}
                          {new Date(item.checkedAt).toLocaleString("en-GB")}
                        </span>
                        <span className={`pill ${item.passed ? "" : "danger"}`}>
                          {item.passed ? "Passed" : "Gaps"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </article>

        <article className="panel">
          {tab === "complaints" ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">New entry</p>
                  <h2>Log complaint</h2>
                  <p className="panel-subtitle">Opens a 24-hour SLA ticket for the operator team</p>
                </div>
              </div>
              <form className="entry-card admin-form" onSubmit={(event) => void submitComplaint(event)}>
                <label>
                  Title
                  <input
                    onChange={(event) => setComplaintForm((c) => ({ ...c, title: event.target.value }))}
                    required
                    value={complaintForm.title}
                  />
                </label>
                <label>
                  Category
                  <select
                    onChange={(event) =>
                      setComplaintForm((c) => ({
                        ...c,
                        category: event.target.value as CreateServiceComplaintInput["category"]
                      }))
                    }
                    value={complaintForm.category}
                  >
                    {serviceComplaintCategories.map((category) => (
                      <option key={category} value={category}>
                        {labelize(category)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-form-full">
                  Customer (optional)
                  <select
                    onChange={(event) =>
                      setComplaintForm((c) => ({ ...c, customerId: event.target.value }))
                    }
                    value={complaintForm.customerId}
                  >
                    <option value="">No customer link</option>
                    {customerLedger.map((customer) => (
                      <option key={customer.customerId} value={customer.customerId}>
                        {customer.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="admin-form-full">
                  Description
                  <textarea
                    onChange={(event) =>
                      setComplaintForm((c) => ({ ...c, description: event.target.value }))
                    }
                    required
                    rows={4}
                    value={complaintForm.description}
                  />
                </label>
                <button className="primary-button" type="submit">
                  Log complaint
                </button>
              </form>
            </>
          ) : null}

          {tab === "compliance" ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">New entry</p>
                  <h2>Open case</h2>
                  <p className="panel-subtitle">Illegal dump, skeletal service, and audit defence</p>
                </div>
              </div>
              <form className="entry-card admin-form" onSubmit={(event) => void submitCase(event)}>
                <label>
                  Case type
                  <select
                    onChange={(event) =>
                      setCaseForm((c) => ({
                        ...c,
                        caseType: event.target.value as CreateComplianceCaseInput["caseType"]
                      }))
                    }
                    value={caseForm.caseType}
                  >
                    {complianceCaseTypes.map((type) => (
                      <option key={type} value={type}>
                        {labelize(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Title
                  <input
                    onChange={(event) => setCaseForm((c) => ({ ...c, title: event.target.value }))}
                    required
                    value={caseForm.title}
                  />
                </label>
                <label className="admin-form-full">
                  Description
                  <textarea
                    onChange={(event) => setCaseForm((c) => ({ ...c, description: event.target.value }))}
                    required
                    rows={4}
                    value={caseForm.description}
                  />
                </label>
                <button className="primary-button" type="submit">
                  Open case
                </button>
              </form>
            </>
          ) : null}

          {tab === "bills" ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">New entry</p>
                  <h2>Mark bill delivered</h2>
                  <p className="panel-subtitle">Agent acknowledgement for the current bill cycle</p>
                </div>
              </div>
              <form className="entry-card admin-form" onSubmit={(event) => void submitBill(event)}>
                <label className="admin-form-full">
                  Customer
                  <select
                    onChange={(event) => setBillForm((c) => ({ ...c, customerId: event.target.value }))}
                    required
                    value={billForm.customerId}
                  >
                    <option value="">Select customer</option>
                    {customerLedger.map((customer) => (
                      <option key={customer.customerId} value={customer.customerId}>
                        {customer.displayName} · {formatKobo(customer.monthlyRateKobo)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount (naira)
                  <input
                    min="0"
                    onChange={(event) => setBillForm((c) => ({ ...c, amountNaira: event.target.value }))}
                    required
                    type="number"
                    value={billForm.amountNaira}
                  />
                </label>
                <label>
                  Delivery note
                  <input
                    onChange={(event) => setBillForm((c) => ({ ...c, note: event.target.value }))}
                    value={billForm.note}
                  />
                </label>
                <button className="primary-button" type="submit">
                  Mark bill delivered
                </button>
              </form>
            </>
          ) : null}

          {tab === "checklists" ? (
            <>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">New entry</p>
                  <h2>Vehicle branding &amp; PPE</h2>
                  <p className="panel-subtitle">Inspection checklist before dispatch</p>
                </div>
              </div>
              <form
                className="entry-card compliance-checklist-form"
                onSubmit={(event) => void submitChecklist(event)}
              >
                <label>
                  Truck
                  <select
                    onChange={(event) =>
                      setChecklistForm((c) => ({ ...c, truckId: event.target.value }))
                    }
                    required
                    value={checklistForm.truckId}
                  >
                    <option value="">Select truck</option>
                    {trucks.map((truck) => (
                      <option key={truck.id} value={truck.id}>
                        {truck.registrationNumber}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="compliance-checklist-fieldset">
                  <legend>Checklist items</legend>
                  <div className="compliance-checklist-grid">
                    {CHECKLIST_ITEMS.map(([key, label]) => (
                      <label className="weekday-option" key={key}>
                        <input
                          checked={checklistForm[key]}
                          onChange={(event) =>
                            setChecklistForm((c) => ({ ...c, [key]: event.target.checked }))
                          }
                          type="checkbox"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label>
                  Notes (optional)
                  <input
                    onChange={(event) => setChecklistForm((c) => ({ ...c, notes: event.target.value }))}
                    value={checklistForm.notes}
                  />
                </label>
                <button className="primary-button" type="submit">
                  Save checklist
                </button>
              </form>
            </>
          ) : null}
        </article>
      </section>
    </>
  );
}
