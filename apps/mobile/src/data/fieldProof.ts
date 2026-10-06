import * as ImagePicker from "expo-image-picker";
import { supabase } from "../lib/supabase";

const STOP_PROOF_BUCKET = "stop-proofs";
/** Keep proofs small — full-res camera buffers routinely OOM Android after capture. */
const CAMERA_QUALITY = 0.25;
const MAX_UPLOAD_BYTES = 1_800_000;

export type FieldProofCapture = {
  latitude: number | null;
  longitude: number | null;
  localPhotoUri?: string;
  mimeType?: string;
  photoSkippedReason?: string;
};

function expoLocationNativeAvailable(): boolean {
  try {
    // Avoid importing expo-location until the native module exists (old dev clients / Expo Go mismatch).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require("expo-modules-core") as {
      requireOptionalNativeModule: (name: string) => unknown;
    };
    return requireOptionalNativeModule("ExpoLocation") != null;
  } catch {
    return false;
  }
}

export async function captureStopGps(): Promise<{ latitude: number | null; longitude: number | null }> {
  if (!expoLocationNativeAvailable()) {
    return { latitude: null, longitude: null };
  }

  try {
    const Location = await import("expo-location");
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      return { latitude: null, longitude: null };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    };
  } catch {
    return { latitude: null, longitude: null };
  }
}

async function pickFromLibrary(): Promise<{ uri: string; mimeType: string } | null> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      quality: CAMERA_QUALITY,
      exif: false,
      selectionLimit: 1,
      mediaTypes: ["images"]
    });

    if (result.canceled || !result.assets[0]?.uri) {
      return null;
    }

    return {
      uri: result.assets[0].uri,
      mimeType: result.assets[0].mimeType || "image/jpeg"
    };
  } catch {
    return null;
  }
}

/** Let the Alert / UI settle before opening the camera (reduces Android activity crashes). */
async function settleUi(ms = 250) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function warmStopProofPermissions() {
  try {
    await ImagePicker.requestMediaLibraryPermissionsAsync();
  } catch {
    // ignore
  }
  try {
    await ImagePicker.requestCameraPermissionsAsync();
  } catch {
    // ignore
  }
}

export async function captureStopProofPhoto(
  source: "camera" | "library" = "library"
): Promise<{ uri: string; mimeType: string } | null> {
  if (source === "library") {
    return pickFromLibrary();
  }

  await settleUi();

  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.granted) {
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: CAMERA_QUALITY,
        exif: false,
        cameraType: ImagePicker.CameraType.back
      });

      if (!result.canceled && result.assets[0]?.uri) {
        return {
          uri: result.assets[0].uri,
          mimeType: result.assets[0].mimeType || "image/jpeg"
        };
      }

      if (result.canceled) {
        return null;
      }
    }
  } catch {
    // Fall through to library if camera native path crashes or is unavailable.
  }

  return pickFromLibrary();
}

export async function uploadStopProofFromUri(input: {
  operatorId: string;
  stopId: string;
  uri: string;
  mimeType?: string | null;
}): Promise<string> {
  if (!supabase) {
    throw new Error("Stop proof upload requires a live Supabase session.");
  }

  const mimeType = input.mimeType || "image/jpeg";
  const ext = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const objectPath = `${input.operatorId}/${input.stopId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  // Prefer RN FormData file upload (avoids loading the whole image as ArrayBuffer).
  const formFile = {
    uri: input.uri,
    name: `stop-proof.${ext}`,
    type: mimeType
  } as unknown as Blob;

  try {
    const { error } = await supabase.storage.from(STOP_PROOF_BUCKET).upload(objectPath, formFile, {
      cacheControl: "3600",
      contentType: mimeType,
      upsert: false
    });
    if (!error) {
      return objectPath;
    }
  } catch {
    // Fall through to bounded ArrayBuffer upload.
  }

  const response = await fetch(input.uri);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("Photo is too large to upload — stop is already saved without the photo.");
  }

  const { error } = await supabase.storage.from(STOP_PROOF_BUCKET).upload(objectPath, bytes, {
    cacheControl: "3600",
    contentType: mimeType,
    upsert: false
  });

  if (error) {
    throw new Error(error.message);
  }

  return objectPath;
}

export async function captureFieldProof(options?: { includePhoto?: boolean }): Promise<FieldProofCapture> {
  const gps = await captureStopGps();
  if (!options?.includePhoto) {
    return { ...gps };
  }

  try {
    const photo = await captureStopProofPhoto();
    if (!photo) {
      return {
        ...gps,
        photoSkippedReason: "Photo unavailable — stop will sync without proof."
      };
    }

    return {
      ...gps,
      localPhotoUri: photo.uri,
      mimeType: photo.mimeType
    };
  } catch {
    return {
      ...gps,
      photoSkippedReason: "Photo unavailable — stop will sync without proof."
    };
  }
}
