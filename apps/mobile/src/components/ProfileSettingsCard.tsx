import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { FieldSession } from "../lib/fieldSession";
import {
  getOwnAccountProfile,
  setStaffLicence,
  updateOwnProfile,
  uploadDriverLicenceFromUri
} from "../data/profileService";

export default function ProfileSettingsCard({
  onProfileUpdated,
  session
}: {
  onProfileUpdated: (next: Pick<FieldSession, "fullName" | "phone">) => void;
  session: FieldSession;
}) {
  const [fullName, setFullName] = useState(session.fullName);
  const [phone, setPhone] = useState(session.phone ?? "");
  const [staffId, setStaffId] = useState<string | null>(null);
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [licenceExpiresOn, setLicenceExpiresOn] = useState("");
  const [licenceImageUrl, setLicenceImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(session.mode === "supabase");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.mode !== "supabase") {
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const account = await getOwnAccountProfile();
        setFullName(account.fullName);
        setPhone(account.phone);
        setStaffId(account.staffId);
        setOperatorId(account.operatorId);
        setLicenceExpiresOn(account.licenceExpiresOn?.slice(0, 10) ?? "");
        setLicenceImageUrl(account.licenceImageUrl);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load profile");
      } finally {
        setLoading(false);
      }
    })();
  }, [session.mode]);

  async function handleSaveProfile() {
    setError(null);
    setMessage(null);
    setSaving(true);

    try {
      if (session.mode !== "supabase") {
        onProfileUpdated({ fullName: fullName.trim(), phone: phone.trim() });
        setMessage("Profile updated in offline demo.");
        return;
      }

      const updated = await updateOwnProfile({
        fullName: fullName.trim(),
        phone: phone.trim()
      });
      onProfileUpdated({ fullName: updated.fullName, phone: updated.phone });
      setMessage("Profile saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handlePickLicence() {
    setError(null);
    setMessage(null);

    if (session.role !== "driver") {
      return;
    }

    if (session.mode !== "supabase") {
      setError("Licence upload needs a live Supabase session.");
      return;
    }

    if (!staffId || !operatorId) {
      setError("No linked driver staff profile found for this login.");
      return;
    }

    if (!licenceExpiresOn) {
      setError("Set licence expiry before uploading.");
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library permission is required to upload a licence.");
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85
    });

    if (picked.canceled || !picked.assets[0]) {
      return;
    }

    const asset = picked.assets[0];
    setUploading(true);

    try {
      const publicUrl = await uploadDriverLicenceFromUri({
        operatorId,
        staffId,
        uri: asset.uri,
        mimeType: asset.mimeType
      });
      const result = await setStaffLicence({
        staffId,
        licenceExpiresOn,
        licenceImageUrl: publicUrl
      });
      setLicenceImageUrl(result.licenceImageUrl);
      setMessage("Licence document uploaded.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload licence");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#1a7f45" />
        <Text style={styles.copy}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Your profile</Text>
      <Text style={styles.copy}>Update the name and phone on your login account.</Text>

      <Text style={styles.label}>Full name</Text>
      <TextInput onChangeText={setFullName} style={styles.input} value={fullName} />

      <Text style={styles.label}>Phone</Text>
      <TextInput
        keyboardType="phone-pad"
        onChangeText={setPhone}
        style={styles.input}
        value={phone}
      />

      <Pressable disabled={saving} onPress={() => void handleSaveProfile()} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>{saving ? "Saving..." : "Save profile"}</Text>
      </Pressable>

      {session.role === "driver" ? (
        <View style={styles.licenceBlock}>
          <Text style={styles.title}>Driver licence</Text>
          <Text style={styles.copy}>Upload a clear photo of your licence for operator records.</Text>
          <Text style={styles.label}>Expiry (YYYY-MM-DD)</Text>
          <TextInput
            onChangeText={setLicenceExpiresOn}
            placeholder="2027-08-12"
            style={styles.input}
            value={licenceExpiresOn}
          />
          {licenceImageUrl ? (
            <Image accessibilityLabel="Current licence" source={{ uri: licenceImageUrl }} style={styles.licenceImage} />
          ) : null}
          <Pressable disabled={uploading} onPress={() => void handlePickLicence()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{uploading ? "Uploading..." : "Upload licence photo"}</Text>
          </Pressable>
        </View>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#d9e7db",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginTop: 12,
    padding: 16
  },
  title: {
    color: "#102017",
    fontSize: 17,
    fontWeight: "800"
  },
  copy: {
    color: "#637466",
    fontSize: 14,
    lineHeight: 20
  },
  label: {
    color: "#102017",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4
  },
  input: {
    backgroundColor: "#f4f8f5",
    borderColor: "#d5e4d9",
    borderRadius: 12,
    borderWidth: 1,
    color: "#102017",
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#1a7f45",
    borderRadius: 999,
    marginTop: 4,
    paddingVertical: 12
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "800"
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#edf3ee",
    borderRadius: 999,
    paddingVertical: 12
  },
  secondaryButtonText: {
    color: "#102017",
    fontWeight: "800"
  },
  licenceBlock: {
    borderTopColor: "#edf3ee",
    borderTopWidth: 1,
    gap: 10,
    marginTop: 8,
    paddingTop: 12
  },
  licenceImage: {
    borderRadius: 12,
    height: 140,
    resizeMode: "cover",
    width: "100%"
  },
  message: {
    color: "#1a7f45",
    fontWeight: "700"
  },
  error: {
    color: "#a33b2d",
    fontWeight: "700"
  }
});
