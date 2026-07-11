import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import AdminModal from "./AdminModal";

export default function ProfileModal({
  initialFullName,
  initialPhone,
  onClose,
  onSave,
  open,
  roleLabel
}: {
  initialFullName: string;
  initialPhone: string;
  onClose: () => void;
  onSave: (input: { fullName: string; phone: string }) => Promise<void>;
  open: boolean;
  roleLabel: string;
}) {
  const [fullName, setFullName] = useState(initialFullName);
  const [phone, setPhone] = useState(initialPhone);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setFullName(initialFullName);
    setPhone(initialPhone);
    setError(null);
  }, [open, initialFullName, initialPhone]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      await onSave({ fullName: fullName.trim(), phone: phone.trim() });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminModal
      onClose={onClose}
      open={open}
      subtitle={`Update the name and phone shown on your ${roleLabel} account.`}
      title="Your profile"
    >
      <form className="entry-card admin-form admin-modal-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Full name
          <input onChange={(event) => setFullName(event.target.value)} required value={fullName} />
        </label>
        <label>
          Phone
          <input onChange={(event) => setPhone(event.target.value)} required value={phone} />
        </label>
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="button-row">
          <button className="primary-button" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save profile"}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}
