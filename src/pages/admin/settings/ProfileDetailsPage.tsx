import { useEffect, useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore, applyTheme } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { uploadImage } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import ProfileCard from "@/components/shop/ProfileCard";
import BranchesSection from "@/components/shop/BranchesSection";

/**
 * The account itself, as a page: who this person is, and every branch they run.
 *
 * Settings shows the card, the shop's figures and the shop's own menu; this is the other half.
 * It used to carry the edit form as a panel of its own, which pushed the branches — the thing
 * most owners came here for — off the bottom of the screen. The form is a bottom sheet again,
 * opened by the card's own Edit button, exactly as it was before the card became a row: it is a
 * two-field form, and a form is what a sheet is for. The page itself is now only facts.
 *
 * The shop's menu (Money, Stock, People, App) was rendered here until 2026-10-26. It moved back
 * to Settings, so reaching Purchases or Reports no longer means opening your own profile first;
 * this page is left with the two things that are genuinely about the account: the person and
 * their branches.
 */
export default function ProfileDetailsPage() {
  const t = useT();
  const base = useShellBase();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const { theme, language } = useThemeStore();
  const isUrdu = language === "ur";

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editImageUrl, setEditImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { applyTheme(theme); }, []);

  function startEdit() {
    setEditName(user?.name ?? "");
    setEditImageUrl(user?.photoUrl ?? null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      // `.select()` is not decoration: RLS on `users` filters the row, and PostgREST answers a
      // filtered UPDATE with 204 — no error. A write without it therefore reported success,
      // updated the local store and closed the sheet while the database never changed, which is
      // why a new photo came back as the initials after a reload. Asking for the updated row back
      // turns that silent no-op into zero rows, which is a failure we can show.
      const { data, error } = await supabase
        .from("users")
        .update({ name: editName.trim(), photo_url: editImageUrl })
        .eq("id", user!.id)
        .select("id, name, photo_url");

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Profile update matched no rows (not saved)");
      }

      const saved = data[0];
      useAuthStore.getState().setUser({
        ...user!,
        name: saved.name ?? editName.trim(),
        photoUrl: saved.photo_url ?? undefined,
      });
      setEditing(false);
      addToast(t("settings.profileSaved"), "success");
    } catch (err) {
      console.error("Profile save failed:", err);
      addToast(t("copy.profileSaveFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      setEditImageUrl(await uploadImage("employee-photos", file));
    } catch (err) {
      // Was silent, so a failed upload looked like nothing happened at all.
      console.error("Avatar upload failed:", err);
      addToast(t("copy.profileSaveFailed"), "error");
    } finally {
      setUploading(false);
    }
  }

  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "OW";

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("settings.profileDetail")} backTo={`${base}/settings`} />

      {/* The card they came from, rendered by the same component Settings uses, so the thing at
          the top of this page is the thing at the top of Settings. Its trailing control is Edit
          rather than a chevron: this screen IS the profile, so there is nothing to point at. */}
      <ProfileCard testId="profile-details-card" onEdit={startEdit} editTestId="settings-edit-profile" />

      {/* The branches this account runs. They moved here from the owner suite's More screen and
          then from Settings: a branch is a fact about the account itself, so it belongs on the
          one screen that is about the account. One component (`shop/BranchesSection`) renders
          them wherever they live, so no two copies can disagree. */}
      <BranchesSection />

      <div className="pb-6" />

      {/* Edit Profile sheet — two fields, so a sheet, so the page above it holds only facts. */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "var(--scrim)" }}
          onClick={() => setEditing(false)}
        >
          <div
            className="w-full max-w-[390px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4"
            style={{ background: "var(--tone-sheet)", border: "1px solid var(--divider)", borderBottom: "none" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="flex justify-center mb-2">
              <div className="w-10 h-1 rounded-full" style={{ background: "var(--divider)" }} />
            </div>
            <p className="text-base font-bold text-center" style={{ color: "var(--text-primary)" }}>
              {t("common.edit")} {t("settings.profilePhoto")}
            </p>
            {/* Image upload */}
            <div className="flex justify-center">
              <div className="relative">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                <div
                  className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center text-xl font-bold cursor-pointer"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : editImageUrl ? (
                    <img src={editImageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="account-badge"
                  aria-label={t("settings.profilePhoto")}
                  className="absolute -bottom-1 -end-1 w-6 h-6 rounded-full flex items-center justify-center shadow"
                  style={{ background: "var(--brand)", color: "#0a0a0a" }}
                >
                  <Pencil size={10} strokeWidth={2.5} />
                </button>
              </div>
            </div>
            <div>
              <p className="ds-section-label mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("common.name")}</p>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                aria-label={t("common.name")}
                className="w-full h-12 px-4 text-sm outline-none"
                style={{
                  background: "var(--field-bg)",
                  color: "var(--text-primary)",
                }}
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex-1 h-12 rounded-full text-sm font-bold"
                style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving}
                className="flex-1 h-12 rounded-full text-sm font-bold disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
