import {
  serviceComplaintCategories,
  type ServiceComplaint,
  type SubmitResidentComplaintInput
} from "@cleanops/shared";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { submitResidentComplaint } from "../data/residentService";
import { colors } from "../theme";

function label(value: string) {
  return value.replace(/_/g, " ");
}

function complaintSla(complaint: ServiceComplaint) {
  if (complaint.resolvedAt) {
    return `Resolved ${new Date(complaint.resolvedAt).toLocaleString("en-GB")}`;
  }
  if (complaint.slaBreached) {
    return "24-hour response SLA breached";
  }
  return `Response due ${new Date(complaint.slaDueAt).toLocaleString("en-GB")}`;
}

export default function ResidentComplaintsScreen({
  complaints,
  onSubmitted
}: {
  complaints: ServiceComplaint[];
  onSubmitted: () => Promise<void>;
}) {
  const [form, setForm] = useState<SubmitResidentComplaintInput>({
    category: "missed_stop",
    title: "",
    description: ""
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await submitResidentComplaint(form);
      setForm({ category: "missed_stop", title: "", description: "" });
      setMessage("Issue submitted. Your PSP has a 24-hour response SLA.");
      await onSubmitted();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit issue");
    } finally {
      setBusy(false);
    }
  }

  const valid = form.title.trim().length >= 3 && form.description.trim().length >= 5;

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Report a service issue</Text>
        <Text style={styles.title}>Missed collection & complaints</Text>
        <Text style={styles.muted}>Your report opens a 24-hour SLA ticket with your PSP.</Text>

        <Text style={styles.label}>Issue type</Text>
        <View style={styles.chips}>
          {serviceComplaintCategories.map((category) => (
            <Pressable
              key={category}
              onPress={() => setForm((current) => ({ ...current, category }))}
              style={[styles.chip, form.category === category && styles.chipActive]}
            >
              <Text style={[styles.chipText, form.category === category && styles.chipTextActive]}>
                {label(category)}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Title</Text>
        <TextInput
          editable={!busy}
          onChangeText={(title) => setForm((current) => ({ ...current, title }))}
          placeholder="Short summary"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={form.title}
        />
        <Text style={styles.label}>Description</Text>
        <TextInput
          editable={!busy}
          multiline
          onChangeText={(description) => setForm((current) => ({ ...current, description }))}
          placeholder="Tell your PSP what happened"
          placeholderTextColor={colors.muted}
          style={[styles.input, styles.textArea]}
          value={form.description}
        />
        <Pressable
          disabled={busy || !valid}
          onPress={() => void submit()}
          style={[styles.primaryButton, (busy || !valid) && styles.disabled]}
        >
          <Text style={styles.primaryText}>{busy ? "Submitting..." : "Submit issue"}</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Issue history</Text>
        {complaints.length === 0 ? (
          <Text style={styles.muted}>No service issues reported yet.</Text>
        ) : (
          complaints.map((complaint) => (
            <View key={complaint.id} style={styles.historyItem}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle}>{complaint.title}</Text>
                <Text
                  style={[
                    styles.status,
                    complaint.slaBreached && !complaint.resolvedAt && styles.statusDanger
                  ]}
                >
                  {label(complaint.status)}
                </Text>
              </View>
              <Text style={styles.muted}>
                {label(complaint.category)} · {complaintSla(complaint)}
              </Text>
              <Text style={styles.body}>{complaint.description}</Text>
              {complaint.resolutionNotes ? (
                <Text style={styles.resolution}>PSP response: {complaint.resolutionNotes}</Text>
              ) : null}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 16
  },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  title: { color: colors.text, fontSize: 19, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  label: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: {
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.muted, fontSize: 12, textTransform: "capitalize" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  input: {
    backgroundColor: "#f8fbf7",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    padding: 13
  },
  textArea: { minHeight: 100, textAlignVertical: "top" },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 12,
    padding: 14
  },
  primaryText: { color: "#fff", fontWeight: "800" },
  disabled: { opacity: 0.45 },
  error: { color: colors.danger },
  success: { color: colors.accent },
  historyItem: { borderTopColor: colors.border, borderTopWidth: 1, gap: 6, paddingTop: 12 },
  historyHeader: { alignItems: "flex-start", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  historyTitle: { color: colors.text, flex: 1, fontSize: 15, fontWeight: "800" },
  status: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    color: colors.accent,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textTransform: "capitalize"
  },
  statusDanger: { backgroundColor: colors.dangerSoft, color: colors.danger },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  resolution: { color: colors.accent, fontSize: 13, lineHeight: 19 }
});
