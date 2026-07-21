import {
  createOperatorTenantInputSchema,
  createOperatorTenantResultSchema,
  platformOperatorSchema,
  setOperatorStatusInputSchema,
  type CreateOperatorTenantInput,
  type CreateOperatorTenantResult,
  type PlatformOperator,
  type SetOperatorStatusInput
} from "@cleanops/shared";
import { z } from "zod";
import { supabase } from "../lib/supabase";

export async function listOperators(): Promise<PlatformOperator[]> {
  if (!supabase) {
    throw new Error("Platform console requires Supabase.");
  }

  const { data, error } = await supabase.rpc("list_operators");

  if (error) {
    throw new Error(error.message);
  }

  return z.array(platformOperatorSchema).parse(data ?? []);
}

export async function createOperatorTenant(
  input: CreateOperatorTenantInput
): Promise<CreateOperatorTenantResult> {
  const parsed = createOperatorTenantInputSchema.parse(input);

  if (!supabase) {
    throw new Error("Platform console requires Supabase.");
  }

  const { data, error } = await supabase.rpc("create_operator_tenant", {
    input_name: parsed.name,
    input_slug: parsed.slug,
    input_owner_full_name: parsed.ownerFullName,
    input_owner_email: parsed.ownerEmail,
    input_owner_phone: parsed.ownerPhone,
    input_plan_code: parsed.planCode,
    input_brand_name: parsed.brandName ?? parsed.name,
    input_lawma_reference: parsed.lawmaReference ?? null,
    input_status: parsed.status,
    input_timezone: parsed.timezone
  });

  if (error) {
    throw new Error(error.message);
  }

  return createOperatorTenantResultSchema.parse(data);
}

export async function setOperatorStatus(input: SetOperatorStatusInput): Promise<void> {
  const parsed = setOperatorStatusInputSchema.parse(input);

  if (!supabase) {
    throw new Error("Platform console requires Supabase.");
  }

  const { error } = await supabase.rpc("set_operator_status", {
    input_operator_id: parsed.operatorId,
    input_status: parsed.status
  });

  if (error) {
    throw new Error(error.message);
  }
}
