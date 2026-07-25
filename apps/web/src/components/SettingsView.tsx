import type {
  CustomerImportFieldKey,
  CustomerImportPreviewRow,
  CustomerImportResult,
  OperatorZoneTemplatesSnapshot,
  ZoneRouteTemplate,
  ZoneTemplateCustomer
} from "@cleanops/shared";
import {
  buildImportPreview,
  customerImportFieldKeys,
  customerImportFieldLabels,
  formatCollectionFrequency,
  guessColumnMapping,
  parseDelimitedTable,
  previewRowsToImportRows
} from "@cleanops/shared";
import {
  ArrowDown,
  ArrowUp,
  FileSpreadsheet,
  MapPinned,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
  Upload
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

type DraftTemplate = {
  zoneId: string;
  truckId: string;
  driverId: string;
  stopIds: string[];
};

type SettingsTab = "templates" | "import";

function toDraft(zone: ZoneRouteTemplate): DraftTemplate {
  const templateStopIds = zone.stops.map((stop) => stop.customerId);
  // If the template is empty, seed from active customers already in the ward.
  const stopIds =
    templateStopIds.length > 0
      ? templateStopIds
      : zone.availableCustomers.map((customer) => customer.customerId);

  return {
    zoneId: zone.zoneId,
    truckId: zone.truckId ?? "",
    driverId: zone.driverId ?? "",
    stopIds
  };
}

const SAMPLE_CSV = [
  "display_name,phone,address,ward,customer_type,monthly_rate_ngn,collections_per_week,preferred_weekdays",
  "Ada Okoro,08031234567,12 Broad Street Lagos,Ward A,residential,3500,1,Mon",
  "Bisi Foods,08039876543,5 Market Road Lagos,Ward B,restaurant,12000,3,\"Mon,Wed,Fri\""
].join("\n");

export default function SettingsView({
  templates,
  onRefresh,
  onSaveZoneTemplate,
  onImportCustomers,
  refreshing,
  saving,
  importing
}: {
  templates: OperatorZoneTemplatesSnapshot | null;
  onRefresh: () => void;
  onSaveZoneTemplate: (input: {
    zoneId: string;
    truckId: string;
    driverId: string | null;
    customerIds: string[];
  }) => Promise<void>;
  onImportCustomers: (input: {
    rows: ReturnType<typeof previewRowsToImportRows>;
    addToZoneTemplates: boolean;
  }) => Promise<CustomerImportResult>;
  refreshing?: boolean;
  saving?: boolean;
  importing?: boolean;
}) {
  const zones = templates?.zones ?? [];
  const trucks = templates?.trucks ?? [];
  const drivers = templates?.drivers ?? [];
  const [tab, setTab] = useState<SettingsTab>("templates");
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTemplate | null>(null);
  const [customerToAdd, setCustomerToAdd] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [rawText, setRawText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, CustomerImportFieldKey | null>>({});
  const [addToTemplates, setAddToTemplates] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<CustomerImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedZone = useMemo(
    () => zones.find((zone) => zone.zoneId === (selectedZoneId ?? zones[0]?.zoneId)) ?? null,
    [selectedZoneId, zones]
  );

  useEffect(() => {
    if (!selectedZone) {
      setDraft(null);
      return;
    }
    setDraft(toDraft(selectedZone));
    setCustomerToAdd("");
    setError(null);
  }, [selectedZone?.zoneId, selectedZone?.updatedAt, templates]);

  const customerById = useMemo(() => {
    const map = new Map<string, ZoneTemplateCustomer>();
    for (const customer of selectedZone?.availableCustomers ?? []) {
      map.set(customer.customerId, customer);
    }
    for (const stop of selectedZone?.stops ?? []) {
      map.set(stop.customerId, stop);
    }
    return map;
  }, [selectedZone]);

  const draftStops = (draft?.stopIds ?? [])
    .map((id) => customerById.get(id))
    .filter((customer): customer is ZoneTemplateCustomer => Boolean(customer));

  const availableToAdd = (selectedZone?.availableCustomers ?? []).filter(
    (customer) => !(draft?.stopIds ?? []).includes(customer.customerId)
  );

  const previewRows: CustomerImportPreviewRow[] = useMemo(() => {
    if (headers.length === 0 || dataRows.length === 0) {
      return [];
    }
    return buildImportPreview({ headers, rows: dataRows, mapping });
  }, [headers, dataRows, mapping]);

  const validCount = previewRows.filter((row) => row.valid).length;
  const invalidCount = previewRows.length - validCount;

  function applyTableText(text: string) {
    setImportError(null);
    setImportResult(null);
    setRawText(text);
    const table = parseDelimitedTable(text);
    setHeaders(table.headers);
    setDataRows(table.rows);
    setMapping(guessColumnMapping(table.headers));
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    applyTableText(text);
    event.target.value = "";
  }

  async function handleSave() {
    if (!draft) {
      return;
    }
    setError(null);
    if (!draft.truckId) {
      setError("Select a default truck for this ward template.");
      return;
    }
    if (draft.stopIds.length === 0) {
      setError("Add at least one customer stop.");
      return;
    }
    try {
      await onSaveZoneTemplate({
        zoneId: draft.zoneId,
        truckId: draft.truckId,
        driverId: draft.driverId || null,
        customerIds: draft.stopIds
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save ward template");
    }
  }

  async function handleImport() {
    setImportError(null);
    setImportResult(null);
    const rows = previewRowsToImportRows(previewRows);
    if (rows.length === 0) {
      setImportError("Fix validation errors before importing. No valid rows to commit.");
      return;
    }
    try {
      const result = await onImportCustomers({
        rows,
        addToZoneTemplates: addToTemplates
      });
      setImportResult(result);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Unable to import customers");
    }
  }

  function moveStop(customerId: string, direction: "up" | "down") {
    if (!draft) {
      return;
    }
    const index = draft.stopIds.indexOf(customerId);
    if (index < 0) {
      return;
    }
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= draft.stopIds.length) {
      return;
    }
    const next = [...draft.stopIds];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setDraft({ ...draft, stopIds: next });
  }

  return (
    <section className="panel-stack">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Operator configuration</h2>
          <p className="panel-subtitle">
            Configure ward default templates and bulk-load customer data — independent of today&apos;s ops date.
          </p>
        </div>
        <button className="secondary-button" disabled={refreshing} onClick={onRefresh} type="button">
          <RefreshCw aria-hidden="true" size={16} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <div className="coverage-filter-row">
        <button
          className={tab === "templates" ? "chip-button active" : "chip-button"}
          onClick={() => setTab("templates")}
          type="button"
        >
          <MapPinned aria-hidden="true" size={14} />
          Ward templates
        </button>
        <button
          className={tab === "import" ? "chip-button active" : "chip-button"}
          onClick={() => setTab("import")}
          type="button"
        >
          <FileSpreadsheet aria-hidden="true" size={14} />
          Customer data load
        </button>
      </div>

      {tab === "import" ? (
        <article className="panel">
          <header className="panel-header">
            <div>
              <p className="eyebrow">Bulk import</p>
              <h3>Customer data load</h3>
              <p className="panel-subtitle">
                Upload a CSV or paste CSV/TSV. Rates use <strong>NGN</strong> (converted to kobo ×100). Re-runs skip
                existing phones for this operator (no blind duplicates). Preferred weekdays: ISO 1–7 or Mon–Sun.
              </p>
            </div>
          </header>

          <div className="planner-panel" style={{ gap: "0.75rem" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              <button
                className="secondary-button"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <Upload aria-hidden="true" size={16} />
                Upload CSV
              </button>
              <input
                accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
                hidden
                onChange={(event) => void handleFileChange(event)}
                ref={fileInputRef}
                type="file"
              />
              <button className="secondary-button" onClick={() => applyTableText(SAMPLE_CSV)} type="button">
                Load sample
              </button>
              <button
                className="secondary-button"
                disabled={!rawText}
                onClick={() => {
                  setRawText("");
                  setHeaders([]);
                  setDataRows([]);
                  setMapping({});
                  setImportResult(null);
                  setImportError(null);
                }}
                type="button"
              >
                Clear
              </button>
            </div>

            <label>
              Paste CSV / TSV
              <textarea
                onChange={(event) => applyTableText(event.target.value)}
                placeholder="Paste spreadsheet rows here…"
                rows={6}
                style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: "0.85rem" }}
                value={rawText}
              />
            </label>

            <p className="panel-subtitle" style={{ margin: 0 }}>
              Expected columns: <code>display_name</code>, <code>phone</code>, <code>address</code>,{" "}
              <code>ward</code> (e.g. Ward A), <code>customer_type</code> (residential | small_business |
              restaurant | estate), <code>monthly_rate_ngn</code>, <code>collections_per_week</code>,{" "}
              <code>preferred_weekdays</code> (e.g. Mon or 1,3,5).
            </p>
          </div>

          {headers.length > 0 ? (
            <div className="planner-panel" style={{ marginTop: "1rem" }}>
              <strong>Column mapping</strong>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))",
                  gap: "0.75rem",
                  marginTop: "0.75rem"
                }}
              >
                {headers.map((header) => (
                  <label key={header}>
                    {header || "(blank header)"}
                    <select
                      onChange={(event) => {
                        const value = event.target.value;
                        setMapping((prev) => ({
                          ...prev,
                          [header]: value ? (value as CustomerImportFieldKey) : null
                        }));
                      }}
                      value={mapping[header] ?? ""}
                    >
                      <option value="">Ignore</option>
                      {customerImportFieldKeys.map((key) => (
                        <option key={key} value={key}>
                          {customerImportFieldLabels[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {previewRows.length > 0 ? (
            <>
              <div
                className="planner-panel"
                style={{
                  marginTop: "1rem",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "1rem",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}
              >
                <div>
                  <strong>
                    Preview · {validCount} valid · {invalidCount} with errors
                  </strong>
                  <p className="panel-subtitle" style={{ margin: "0.25rem 0 0" }}>
                    Duplicates by phone are skipped on commit. Rows without a phone always insert.
                  </p>
                </div>
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    checked={addToTemplates}
                    onChange={(event) => setAddToTemplates(event.target.checked)}
                    type="checkbox"
                  />
                  Add imported active customers to ward default templates
                  <span className="panel-subtitle">(default off)</span>
                </label>
                <button
                  className="primary-button"
                  disabled={importing || validCount === 0}
                  onClick={() => void handleImport()}
                  type="button"
                >
                  <Upload aria-hidden="true" size={16} />
                  {importing ? "Importing..." : `Import ${validCount} row${validCount === 1 ? "" : "s"}`}
                </button>
              </div>

              {importError ? <p className="notice error">{importError}</p> : null}
              {importResult ? (
                <p className="notice">
                  Inserted {importResult.inserted}, skipped {importResult.skippedDuplicates} duplicate phone
                  {importResult.skippedDuplicates === 1 ? "" : "s"}
                  {importResult.templateAppended > 0
                    ? `, appended ${importResult.templateAppended} to ward templates`
                    : ""}
                  {importResult.errors.length > 0
                    ? `. ${importResult.errors.length} row error${importResult.errors.length === 1 ? "" : "s"} on commit.`
                    : "."}
                </p>
              ) : null}

              <div className="table-like coverage-list" style={{ marginTop: "1rem" }}>
                {previewRows.slice(0, 50).map((row) => (
                  <article
                    className="stack-row coverage-row"
                    key={row.rowNumber}
                    style={row.valid ? undefined : { borderColor: "var(--danger, #b42318)" }}
                  >
                    <div>
                      <div className="coverage-row-head">
                        <strong>
                          Row {row.rowNumber}: {row.displayName}
                        </strong>
                        <span>{row.valid ? "Ready" : "Invalid"}</span>
                      </div>
                      <p>
                        {row.wardName} · {row.customerType} ·{" "}
                        {row.monthlyRateNgnDisplay != null ? `₦${row.monthlyRateNgnDisplay}` : "—"} ·{" "}
                        {row.collectionsPerWeek != null && row.preferredWeekdays
                          ? formatCollectionFrequency(row.collectionsPerWeek, row.preferredWeekdays)
                          : row.preferredWeekdaysLabel ?? "—"}
                        {row.phone ? ` · ${row.phone}` : ""}
                      </p>
                      {row.errors.length > 0 ? (
                        <p className="notice error" style={{ marginTop: "0.35rem" }}>
                          {row.errors.join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  </article>
                ))}
                {previewRows.length > 50 ? (
                  <p className="panel-subtitle">Showing first 50 of {previewRows.length} rows.</p>
                ) : null}
              </div>
            </>
          ) : null}
        </article>
      ) : zones.length === 0 ? (
        <article className="empty-panel">
          <Settings2 aria-hidden="true" size={22} />
          <div>
            <strong>No wards found</strong>
            <p>Onboard wards and customers in Admin first.</p>
          </div>
        </article>
      ) : (
        <div className="workflow-grid routes-workflow">
          <aside className="panel">
            <header className="panel-header">
              <div>
                <p className="eyebrow">Wards</p>
                <h3>Default templates</h3>
              </div>
            </header>
            <div className="stack-list">
              {zones.map((zone) => (
                <button
                  className={
                    selectedZone?.zoneId === zone.zoneId ? "route-selector active" : "route-selector"
                  }
                  key={zone.zoneId}
                  onClick={() => setSelectedZoneId(zone.zoneId)}
                  type="button"
                >
                  <strong>{zone.zoneName}</strong>
                  <span>
                    {zone.stops.length} stop{zone.stops.length === 1 ? "" : "s"}
                    {zone.truckRegistration ? ` · ${zone.truckRegistration}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <article className="panel route-detail-panel">
            {selectedZone && draft ? (
              <>
                <header className="panel-header">
                  <div>
                    <p className="eyebrow">Ward template</p>
                    <h3>{selectedZone.zoneName}</h3>
                    <p className="panel-subtitle">
                      Customers on this list can be planned on their preferred weekdays. New customers must be added
                      here (or via Routes → Save to ward template).
                    </p>
                  </div>
                  <button className="primary-button" disabled={saving} onClick={() => void handleSave()} type="button">
                    <Save aria-hidden="true" size={16} />
                    {saving ? "Saving..." : "Save ward template"}
                  </button>
                </header>

                {error ? <p className="notice error">{error}</p> : null}

                <div className="planner-panel">
                  <label>
                    Default truck
                    <select
                      value={draft.truckId}
                      onChange={(event) => setDraft({ ...draft, truckId: event.target.value })}
                    >
                      <option value="">Select truck</option>
                      {trucks.map((truck) => (
                        <option key={truck.id} value={truck.id}>
                          {truck.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Default driver
                    <select
                      value={draft.driverId}
                      onChange={(event) => setDraft({ ...draft, driverId: event.target.value })}
                    >
                      <option value="">Unassigned</option>
                      {drivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="planner-panel" style={{ marginTop: "1rem" }}>
                  <label>
                    Add customer stop
                    <select value={customerToAdd} onChange={(event) => setCustomerToAdd(event.target.value)}>
                      <option value="">Select customer</option>
                      {availableToAdd.map((customer) => (
                        <option key={customer.customerId} value={customer.customerId}>
                          {customer.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    disabled={!customerToAdd}
                    onClick={() => {
                      if (!customerToAdd || !draft) {
                        return;
                      }
                      setDraft({ ...draft, stopIds: [...draft.stopIds, customerToAdd] });
                      setCustomerToAdd("");
                    }}
                    type="button"
                  >
                    <Plus aria-hidden="true" size={16} />
                    Add stop
                  </button>
                </div>

                {draftStops.length === 0 ? (
                  <article className="empty-panel" style={{ marginTop: "1rem" }}>
                    <MapPinned aria-hidden="true" size={22} />
                    <div>
                      <strong>No stops on this template</strong>
                      <p>Add active ward customers so daily planning can include them on preferred days.</p>
                    </div>
                  </article>
                ) : (
                  <div className="table-like coverage-list" style={{ marginTop: "1rem" }}>
                    {draftStops.map((stop, index) => (
                      <article className="stack-row coverage-row" key={stop.customerId}>
                        <div>
                          <div className="coverage-row-head">
                            <strong>
                              #{index + 1} {stop.displayName}
                            </strong>
                          </div>
                          <p>
                            {stop.address} ·{" "}
                            {formatCollectionFrequency(stop.collectionsPerWeek, stop.preferredWeekdays)}
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                          <button
                            aria-label="Move up"
                            className="icon-button"
                            disabled={index === 0}
                            onClick={() => moveStop(stop.customerId, "up")}
                            type="button"
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            aria-label="Move down"
                            className="icon-button"
                            disabled={index === draftStops.length - 1}
                            onClick={() => moveStop(stop.customerId, "down")}
                            type="button"
                          >
                            <ArrowDown size={16} />
                          </button>
                          <button
                            aria-label="Remove stop"
                            className="icon-button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                stopIds: draft.stopIds.filter((id) => id !== stop.customerId)
                              })
                            }
                            type="button"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <article className="empty-panel">
                <MapPinned aria-hidden="true" size={22} />
                <div>
                  <strong>Select a ward</strong>
                  <p>Choose a ward on the left to edit its default template.</p>
                </div>
              </article>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
