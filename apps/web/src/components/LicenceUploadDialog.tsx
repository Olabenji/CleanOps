import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import AdminModal from "./AdminModal";

export default function LicenceUploadDialog({
  driverName,
  initialExpiresOn,
  initialImageUrl,
  onClose,
  onUpload,
  open
}: {
  driverName: string;
  initialExpiresOn: string;
  initialImageUrl: string | null;
  onClose: () => void;
  onUpload: (input: { licenceExpiresOn: string; file: File }) => Promise<void>;
  open: boolean;
}) {
  const [expiresOn, setExpiresOn] = useState(initialExpiresOn);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialImageUrl);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setExpiresOn(initialExpiresOn);
    setFile(null);
    setPreviewUrl(initialImageUrl);
    setError(null);
  }, [open, initialExpiresOn, initialImageUrl]);

  useEffect(() => {
    if (!file) {
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!expiresOn) {
      setError("Licence expiry date is required.");
      return;
    }

    if (!file && !initialImageUrl) {
      setError("Choose a licence photo or PDF to upload.");
      return;
    }

    if (!file) {
      setError("Choose a new licence file to upload, or cancel.");
      return;
    }

    setSaving(true);

    try {
      await onUpload({ licenceExpiresOn: expiresOn, file });
      onClose();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload licence");
    } finally {
      setSaving(false);
    }
  }

  const previewIsPdf =
    file?.type === "application/pdf" ||
    previewUrl?.toLowerCase().includes(".pdf") ||
    previewUrl?.toLowerCase().includes("application/pdf");

  return (
    <AdminModal
      onClose={onClose}
      open={open}
      subtitle={`Upload a licence photo or PDF for ${driverName}.`}
      title="Upload driver licence"
    >
      <form className="entry-card admin-form admin-modal-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Licence expiry
          <input onChange={(event) => setExpiresOn(event.target.value)} required type="date" value={expiresOn} />
        </label>
        <label>
          Licence document
          <input
            accept="image/*,.pdf,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>
        {previewUrl ? (
          <div className="licence-preview-card">
            {previewIsPdf ? (
              <p className="panel-subtitle">
                PDF selected.{" "}
                <a href={previewUrl} rel="noreferrer" target="_blank">
                  Open preview
                </a>
              </p>
            ) : (
              <img alt={`${driverName} licence preview`} src={previewUrl} />
            )}
          </div>
        ) : null}
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="button-row">
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? "Uploading..." : "Save licence"}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}
