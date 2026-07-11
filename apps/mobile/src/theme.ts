/** Shared CleanOps mobile visual tokens (mockup language). */
export const colors = {
  bg: "#eef5ef",
  card: "#ffffff",
  cardSoft: "#e7f3ea",
  text: "#102017",
  muted: "#637466",
  accent: "#1a7f45",
  accentSoft: "#d8eee0",
  border: "#d5e4d9",
  danger: "#a33b2d",
  dangerSoft: "#f8e4e1",
  warn: "#9a6700"
} as const;

export function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}
