import {
  dispatchCommsResultSchema,
  operatorCommsSnapshotSchema,
  queueRemindersResultSchema,
  type DispatchCommsResult,
  type OperatorCommsSnapshot,
  type QueueRemindersResult
} from "@cleanops/shared";
import { supabase } from "../lib/supabase";

export async function getOperatorComms(limit = 50): Promise<OperatorCommsSnapshot> {
  if (!supabase) {
    return {
      metrics: { queued: 0, sentToday: 0, failed: 0, remindersQueued: 0 },
      reminderPreview5: {
        dueDate: "",
        daysBeforeDue: 5,
        targetDate: "",
        windowMatchesToday: false,
        candidates: []
      },
      reminderPreview2: {
        dueDate: "",
        daysBeforeDue: 2,
        targetDate: "",
        windowMatchesToday: false,
        candidates: []
      },
      recent: []
    };
  }

  const { data, error } = await supabase.rpc("operator_comms_snapshot", {
    input_limit: limit
  });

  if (error) {
    throw new Error(error.message);
  }

  return operatorCommsSnapshotSchema.parse(data);
}

export async function queuePaymentReminders(
  daysBeforeDue: 2 | 5,
  force = false
): Promise<QueueRemindersResult> {
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const { data, error } = await supabase.rpc("queue_payment_reminders", {
    input_days_before_due: daysBeforeDue,
    input_force: force
  });

  if (error) {
    throw new Error(error.message);
  }

  return queueRemindersResultSchema.parse(data);
}

export async function dispatchResidentComms(limit = 50): Promise<DispatchCommsResult> {
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const { data, error } = await supabase.functions.invoke("dispatch-resident-comms", {
    body: { limit }
  });

  if (error) {
    throw new Error(error.message);
  }

  return dispatchCommsResultSchema.parse(data ?? {});
}

export async function sendPaymentReminders(
  daysBeforeDue: 2 | 5,
  options?: { force?: boolean; dispatch?: boolean }
): Promise<{ queue: QueueRemindersResult; dispatch: DispatchCommsResult | null }> {
  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const { data, error } = await supabase.functions.invoke("send-reminders", {
    body: {
      daysBeforeDue,
      force: options?.force ?? false,
      dispatch: options?.dispatch ?? true
    }
  });

  if (error) {
    throw new Error(error.message);
  }

  const payload = (data ?? {}) as {
    queue?: unknown;
    dispatch?: unknown;
    error?: string;
  };

  if (payload.error) {
    throw new Error(payload.error);
  }

  return {
    queue: queueRemindersResultSchema.parse(payload.queue ?? {}),
    dispatch: payload.dispatch ? dispatchCommsResultSchema.parse(payload.dispatch) : null
  };
}
