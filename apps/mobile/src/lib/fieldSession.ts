import type { UserRole } from "@cleanops/shared";

export type FieldRole = Extract<UserRole, "driver" | "collection_agent">;

export type FieldSession = {
  fullName: string;
  role: FieldRole;
  mode: "pilot" | "supabase";
  connectionNotice?: string;
};

export const pilotNames: Record<FieldRole, string> = {
  driver: "Adewale Johnson",
  collection_agent: "Kunle Martins"
};

export function createPilotSession(role: FieldRole, connectionNotice?: string): FieldSession {
  return {
    fullName: pilotNames[role],
    role,
    mode: "pilot",
    connectionNotice
  };
}

export const OFFLINE_WORKSPACE_NOTICE =
  "Backend unreachable — opened offline demo workspace. Use the same Wi‑Fi as your dev machine for live Supabase sync.";

export function buildOfflineWorkspaceNotice(error: unknown, backendUrl: string | null): string {
  const detail = error instanceof Error ? error.message : String(error);

  return `Cannot reach ${backendUrl ?? "Supabase"} (${detail}). Opened offline demo workspace.`;
}
