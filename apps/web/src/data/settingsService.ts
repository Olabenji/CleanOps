import {
  customerImportInputSchema,
  customerImportResultSchema,
  operatorZoneTemplatesSnapshotSchema,
  saveZoneDefaultTemplateInputSchema,
  saveZoneDefaultTemplateResultSchema,
  type CustomerImportInput,
  type CustomerImportResult,
  type OperatorZoneTemplatesSnapshot,
  type SaveZoneDefaultTemplateInput,
  type SaveZoneDefaultTemplateResult
} from "@cleanops/shared";
import { supabase } from "../lib/supabase";

export async function getOperatorZoneTemplates(): Promise<OperatorZoneTemplatesSnapshot> {
  if (!supabase) {
    return { zones: [], trucks: [], drivers: [] };
  }

  const { data, error } = await supabase.rpc("operator_zone_templates_snapshot");
  if (error) {
    throw new Error(error.message);
  }

  return operatorZoneTemplatesSnapshotSchema.parse(data);
}

export async function saveZoneDefaultTemplate(
  input: SaveZoneDefaultTemplateInput
): Promise<SaveZoneDefaultTemplateResult> {
  const parsed = saveZoneDefaultTemplateInputSchema.parse(input);

  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const { data, error } = await supabase.rpc("save_zone_default_template", {
    input_zone_id: parsed.zoneId,
    input_truck_id: parsed.truckId,
    input_driver_id: parsed.driverId ?? null,
    input_customer_ids: parsed.customerIds
  });

  if (error) {
    throw new Error(error.message);
  }

  return saveZoneDefaultTemplateResultSchema.parse(data);
}

export async function importCustomersBulk(input: CustomerImportInput): Promise<CustomerImportResult> {
  const parsed = customerImportInputSchema.parse(input);

  if (!supabase) {
    throw new Error("Supabase is not configured");
  }

  const { data, error } = await supabase.rpc("import_customers_bulk", {
    input_rows: parsed.rows,
    input_add_to_zone_templates: parsed.addToZoneTemplates,
    input_import_marker: parsed.importMarker
  });

  if (error) {
    throw new Error(error.message);
  }

  return customerImportResultSchema.parse(data);
}
