import {
  billDeliverySchema,
  complianceCaseSchema,
  createComplianceCaseInputSchema,
  createServiceComplaintInputSchema,
  getOperationDate,
  recordBillDeliveryInputSchema,
  recordVehicleBrandingChecklistInputSchema,
  serviceComplaintSchema,
  vehicleBrandingChecklistSchema,
  type BillDelivery,
  type ComplianceCase,
  type CreateComplianceCaseInput,
  type CreateServiceComplaintInput,
  type RecordBillDeliveryInput,
  type RecordVehicleBrandingChecklistInput,
  type ServiceComplaint,
  type VehicleBrandingChecklist
} from "@cleanops/shared";
import { supabase } from "../lib/supabase";

export async function listServiceComplaints(operationDate?: string): Promise<ServiceComplaint[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("list_service_complaints", {
    input_date: operationDate ?? getOperationDate()
  });

  if (error) {
    throw new Error(error.message);
  }

  return serviceComplaintSchema.array().parse(data ?? []);
}

export async function createServiceComplaint(input: CreateServiceComplaintInput): Promise<void> {
  const parsed = createServiceComplaintInputSchema.parse(input);

  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("create_service_complaint", {
    input_title: parsed.title,
    input_description: parsed.description,
    input_category: parsed.category,
    input_source: parsed.source,
    input_customer_id: parsed.customerId ?? null,
    input_route_id: parsed.routeId ?? null,
    input_zone_id: parsed.zoneId ?? null
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateServiceComplaintStatus(
  complaintId: string,
  nextStatus: ServiceComplaint["status"],
  resolutionNotes?: string
): Promise<void> {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("update_service_complaint_status", {
    input_complaint_id: complaintId,
    next_status: nextStatus,
    input_resolution_notes: resolutionNotes ?? null
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function listBillDeliveries(periodStart?: string): Promise<BillDelivery[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("list_bill_deliveries", {
    input_period_start: periodStart ?? null
  });

  if (error) {
    throw new Error(error.message);
  }

  return billDeliverySchema.array().parse(data ?? []);
}

export async function recordBillDelivery(input: RecordBillDeliveryInput): Promise<void> {
  const parsed = recordBillDeliveryInputSchema.parse(input);

  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("record_bill_delivery", {
    input_customer_id: parsed.customerId,
    input_bill_period_start: parsed.billPeriodStart,
    input_amount_kobo: parsed.amountKobo,
    input_status: parsed.status,
    input_delivery_note: parsed.deliveryNote ?? null
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function listComplianceCases(): Promise<ComplianceCase[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("list_compliance_cases");

  if (error) {
    throw new Error(error.message);
  }

  return complianceCaseSchema.array().parse(data ?? []);
}

export async function createComplianceCase(input: CreateComplianceCaseInput): Promise<void> {
  const parsed = createComplianceCaseInputSchema.parse(input);

  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("create_compliance_case", {
    input_case_type: parsed.caseType,
    input_title: parsed.title,
    input_description: parsed.description,
    input_customer_id: parsed.customerId ?? null,
    input_route_id: parsed.routeId ?? null,
    input_zone_id: parsed.zoneId ?? null,
    input_incident_report_id: parsed.incidentReportId ?? null
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateComplianceCaseStatus(
  caseId: string,
  nextStatus: ComplianceCase["status"],
  closureNotes?: string
): Promise<void> {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("update_compliance_case_status", {
    input_case_id: caseId,
    next_status: nextStatus,
    input_closure_notes: closureNotes ?? null
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function listVehicleBrandingChecklists(
  operationDate?: string
): Promise<VehicleBrandingChecklist[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("list_vehicle_branding_checklists", {
    input_date: operationDate ?? getOperationDate()
  });

  if (error) {
    throw new Error(error.message);
  }

  return vehicleBrandingChecklistSchema.array().parse(data ?? []);
}

export async function recordVehicleBrandingChecklist(
  input: RecordVehicleBrandingChecklistInput
): Promise<void> {
  const parsed = recordVehicleBrandingChecklistInputSchema.parse(input);

  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("record_vehicle_branding_checklist", {
    input_truck_id: parsed.truckId,
    input_ward_inscription_ok: parsed.wardInscriptionOk,
    input_phone_displayed_ok: parsed.phoneDisplayedOk,
    input_colour_coding_ok: parsed.colourCodingOk,
    input_amber_light_ok: parsed.amberLightOk,
    input_netting_or_tarpaulin_ok: parsed.nettingOrTarpaulinOk,
    input_gang_ppe_ok: parsed.gangPpeOk,
    input_route_id: parsed.routeId ?? null,
    input_notes: parsed.notes ?? null,
    input_scheduled_date: parsed.scheduledDate ?? getOperationDate()
  });

  if (error) {
    throw new Error(error.message);
  }
}
