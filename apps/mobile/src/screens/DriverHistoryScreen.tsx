import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DriverShiftJob } from "@cleanops/shared";
import { addOperationDays, DEFAULT_OPERATION_TIME_ZONE, getOperationDate } from "@cleanops/shared";
import { fetchDriverTodayShiftSummary } from "../data/driverService";
import { colors } from "../theme";

export default function DriverHistoryScreen({
  operationTimezone = DEFAULT_OPERATION_TIME_ZONE,
  renderJob
}: {
  operationTimezone?: string;
  renderJob: (job: DriverShiftJob) => ReactNode;
}) {
  function isoDaysAgo(days: number) {
    return addOperationDays(getOperationDate(operationTimezone), -days);
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

  const dayOptions = [0, 1, 2, 3, 4, 5, 6].map(isoDaysAgo);
  const [selectedDate, setSelectedDate] = useState(dayOptions[0]);
  const [jobs, setJobs] = useState<DriverShiftJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const today = getOperationDate(operationTimezone);
    setSelectedDate(today);
  }, [operationTimezone]);

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
    <View style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} style={styles.scrollView}>
        <Text style={styles.eyebrow}>CLEANOPS DRIVER</Text>
        <Text style={styles.heading}>History</Text>
        <Text style={styles.copy}>Finished jobs by day.</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
          {dayOptions.map((day) => (
            <Pressable
              key={day}
              onPress={() => setSelectedDate(day)}
              style={[styles.dayPill, selectedDate === day && styles.dayPillActive, { marginRight: 8 }]}
            >
              <Text style={[styles.dayText, selectedDate === day && styles.dayTextActive]}>
                {formatDayLabel(day)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} /> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {!loading && !error && jobs.length === 0 ? (
          <Text style={styles.copy}>No finished jobs for this day.</Text>
        ) : null}
        {jobs.map((job) => (
          <View key={job.id}>{renderJob(job)}</View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.bg,
    flex: 1
  },
  scrollView: {
    flex: 1
  },
  container: {
    padding: 20,
    paddingBottom: 28,
    paddingTop: 12
  },
  eyebrow: {
    color: "#1a7f45",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 12,
    textTransform: "uppercase"
  },
  heading: {
    color: "#102017",
    fontSize: 38,
    fontWeight: "800",
    letterSpacing: -1.4,
    marginBottom: 8
  },
  copy: {
    color: "#5d6f64",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8
  },
  dayPill: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  dayPillActive: {
    backgroundColor: "#1a7f45",
    borderColor: "#1a7f45"
  },
  dayText: {
    color: "#5d6f64",
    fontSize: 13,
    fontWeight: "700"
  },
  dayTextActive: {
    color: "#fff"
  },
  errorText: {
    color: "#b42318",
    marginTop: 12
  }
});
