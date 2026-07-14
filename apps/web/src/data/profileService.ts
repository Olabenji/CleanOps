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

function extensionForMime(mimeType: string, fileName: string) {
  if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
    return "pdf";
  }

  if (mimeType === "image/png" || fileName.toLowerCase().endsWith(".png")) {
    return "png";
  }

  if (mimeType === "image/webp" || fileName.toLowerCase().endsWith(".webp")) {
    return "webp";
  }

  if (mimeType === "image/svg+xml" || fileName.toLowerCase().endsWith(".svg")) {
    return "svg";
  }

  return "jpg";
}

export async function uploadDriverLicenceDocument(input: {
  operatorId: string;
  staffId: string;
  file: File;
}): Promise<string> {
  if (!supabase) {
    throw new Error("Licence upload requires a live Supabase session.");
  }

  const ext = extensionForMime(input.file.type, input.file.name);
  const objectPath = `${input.operatorId}/${input.staffId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(LICENCE_BUCKET).upload(objectPath, input.file, {
    cacheControl: "3600",
    contentType: input.file.type || undefined,
    upsert: false
  });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from(LICENCE_BUCKET).getPublicUrl(objectPath);
  // Bucket is private; prefer a short-lived signed URL for display/storage metadata.
  const { data: signed, error: signedError } = await supabase.storage
    .from(LICENCE_BUCKET)
    .createSignedUrl(objectPath, 60 * 60 * 24 * 7);

  if (signedError || !signed?.signedUrl) {
    // Fall back to path-style public URL only if signing fails (legacy objects).
    return data.publicUrl;
  }

  return signed.signedUrl;
}
