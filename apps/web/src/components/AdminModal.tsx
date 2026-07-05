import type { ReactNode } from "react";

export default function AdminModal({
  children,
  onClose,
  open,
  subtitle,
  title
}: {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
  subtitle?: string;
  title: string;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="admin-modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby="admin-modal-title"
        aria-modal="true"
        className="admin-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="admin-modal-header">
          <div>
            <h3 id="admin-modal-title">{title}</h3>
            {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
