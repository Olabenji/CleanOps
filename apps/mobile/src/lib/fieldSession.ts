import type { UserRole } from "@cleanops/shared";

export type FieldRole = Extract<UserRole, "driver" | "collection_agent" | "resident">;

export type FieldSession = {
  fullName: string;
  phone?: string;
  role: FieldRole;
  mode: "pilot" | "supabase";
  timezone?: string;
  connectionNotice?: string;
};

export const pilotNames: Record<FieldRole, string> = {
  driver: "Adewale Johnson",
  collection_agent: "Kunle Martins",
  resident: "Mrs. Folake Adebayo"
};

export const pilotPhones: Record<FieldRole, string> = {
  driver: "+2348000000201",
  collection_agent: "+2348000000205",
  resident: "+2348000000401"
};

export function createPilotSession(role: FieldRole, connectionNotice?: string): FieldSession {
  return {
    fullName: pilotNames[role],
    phone: pilotPhones[role],
    role,
    mode: "pilot",
    timezone: "Africa/Lagos",
    connectionNotice
  };
}

export const OFFLINE_WORKSPACE_NOTICE =
  "Backend unreachable — opened offline demo workspace. Use the same Wi‑Fi as your dev machine for live Supabase sync.";

export function buildOfflineWorkspaceNotice(error: unknown, backendUrl: string | null): string {
  const detail = error instanceof Error ? error.message : String(error);

  return `Cannot reach ${backendUrl ?? "Supabase"} (${detail}). Opened offline demo workspace.`;
}
