import AdminModal from "./AdminModal";

export function TemplatePendingBanner({
  labels,
  tempName,
  onTempNameChange,
  onSaveZoneDefault,
  onSaveTemporary,
  onDiscard,
  busy
}: {
  labels: string[];
  tempName: string;
  onTempNameChange: (value: string) => void;
  onSaveZoneDefault: () => void;
  onSaveTemporary: () => void;
  onDiscard: () => void;
  busy?: boolean;
}) {
  if (labels.length === 0) {
    return null;
  }

  const summary =
    labels.length === 1
      ? `${labels[0]} has unsaved plan changes.`
      : `${labels.length} routes have unsaved plan changes (${labels.join(", ")}).`;

  return (
    <aside className="template-pending-banner" aria-live="polite">
      <div>
        <p className="eyebrow">Pending template decision</p>
        <strong>{summary}</strong>
        <p>
          Keep iterating on today&apos;s plan. When you are ready, save to the ward default, save a temporary template, or
          discard these template updates.
        </p>
        <label>
          Temporary template name
          <input
            disabled={busy}
            onChange={(event) => onTempNameChange(event.target.value)}
            placeholder="Optional name for temp save"
            value={tempName}
          />
        </label>
      </div>
      <div className="button-row">
        <button className="primary-button" disabled={busy} onClick={onSaveZoneDefault} type="button">
          Save to ward template{labels.length > 1 ? "s" : ""}
        </button>
        <button disabled={busy} onClick={onSaveTemporary} type="button">
          Save as temp template{labels.length > 1 ? "s" : ""}
        </button>
        <button className="ghost-button" disabled={busy} onClick={onDiscard} type="button">
          Discard
        </button>
      </div>
    </aside>
  );
}

export default function TemplateSavePrompt({
  open,
  leaveReason,
  labels,
  tempName,
  onTempNameChange,
  onSaveZoneDefault,
  onSaveTemporary,
  onDiscardAndContinue,
  onStay,
  busy
}: {
  open: boolean;
  leaveReason: "signout" | "navigate" | "date";
  labels: string[];
  tempName: string;
  onTempNameChange: (value: string) => void;
  onSaveZoneDefault: () => void;
  onSaveTemporary: () => void;
  onDiscardAndContinue: () => void;
  onStay: () => void;
  busy?: boolean;
}) {
  const leaveLabel =
    leaveReason === "signout"
      ? "sign out"
      : leaveReason === "date"
        ? "change operations date"
        : "leave this section";

  return (
    <AdminModal
      onClose={onStay}
      open={open}
      subtitle={`You still have unsaved route plan changes. Choose what to do before you ${leaveLabel}.`}
      title="Unsaved template changes"
    >
      <div className="stack-list template-save-prompt">
        <p className="panel-subtitle">
          Pending: {labels.length === 0 ? "route plan edits" : labels.join(", ")}. Ward templates become the daily
          default. Temporary templates keep a one-off plan without replacing the ward default.
        </p>
        <label>
          Temporary template name
          <input
            disabled={busy}
            onChange={(event) => onTempNameChange(event.target.value)}
            placeholder="Optional name"
            value={tempName}
          />
        </label>
        <div className="button-row">
          <button className="primary-button" disabled={busy} onClick={onSaveZoneDefault} type="button">
            Save to ward template{labels.length > 1 ? "s" : ""} and continue
          </button>
          <button disabled={busy} onClick={onSaveTemporary} type="button">
            Save as temp and continue
          </button>
          <button disabled={busy} onClick={onDiscardAndContinue} type="button">
            Discard and continue
          </button>
          <button className="ghost-button" disabled={busy} onClick={onStay} type="button">
            Stay here
          </button>
        </div>
      </div>
    </AdminModal>
  );
}
