import { z } from "zod";

const customerTypes = [
  "residential",
  "small_business",
  "restaurant",
  "estate"
] as const;

const ISO_WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const isoWeekdaySchema = z.number().int().min(1).max(7);
const preferredWeekdaysSchema = z
  .array(isoWeekdaySchema)
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, {
    message: "Preferred weekdays must be unique"
  });

/** Canonical CSV field keys for customer bulk import. */
export const customerImportFieldKeys = [
  "displayName",
  "phone",
  "address",
  "wardName",
  "customerType",
  "monthlyRateNgn",
  "monthlyRateKobo",
  "collectionsPerWeek",
  "preferredWeekdays"
] as const;

export type CustomerImportFieldKey = (typeof customerImportFieldKeys)[number];

export const customerImportFieldLabels: Record<CustomerImportFieldKey, string> = {
  displayName: "Display name",
  phone: "Phone",
  address: "Address",
  wardName: "Ward / zone name",
  customerType: "Customer type",
  monthlyRateNgn: "Monthly rate (NGN)",
  monthlyRateKobo: "Monthly rate (kobo)",
  collectionsPerWeek: "Collections per week",
  preferredWeekdays: "Preferred weekdays"
};

/** Required mapped columns (rate may be NGN or kobo). */
export const customerImportRequiredFields = [
  "displayName",
  "address",
  "wardName",
  "customerType",
  "collectionsPerWeek",
  "preferredWeekdays"
] as const satisfies readonly CustomerImportFieldKey[];

const WEEKDAY_NAME_TO_ISO: Record<string, number> = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7
};

/**
 * Parse preferred weekdays from CSV cell.
 * Accepts ISO numbers 1–7 and/or Mon/Tue/… names, comma/space/semicolon separated.
 */
export function parsePreferredWeekdaysCell(raw: string): number[] {
  const tokens = raw
    .split(/[,;/|\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const days: number[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (/^[1-7]$/.test(token)) {
      days.push(Number(token));
      continue;
    }
    const named = WEEKDAY_NAME_TO_ISO[lower];
    if (named != null) {
      days.push(named);
      continue;
    }
    throw new Error(`Unknown weekday "${token}" (use 1–7 ISO or Mon–Sun)`);
  }

  const unique = [...new Set(days)].sort((a, b) => a - b);
  return preferredWeekdaysSchema.parse(unique);
}

/** Normalize phone for uniqueness checks (digits + leading +). */
export function normalizeImportPhone(raw: string | null | undefined): string | null {
  if (raw == null) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const digits = trimmed.replace(/[^\d+]/g, "");
  return digits || null;
}

/**
 * Convert a monthly rate cell to kobo.
 * Prefer NGN when both are present. NGN may be decimal (e.g. 3500 or 3500.50).
 */
export function monthlyRateToKobo(input: {
  monthlyRateNgn?: string | number | null;
  monthlyRateKobo?: string | number | null;
}): number {
  const ngnRaw = input.monthlyRateNgn;
  if (ngnRaw != null && String(ngnRaw).trim() !== "") {
    const ngn = typeof ngnRaw === "number" ? ngnRaw : Number(String(ngnRaw).replace(/,/g, "").trim());
    if (!Number.isFinite(ngn) || ngn < 0) {
      throw new Error("Monthly rate (NGN) must be a non-negative number");
    }
    return Math.round(ngn * 100);
  }

  const koboRaw = input.monthlyRateKobo;
  if (koboRaw != null && String(koboRaw).trim() !== "") {
    const kobo =
      typeof koboRaw === "number" ? koboRaw : Number(String(koboRaw).replace(/,/g, "").trim());
    if (!Number.isFinite(kobo) || !Number.isInteger(kobo) || kobo < 0) {
      throw new Error("Monthly rate (kobo) must be a non-negative integer");
    }
    return kobo;
  }

  throw new Error("Provide monthly_rate_ngn or monthly_rate_kobo");
}

export function parseCustomerTypeCell(raw: string): (typeof customerTypes)[number] {
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, (typeof customerTypes)[number]> = {
    residential: "residential",
    resident: "residential",
    home: "residential",
    small_business: "small_business",
    smallbusiness: "small_business",
    business: "small_business",
    smb: "small_business",
    restaurant: "restaurant",
    estate: "estate"
  };
  const match = aliases[normalized];
  if (!match) {
    throw new Error(
      `Unknown customer type "${raw}" (use residential | small_business | restaurant | estate)`
    );
  }
  return match;
}

export const customerImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  displayName: z.string().min(2),
  phone: z.string().nullable().optional(),
  address: z.string().min(5),
  wardName: z.string().min(1),
  customerType: z.enum(customerTypes),
  /** Always stored/transmitted as kobo after client conversion. */
  monthlyRateKobo: z.number().int().nonnegative(),
  collectionsPerWeek: z.number().int().min(1).max(7),
  preferredWeekdays: preferredWeekdaysSchema,
  frequencyNotes: z.string().nullable().optional()
});

export type CustomerImportRow = z.infer<typeof customerImportRowSchema>;

export const customerImportPreviewRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  displayName: z.string(),
  phone: z.string().nullable().optional(),
  address: z.string(),
  wardName: z.string(),
  customerType: z.string(),
  monthlyRateKobo: z.number().int().nonnegative().nullable().optional(),
  monthlyRateNgnDisplay: z.string().nullable().optional(),
  collectionsPerWeek: z.number().int().nullable().optional(),
  preferredWeekdays: z.array(z.number().int()).nullable().optional(),
  preferredWeekdaysLabel: z.string().nullable().optional(),
  valid: z.boolean(),
  errors: z.array(z.string())
});

export type CustomerImportPreviewRow = z.infer<typeof customerImportPreviewRowSchema>;

export const customerImportInputSchema = z.object({
  rows: z.array(customerImportRowSchema).min(1).max(500),
  /** When true, append newly imported active customers to ward zone_default templates. Default false. */
  addToZoneTemplates: z.boolean().default(false),
  /** Marker written to frequency_notes for this batch (idempotency / audit). */
  importMarker: z.string().min(1).max(80).default("bulk-import")
});

export type CustomerImportInput = z.infer<typeof customerImportInputSchema>;

export const customerImportResultSchema = z.object({
  inserted: z.number().int().nonnegative(),
  skippedDuplicates: z.number().int().nonnegative(),
  templateAppended: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      rowNumber: z.number().int().positive(),
      message: z.string()
    })
  ),
  insertedCustomerIds: z.array(z.string().uuid()).optional()
});

export type CustomerImportResult = z.infer<typeof customerImportResultSchema>;

export const customerImportColumnMappingSchema = z.record(
  z.string(),
  z.enum(customerImportFieldKeys).nullable()
);

export type CustomerImportColumnMapping = z.infer<typeof customerImportColumnMappingSchema>;

const HEADER_ALIASES: Record<string, CustomerImportFieldKey> = {
  display_name: "displayName",
  displayname: "displayName",
  name: "displayName",
  customer_name: "displayName",
  customername: "displayName",
  phone: "phone",
  phone_number: "phone",
  phonenumber: "phone",
  mobile: "phone",
  address: "address",
  street_address: "address",
  ward: "wardName",
  ward_name: "wardName",
  wardname: "wardName",
  zone: "wardName",
  zone_name: "wardName",
  zonename: "wardName",
  customer_type: "customerType",
  customertype: "customerType",
  type: "customerType",
  monthly_rate_ngn: "monthlyRateNgn",
  monthlyratengn: "monthlyRateNgn",
  rate_ngn: "monthlyRateNgn",
  monthly_rate: "monthlyRateNgn",
  monthlyrate: "monthlyRateNgn",
  rate: "monthlyRateNgn",
  amount_ngn: "monthlyRateNgn",
  monthly_rate_kobo: "monthlyRateKobo",
  monthlyratekobo: "monthlyRateKobo",
  rate_kobo: "monthlyRateKobo",
  collections_per_week: "collectionsPerWeek",
  collectionsperweek: "collectionsPerWeek",
  frequency: "collectionsPerWeek",
  pickups_per_week: "collectionsPerWeek",
  preferred_weekdays: "preferredWeekdays",
  preferredweekdays: "preferredWeekdays",
  weekdays: "preferredWeekdays",
  collection_days: "preferredWeekdays"
};

export function normalizeHeaderKey(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function guessColumnMapping(headers: string[]): Record<string, CustomerImportFieldKey | null> {
  const mapping: Record<string, CustomerImportFieldKey | null> = {};
  const used = new Set<CustomerImportFieldKey>();
  for (const header of headers) {
    const alias = HEADER_ALIASES[normalizeHeaderKey(header)];
    if (alias && !used.has(alias)) {
      mapping[header] = alias;
      used.add(alias);
    } else {
      mapping[header] = null;
    }
  }
  return mapping;
}

export function parseDelimitedTable(text: string): { headers: string[]; rows: string[][] } {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  if (!normalized) {
    return { headers: [], rows: [] };
  }

  const firstLine = normalized.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const lines = splitLines(normalized);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]!, delimiter).map((h) => h.trim());
  const rows = lines
    .slice(1)
    .map((line) => parseCsvLine(line, delimiter))
    .filter((cells) => cells.some((cell) => cell.trim() !== ""));

  return { headers, rows };
}

function detectDelimiter(line: string): string {
  const commas = (line.match(/,/g) ?? []).length;
  const tabs = (line.match(/\t/g) ?? []).length;
  const semis = (line.match(/;/g) ?? []).length;
  if (tabs > commas && tabs >= semis) {
    return "\t";
  }
  if (semis > commas) {
    return ";";
  }
  return ",";
}

function splitLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      if (current.trim() !== "") {
        lines.push(current);
      }
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") {
    lines.push(current);
  }
  return lines;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export function buildImportPreview(input: {
  headers: string[];
  rows: string[][];
  mapping: Record<string, CustomerImportFieldKey | null>;
}): CustomerImportPreviewRow[] {
  const fieldToHeader = new Map<CustomerImportFieldKey, string>();
  for (const [header, field] of Object.entries(input.mapping)) {
    if (field) {
      fieldToHeader.set(field, header);
    }
  }

  return input.rows.map((cells, index) => {
    const rowNumber = index + 2; // 1-based data row after header
    const get = (field: CustomerImportFieldKey): string => {
      const header = fieldToHeader.get(field);
      if (!header) {
        return "";
      }
      const col = input.headers.indexOf(header);
      return col >= 0 ? (cells[col] ?? "").trim() : "";
    };

    const errors: string[] = [];
    const displayName = get("displayName");
    const phone = get("phone");
    const address = get("address");
    const wardName = get("wardName");
    const customerTypeRaw = get("customerType");
    const rateNgn = get("monthlyRateNgn");
    const rateKobo = get("monthlyRateKobo");
    const collectionsRaw = get("collectionsPerWeek");
    const weekdaysRaw = get("preferredWeekdays");

    if (!fieldToHeader.has("displayName")) {
      errors.push("Map a Display name column");
    } else if (displayName.length < 2) {
      errors.push("Display name is required (min 2 characters)");
    }

    if (!fieldToHeader.has("address")) {
      errors.push("Map an Address column");
    } else if (address.length < 5) {
      errors.push("Address is required (min 5 characters)");
    }

    if (!fieldToHeader.has("wardName")) {
      errors.push("Map a Ward / zone name column");
    } else if (!wardName) {
      errors.push("Ward / zone name is required");
    }

    let customerType = "";
    if (!fieldToHeader.has("customerType")) {
      errors.push("Map a Customer type column");
    } else {
      try {
        customerType = parseCustomerTypeCell(customerTypeRaw);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "Invalid customer type");
      }
    }

    let monthlyRateKobo: number | null = null;
    if (!fieldToHeader.has("monthlyRateNgn") && !fieldToHeader.has("monthlyRateKobo")) {
      errors.push("Map Monthly rate (NGN) or Monthly rate (kobo)");
    } else {
      try {
        monthlyRateKobo = monthlyRateToKobo({
          monthlyRateNgn: rateNgn || null,
          monthlyRateKobo: rateKobo || null
        });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "Invalid monthly rate");
      }
    }

    let collectionsPerWeek: number | null = null;
    if (!fieldToHeader.has("collectionsPerWeek")) {
      errors.push("Map Collections per week");
    } else {
      const n = Number(collectionsRaw);
      if (!Number.isInteger(n) || n < 1 || n > 7) {
        errors.push("Collections per week must be an integer 1–7");
      } else {
        collectionsPerWeek = n;
      }
    }

    let preferredWeekdays: number[] | null = null;
    let preferredWeekdaysLabel: string | null = null;
    if (!fieldToHeader.has("preferredWeekdays")) {
      errors.push("Map Preferred weekdays");
    } else {
      try {
        preferredWeekdays = parsePreferredWeekdaysCell(weekdaysRaw);
        preferredWeekdaysLabel = preferredWeekdays
          .map((d) => ISO_WEEKDAY_LABELS[d - 1] ?? String(d))
          .join(",");
        if (collectionsPerWeek != null && preferredWeekdays.length !== collectionsPerWeek) {
          errors.push(
            `Preferred weekdays count (${preferredWeekdays.length}) should match collections per week (${collectionsPerWeek})`
          );
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "Invalid preferred weekdays");
      }
    }

    return customerImportPreviewRowSchema.parse({
      rowNumber,
      displayName: displayName || "(missing)",
      phone: phone || null,
      address: address || "(missing)",
      wardName: wardName || "(missing)",
      customerType: customerType || customerTypeRaw || "(missing)",
      monthlyRateKobo,
      monthlyRateNgnDisplay:
        monthlyRateKobo != null ? (monthlyRateKobo / 100).toLocaleString("en-NG") : null,
      collectionsPerWeek,
      preferredWeekdays,
      preferredWeekdaysLabel,
      valid: errors.length === 0,
      errors
    });
  });
}

export function previewRowsToImportRows(
  preview: CustomerImportPreviewRow[],
  importMarker = "bulk-import"
): CustomerImportRow[] {
  return preview
    .filter((row) => row.valid)
    .map((row) =>
      customerImportRowSchema.parse({
        rowNumber: row.rowNumber,
        displayName: row.displayName,
        phone: normalizeImportPhone(row.phone) ?? null,
        address: row.address,
        wardName: row.wardName,
        customerType: row.customerType,
        monthlyRateKobo: row.monthlyRateKobo!,
        collectionsPerWeek: row.collectionsPerWeek!,
        preferredWeekdays: row.preferredWeekdays!,
        frequencyNotes: importMarker
      })
    );
}
