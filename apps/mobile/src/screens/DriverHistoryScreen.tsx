import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DriverShiftJob } from "@cleanops/shared";
import { fetchDriverTodayShiftSummary } from "../data/driverService";
import { colors } from "../theme";

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatDayLabel(iso: string) {
  const today = isoDaysAgo(0);
  if (iso === today) {
    return "Today";
  }

  if (iso === isoDaysAgo(1)) {
    return "Yesterday";
  }

  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short"
  });
}

export default function DriverHistoryScreen({
  renderJob
}: {
  renderJob: (job: DriverShiftJob) => ReactNode;
}) {
  const dayOptions = [0, 1, 2, 3, 4, 5, 6].map(isoDaysAgo);
  const [selectedDate, setSelectedDate] = useState(dayOptions[0]);
  const [jobs, setJobs] = useState<DriverShiftJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const summary = await fetchDriverTodayShiftSummary(selectedDate);
        if (!cancelled) {
          setJobs(summary.jobs);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load history");
          setJobs([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  return (
    <ScrollView contentContainerStyle={styles.container} style={styles.scroll}>
      <Text style={styles.eyebrow}>CLEANOPS DRIVER</Text>
      <Text style={styles.heading}>History</Text>
      <Text style={styles.copy}>Completed jobs and cover work by day.</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        {dayOptions.map((day) => (
          <Pressable
            key={day}
            onPress={() => setSelectedDate(day)}
            style={[styles.chip, selectedDate === day && styles.chipActive]}
          >
            <Text style={[styles.chipText, selectedDate === day && styles.chipTextActive]}>
              {formatDayLabel(day)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!loading && !error && jobs.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No jobs for this day</Text>
          <Text style={styles.emptyCopy}>Finished routes and cover jobs will show up here.</Text>
        </View>
      ) : null}
      {!loading ? jobs.map((job) => <View key={job.id}>{renderJob(job)}</View>) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: {
    gap: 12,
    padding: 20,
    paddingBottom: 40
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2
  },
  heading: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5
  },
  copy: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22
  },
  chips: {
    marginVertical: 4
  },
  chip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  chipText: {
    color: colors.muted,
    fontWeight: "700"
  },
  chipTextActive: {
    color: colors.accent
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 16
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800"
  },
  emptyCopy: {
    color: colors.muted,
    lineHeight: 20
  },
  error: {
    color: colors.danger,
    fontWeight: "700"
  }
});
