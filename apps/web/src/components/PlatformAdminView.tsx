import {
  operatorPlanCodes,
  type CreateOperatorTenantResult,
  type OperatorPlanCode,
  type OperatorStatus,
  type PlatformOperator
} from "@cleanops/shared";
import { Building2, Shield } from "lucide-react";
import { FormEvent, useState } from "react";
import AdminModal from "./AdminModal";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function PlatformAdminView({
  onCreateOperator,
  onRefresh,
  onSetStatus,
  onSignOut,
  operators,
  platformName
}: {
  onCreateOperator: (input: {
    name: string;
    slug: string;
    brandName: string;
    planCode: OperatorPlanCode;
    ownerFullName: string;
    ownerEmail: string;
    ownerPhone: string;
    lawmaReference?: string;
  }) => Promise<CreateOperatorTenantResult>;
  onRefresh: () => Promise<void>;
  onSetStatus: (operatorId: string, status: OperatorStatus) => Promise<void>;
  onSignOut: () => void;
  operators: PlatformOperator[];
  platformName: string;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CreateOperatorTenantResult | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    brandName: "",
    planCode: "basic" as OperatorPlanCode,
    ownerFullName: "",
    ownerEmail: "",
    ownerPhone: "",
    lawmaReference: ""
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    try {
      const result = await onCreateOperator({
        name: form.name,
        slug: form.slug || slugify(form.name),
        brandName: form.brandName || form.name,
        planCode: form.planCode,
        ownerFullName: form.ownerFullName,
        ownerEmail: form.ownerEmail,
        ownerPhone: form.ownerPhone,
        lawmaReference: form.lawmaReference || undefined
      });
      setCredentials(result);
      setCreateOpen(false);
      setForm({
        name: "",
        slug: "",
        brandName: "",
        planCode: "basic",
        ownerFullName: "",
        ownerEmail: "",
        ownerPhone: "",
        lawmaReference: ""
      });
      await onRefresh();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to create operator");
    }
  }

  async function handleStatus(operatorId: string, status: OperatorStatus) {
    setBusyId(operatorId);
    try {
      await onSetStatus(operatorId, status);
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="app-shell app-shell-saas">
      <aside className="operator-sidebar">
        <div className="sidebar-brand">
          <strong className="sidebar-wordmark">CleanOps</strong>
          <span className="sidebar-tagline">Platform</span>
        </div>
        <nav aria-label="Platform sections" className="sidebar-nav">
          <button className="sidebar-nav-item active" type="button">
            <Building2 aria-hidden="true" size={18} />
            Operators
          </button>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user" style={{ cursor: "default" }}>
            <span className="avatar-chip" aria-hidden="true">
              <Shield size={14} />
            </span>
            <span>{platformName} · platform</span>
          </div>
          <button className="sidebar-nav-item" onClick={onSignOut} type="button">
            Sign out
          </button>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="workspace-header">
          <div>
            <p className="workspace-date-label">Platform administration</p>
            <h1 className="workspace-title">Operator tenants</h1>
            <p className="workspace-subtitle">
              Onboard independent PSP owners. Each tenant is isolated by operator_id.
            </p>
          </div>
          <div className="workspace-header-actions">
            <button className="primary-button" onClick={() => setCreateOpen(true)} type="button">
              Onboard operator
            </button>
          </div>
        </header>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Tenants</p>
              <h2>Operators</h2>
              <p className="panel-subtitle">{operators.length} operator{operators.length === 1 ? "" : "s"} on this platform.</p>
            </div>
          </div>

          <div className="admin-list">
            {operators.length === 0 ? (
              <p className="admin-empty">No operators yet. Onboard the first tenant.</p>
            ) : (
              operators.map((operator) => (
                <div className="admin-row" key={operator.id}>
                  <div className="admin-row-copy">
                    <strong>{operator.brandName || operator.name}</strong>
                    <span>
                      {operator.slug} · {operator.planCode} · {operator.ownerEmail ?? "No owner email"}
                    </span>
                    <small>
                      {operator.ownerFullName ? `${operator.ownerFullName} · ` : ""}
                      {operator.lawmaReference ?? "No LAWMA ref"}
                    </small>
                  </div>
                  <span className={`status-pill ${operator.status === "suspended" ? "danger" : "active"}`}>
                    {operator.status}
                  </span>
                  <div className="button-row admin-row-actions">
                    {operator.status === "suspended" ? (
                      <button
                        disabled={busyId === operator.id}
                        onClick={() => void handleStatus(operator.id, "active")}
                        type="button"
                      >
                        Reactivate
                      </button>
                    ) : (
                      <button
                        className="danger-outline"
                        disabled={busyId === operator.id}
                        onClick={() => void handleStatus(operator.id, "suspended")}
                        type="button"
                      >
                        Suspend
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </div>

      <AdminModal
        onClose={() => {
          setCreateOpen(false);
          setFormError(null);
        }}
        open={createOpen}
        subtitle="Creates an isolated operator tenant and owner login."
        title="Onboard operator"
      >
        <form className="entry-card admin-form admin-modal-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            Company name
            <input
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                  slug: current.slug || slugify(event.target.value),
                  brandName: current.brandName || event.target.value
                }))
              }
              required
              value={form.name}
            />
          </label>
          <label>
            Brand name
            <input
              onChange={(event) => setForm((current) => ({ ...current, brandName: event.target.value }))}
              required
              value={form.brandName}
            />
          </label>
          <label>
            Slug
            <input
              onChange={(event) => setForm((current) => ({ ...current, slug: slugify(event.target.value) }))}
              required
              value={form.slug}
            />
          </label>
          <label>
            Plan
            <select
              onChange={(event) =>
                setForm((current) => ({ ...current, planCode: event.target.value as OperatorPlanCode }))
              }
              value={form.planCode}
            >
              {operatorPlanCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Owner full name
            <input
              onChange={(event) => setForm((current) => ({ ...current, ownerFullName: event.target.value }))}
              required
              value={form.ownerFullName}
            />
          </label>
          <label>
            Owner email
            <input
              onChange={(event) => setForm((current) => ({ ...current, ownerEmail: event.target.value }))}
              required
              type="email"
              value={form.ownerEmail}
            />
          </label>
          <label>
            Owner phone
            <input
              onChange={(event) => setForm((current) => ({ ...current, ownerPhone: event.target.value }))}
              required
              value={form.ownerPhone}
            />
          </label>
          <label>
            LAWMA reference
            <input
              onChange={(event) => setForm((current) => ({ ...current, lawmaReference: event.target.value }))}
              value={form.lawmaReference}
            />
          </label>
          {formError ? <p className="notice error">{formError}</p> : null}
          <div className="button-row">
            <button className="primary-button" type="submit">
              Create tenant
            </button>
          </div>
        </form>
      </AdminModal>

      <AdminModal
        onClose={() => setCredentials(null)}
        open={Boolean(credentials)}
        subtitle="Share these credentials securely with the owner. The temporary password is shown once."
        title="Operator onboarded"
      >
        {credentials ? (
          <div className="entry-card admin-credentials-card">
            <p>
              <strong>{credentials.brandName}</strong> ({credentials.slug}) · {credentials.planCode}
            </p>
            <div className="credential-box">
              <span>{credentials.ownerEmail}</span>
              <span>{credentials.temporaryPassword}</span>
            </div>
            <div className="button-row">
              <button
                className="primary-button"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    `${credentials.ownerEmail}\n${credentials.temporaryPassword}`
                  );
                }}
                type="button"
              >
                Copy credentials
              </button>
            </div>
          </div>
        ) : null}
      </AdminModal>
    </main>
  );
}
