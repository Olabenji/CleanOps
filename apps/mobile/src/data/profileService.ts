import {
  ownAccountProfileSchema,
  setStaffLicenceInputSchema,
  staffLicenceResultSchema,
  updateOwnProfileInputSchema,
  type OwnAccountProfile,
  type SetStaffLicenceInput,
  type StaffLicenceResult,
  type UpdateOwnProfileInput
} from "@cleanops/shared";
import { supabase } from "../lib/supabase";

const LICENCE_BUCKET = "driver-licences";

export async function getOwnAccountProfile(): Promise<OwnAccountProfile> {
  if (!supabase) {
    throw new Error("Profile requires a live Supabase session.");
  }

  const { data, error } = await supabase.rpc("get_own_account_profile");

  if (error) {
    throw new Error(error.message);
  }

  return ownAccountProfileSchema.parse(data);
}

export async function updateOwnProfile(input: UpdateOwnProfileInput): Promise<OwnAccountProfile> {
  const parsed = updateOwnProfileInputSchema.parse(input);

  if (!supabase) {
    throw new Error("Profile updates require a live Supabase session.");
  }

  const { data, error } = await supabase.rpc("update_own_profile", {
    input_full_name: parsed.fullName,
    input_phone: parsed.phone
  });

  if (error) {
    throw new Error(error.message);
  }

  return ownAccountProfileSchema.parse(data);
}

export async function setStaffLicence(input: SetStaffLicenceInput): Promise<StaffLicenceResult> {
  const parsed = setStaffLicenceInputSchema.parse(input);

  if (!supabase) {
    throw new Error("Licence updates require a live Supabase session.");
  }

  const { data, error } = await supabase.rpc("set_staff_licence", {
    input_staff_id: parsed.staffId,
    input_licence_expires_on: parsed.licenceExpiresOn,
    input_licence_image_url: parsed.licenceImageUrl
  });

  if (error) {
    throw new Error(error.message);
  }

  return staffLicenceResultSchema.parse(data);
}

export async function uploadDriverLicenceFromUri(input: {
  operatorId: string;
  staffId: string;
  uri: string;
  mimeType?: string | null;
}): Promise<string> {
  if (!supabase) {
    throw new Error("Licence upload requires a live Supabase session.");
  }

  const mimeType = input.mimeType || "image/jpeg";
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const objectPath = `${input.operatorId}/${input.staffId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const response = await fetch(input.uri);
  const bytes = await response.arrayBuffer();

  const { error } = await supabase.storage.from(LICENCE_BUCKET).upload(objectPath, bytes, {
    cacheControl: "3600",
    contentType: mimeType,
    upsert: false
  });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(LICENCE_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}
