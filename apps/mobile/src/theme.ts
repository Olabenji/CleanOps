/** Shared CleanOps mobile visual tokens (marketing / command-centre language). */
export const colors = {
  bg: "#eef5ef",
  bgDeep: "#e4efe6",
  card: "#ffffff",
  cardSoft: "#e7f3ea",
  text: "#102017",
  muted: "#637466",
  accent: "#1a7f45",
  accentSoft: "#d8eee0",
  accentStrong: "#146638",
  border: "#d5e4d9",
  danger: "#a33b2d",
  dangerSoft: "#f8e4e1",
  warn: "#9a6700",
  warnSoft: "#f5ecd8",
  white: "#ffffff"
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 20,
  pill: 999
} as const;

export const space = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32
} as const;

export const type = {
  eyebrow: 12,
  body: 15,
  title: 26,
  metric: 28,
  button: 16
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
