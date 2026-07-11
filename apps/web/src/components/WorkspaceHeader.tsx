import { RefreshCw } from "lucide-react";

export default function WorkspaceHeader({
  dateLabel,
  onDateChange,
  onRefresh,
  operationDate,
  refreshing,
  subtitle,
  title
}: {
  dateLabel: string;
  onDateChange: (nextDate: string) => void;
  onRefresh: () => void;
  operationDate: string;
  refreshing: boolean;
  subtitle?: string;
  title: string;
}) {
  return (
    <header className="workspace-header">
      <div>
        <p className="workspace-date-label">{dateLabel}</p>
        <h1 className="workspace-title">{title}</h1>
        {subtitle ? <p className="workspace-subtitle">{subtitle}</p> : null}
      </div>
      <div className="workspace-header-actions">
        <label className="workspace-date-field">
          <span className="sr-only">Operations date</span>
          <input onChange={(event) => onDateChange(event.target.value)} type="date" value={operationDate} />
        </label>
        <button
          aria-label={refreshing ? "Refreshing" : "Refresh data"}
          className="icon-button"
          disabled={refreshing}
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw aria-hidden="true" className={refreshing ? "spinning" : undefined} size={18} />
        </button>
      </div>
    </header>
  );
}
