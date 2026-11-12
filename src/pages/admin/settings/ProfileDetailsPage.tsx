import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Hash,
  Loader2,
  Pencil,
  Phone,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Sheet from "@/components/ui/Sheet";
import OTPInput from "@/components/ui/OTPInput";
import ImageCrop from "@/components/ui/ImageCrop";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore, applyTheme } from "@/stores/themeStore";
import { useShopStore } from "@/stores/shopStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { uploadImage } from "@/lib/storage";
import { supabase } from "@/lib/supabase";
import { resolveImageUrl } from "@/lib/storage";
import Photo from "@/components/ui/Photo";
import { experienceOf } from "@/lib/experience";
import { normalizePhone, requestPhoneChange, completePhoneChange } from "@/lib/auth";
import { DEMO_OTP_CODE, isDemoOtpMode } from "@/lib/authMode";
import { OTP_RESEND_DELAY_SECONDS } from "@/lib/otpPolicy";
import { formatDate, formatPhoneDisplay, formatSmartDateTime } from "@/lib/formatters";
import { clearDeviceSession, saveDeviceSession } from "@/lib/deviceSession";
import { rememberLastProfile } from "@/lib/loginWindow";
import type { User } from "@/types";

/** Keep a directory list already on screen from showing the old name or number. */
function syncDirectory(next: User) {
  useEmployeesStore.setState((state) => ({
    employees: state.employees.map((employee) => employee.id === next.id
      ? { ...employee, name: next.name, phone: next.phone, photoUrl: next.photoUrl }
      : employee),
  }));
}

/**
 * The person, not the business.
 *
 * This page used to open with the shared account card and then list every branch, which made a
 * tap on "Profile" land on a second business screen. The reference is a person's profile: a
 * portrait, their name, the number they sign in with, and the facts the app actually holds about
 * them. The branch is here only as their working context; the business record lives in
 * Business Profile.
 *
 * Phone is the login identity, so changing it is not a normal text-field save. The sheet sends a
 * code to the new number first, verifies it, and only then asks the server RPC to move the app row
 * and auth credential together. A duplicate number is rejected before the code is wasted where
 * the existing lookup can answer it, and again by the unique constraint in the transaction.
 */
export default function ProfileDetailsPage() {
  const t = useT();
  const base = useShellBase();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const { theme, language } = useThemeStore();
  const activeBranchName = useShopStore((s) => s.activeBranchName);
  const isUrdu = language === "ur";

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Phone change is deliberately a two-step sheet. The number on screen is only moved after the
  // new one has been proved; the sheet keeps the pending canonical number so the verify step
  // cannot be redirected to a different number by editing a hidden field.
  const [phoneStep, setPhoneStep] = useState<"number" | "code" | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [codePhone, setCodePhone] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const sendLock = useRef(false);
  const verifyLock = useRef(false);

  useEffect(() => { applyTheme(theme); }, []);

  // One timer, restarted by a resend. The button is disabled while it runs, so a thumb cannot
  // spend several SMSes (or several live-provider requests) in a row.
  useEffect(() => {
    if (phoneStep !== "code" || resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [phoneStep, resendIn]);

  function beginNameEdit() {
    setNameDraft(user?.name ?? "");
    setEditingName(true);
    window.setTimeout(() => nameInputRef.current?.focus(), 0);
  }

  async function saveName() {
    if (!nameDraft.trim() || savingName) return;
    setSavingName(true);
    try {
      // `.select()` is not decoration: RLS on `users` filters the row, and PostgREST answers a
      // filtered UPDATE with 204 — no error. A write without it therefore reported success,
      // updated the local store and closed the sheet while the database never changed, which is
      // why a new photo came back as the initials after a reload. Asking for the updated row back
      // turns that silent no-op into zero rows, which is a failure we can show.
      const { data, error } = await supabase
        .from("users")
        .update({ name: nameDraft.trim() })
        .eq("id", user!.id)
        .select("id, name");

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Profile update matched no rows (not saved)");
      }

      const saved = data[0];
      const nextUser = {
        ...user!,
        name: saved.name ?? nameDraft.trim(),
      };
      useAuthStore.getState().setUser(nextUser);
      syncDirectory(nextUser);
      await rememberLastProfile(nextUser);
      setEditingName(false);
      setNameDraft("");
      addToast(t("settings.profileSaved"), "success");
    } catch (err) {
      console.error("Profile save failed:", err);
      addToast(t("copy.profileSaveFailed"), "error");
    } finally {
      setSavingName(false);
    }
  }

  /** Choosing a picture only opens the frame; the upload happens once it is confirmed. */
  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    setPendingAvatar(file);
  }

  async function uploadAvatar(file: File) {
    setPendingAvatar(null);
    setUploading(true);
    try {
      const url = await uploadImage("employee-photos", file);
      const { data, error } = await supabase
        .from("users")
        .update({ photo_url: url })
        .eq("id", user!.id)
        .select("id, photo_url");
      if (error) throw error;
      if (!data?.length) throw new Error("Profile photo matched no rows (not saved)");

      const nextUser = { ...user!, photoUrl: resolveImageUrl(data[0].photo_url) };
      useAuthStore.getState().setUser(nextUser);
      syncDirectory(nextUser);
      await rememberLastProfile(nextUser);
      addToast(t("settings.profileSaved"), "success");
    } catch (err) {
      console.error("Avatar upload failed:", err);
      addToast(t("copy.profileSaveFailed"), "error");
    } finally {
      setUploading(false);
    }
  }

  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "OW";

  if (!user) return null;

  const experience = experienceOf(user);
  const roleLabel = experience === "owner"
    ? t("settings.owner")
    : experience === "co_owner"
      ? t("profile.coOwner")
      : user.roleName || (user.membershipRole === "admin" ? t("emp.admin") : t("search.employee"));
  const branchLabel = activeBranchName ?? t("audit.noBranch");
  const shownPhone = formatPhoneDisplay(user.phone) ?? user.phone;

  function openPhoneChange() {
    setNewPhone("");
    setCodePhone("");
    setOtp("");
    setPhoneError("");
    setPhoneStep("number");
  }

  function closePhoneChange() {
    setPhoneStep(null);
    setNewPhone("");
    setCodePhone("");
    setOtp("");
    setPhoneError("");
    setSending(false);
    setVerifying(false);
    setResendIn(0);
  }

  function phoneValidationMessage(canonical: string): string | null {
    if (canonical.length !== 12 || !canonical.startsWith("923")) return t("profile.invalidPhone");
    if (canonical === normalizePhone(user!.phone)) return t("profile.samePhone");
    return null;
  }

  async function sendCode() {
    if (sending || sendLock.current) return;
    const canonical = normalizePhone(newPhone);
    const validation = phoneValidationMessage(canonical);
    if (validation) { setPhoneError(validation); return; }

    sendLock.current = true;
    setSending(true);
    setPhoneError("");
    try {
      // This is the same anon lookup the sign-in screen uses. It is only an early, friendly
      // duplicate check; the change RPC repeats it inside the transaction, where it counts.
      const { data } = await supabase.rpc("lookup_user_by_phone", { p_phone: canonical });
      const found = data as { id?: string } | null;
      if (found?.id && found.id !== user!.id) {
        setPhoneError(t("profile.phoneTaken"));
        return;
      }

      const sent = await requestPhoneChange(canonical);
      if (!sent.success) {
        setPhoneError(t("profile.phoneChangeFailed"));
        return;
      }
      setCodePhone(canonical);
      setOtp("");
      setResendIn(OTP_RESEND_DELAY_SECONDS);
      setPhoneStep("code");
    } catch {
      setPhoneError(t("profile.phoneChangeFailed"));
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }

  async function verifyCode() {
    if (verifying || verifyLock.current || otp.length !== 6) return;
    verifyLock.current = true;
    setVerifying(true);
    setPhoneError("");
    try {
      const result = await completePhoneChange(codePhone, otp);
      if (result.status === "wrong_code") { setPhoneError(t("profile.wrongCode")); setOtp(""); return; }
      if (result.status === "taken") { setPhoneError(t("profile.phoneTaken")); return; }
      if (result.status === "invalid") { setPhoneError(t("profile.invalidPhone")); return; }
      if (result.status === "unchanged") { setPhoneError(t("profile.samePhone")); return; }
      if (result.status === "not_verified") { setPhoneError(t("profile.wrongCode")); return; }
      if (result.status === "error") { setPhoneError(t("profile.phoneChangeFailed")); return; }

      const nextUser = { ...user!, phone: result.phone };
      useAuthStore.getState().setUser(nextUser);
      syncDirectory(nextUser);
      await rememberLastProfile(nextUser);
      try {
        saveDeviceSession(result.phone);
        clearDeviceSession(user!.phone);
        clearDeviceSession(normalizePhone(user!.phone));
      } catch { /* local device markers are only a convenience */ }
      closePhoneChange();
      addToast(t("profile.phoneChanged"), "success");
    } catch {
      setPhoneError(t("profile.phoneChangeFailed"));
    } finally {
      verifyLock.current = false;
      setVerifying(false);
    }
  }

  async function resendCode() {
    if (resendIn > 0 || sending) return;
    setSending(true);
    setPhoneError("");
    try {
      const sent = await requestPhoneChange(codePhone);
      if (!sent.success) { setPhoneError(t("profile.phoneChangeFailed")); return; }
      setOtp("");
      setResendIn(OTP_RESEND_DELAY_SECONDS);
    } catch {
      setPhoneError(t("profile.phoneChangeFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("profile.title")} backTo={`${base}/settings`} />

      <div className="flex flex-col items-center px-5 pt-7 pb-7" data-testid="profile-hero">
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
        <div className="relative">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            aria-label={t("profile.changePhoto")}
            data-testid="profile-avatar"
            className="size-24 rounded-full overflow-hidden flex items-center justify-center text-2xl font-bold ds-pressable disabled:opacity-70"
            style={{ background: "var(--brand)", color: "var(--ink-fg)" }}
          >
            {uploading ? (
              <Loader2 size={22} className="animate-spin" />
            ) : (
              <Photo src={user.photoUrl} className="w-full h-full object-cover" fallback={initials} />
            )}
          </button>
          <span className="absolute -bottom-0.5 -end-0.5 size-7 rounded-full flex items-center justify-center pointer-events-none" style={{ background: "var(--brand)", color: "var(--ink-fg)", border: "2px solid var(--background)" }}>
            <Pencil size={11} strokeWidth={2.5} />
          </span>
        </div>

        <h1 className="mt-4 text-20 font-bold text-center break-words" data-testid="profile-name">
          {user.name}
        </h1>

        <div className="mt-1.5 flex items-center justify-center gap-2 flex-wrap">
          <span className="text-11 font-bold h-6 px-2 rounded-full flex items-center" style={{ background: "var(--brand)", color: "var(--ink-fg)" }} data-testid="profile-role">
            {roleLabel}
          </span>
          <span className="text-12" style={{ color: "var(--text-secondary)" }}>{branchLabel}</span>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-13 font-medium" dir="ltr" data-testid="profile-phone">
          {shownPhone}
          <BadgeCheck size={13} strokeWidth={2.4} style={{ color: "var(--brand-dark)" }} aria-hidden="true" />
          <span className="sr-only">{t("business.verified")}</span>
        </p>
      </div>

      <section style={{ borderTop: "1px solid var(--divider)" }}>
        <div className="px-5 pt-5 pb-0.5">
          <h2 className="ds-section-label">{t("profile.personalInfo")}</h2>
        </div>
        <div className="px-5">
          <div className="flex items-center gap-3 py-3.5" data-testid="profile-row-name">
            <UserRound size={15} strokeWidth={2} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
            <div className="min-w-0 flex-1">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("common.name")}</p>
              {editingName ? (
                <input
                  ref={nameInputRef}
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveName();
                    if (e.key === "Escape") { setEditingName(false); setNameDraft(""); }
                  }}
                  aria-label={t("common.name")}
                  autoComplete="name"
                  className="w-full mt-0.5 text-14 font-medium bg-transparent outline-none border-b"
                  style={{ borderColor: "var(--brand)", color: "var(--text-primary)" }}
                  data-testid="profile-name-input"
                />
              ) : (
                <p className="mt-0.5 text-14 font-medium break-words" data-testid="profile-row-name-value">{user.name}</p>
              )}
            </div>
            {editingName ? (
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => void saveName()} disabled={savingName || !nameDraft.trim()} aria-label={t("common.save")} data-testid="profile-name-save" className="size-8 rounded-full flex items-center justify-center disabled:opacity-40" style={{ background: "var(--brand)", color: "var(--ink-fg)" }}>
                  <Check size={15} />
                </button>
                <button type="button" onClick={() => { setEditingName(false); setNameDraft(""); }} aria-label={t("common.cancel")} data-testid="profile-name-cancel" className="size-8 rounded-full flex items-center justify-center" style={{ color: "var(--text-secondary)" }}>
                  <X size={15} />
                </button>
              </div>
            ) : (
              <button type="button" onClick={beginNameEdit} data-testid="profile-change-name" className="shrink-0 text-12 font-semibold ds-pressable flex items-center gap-0.5" style={{ color: "var(--text-secondary)" }}>
                {t("profile.changeName")}
                <ChevronRight size={13} />
              </button>
            )}
          </div>
          <InfoRow
            icon={Phone}
            label={t("common.phone")}
            value={shownPhone}
            valueDir="ltr"
            verified
            actionLabel={t("profile.changePhone")}
            onAction={openPhoneChange}
            testId="profile-row-phone"
          />
          <InfoRow icon={ShieldCheck} label={t("profile.role")} value={roleLabel} testId="profile-row-role" />
          <InfoRow icon={Building2} label={t("profile.branch")} value={branchLabel} testId="profile-row-branch" />
          {user.employeeNumber && (
            <InfoRow icon={Hash} label={t("profile.employeeId")} value={user.employeeNumber} valueDir="ltr" testId="profile-row-employee" />
          )}
          {user.jobTitle && (
            <InfoRow icon={BriefcaseBusiness} label={t("profile.jobTitle")} value={user.jobTitle} testId="profile-row-job" />
          )}
        </div>
      </section>

      <section style={{ borderTop: "1px solid var(--divider)" }}>
        <div className="px-5 pt-5 pb-0.5">
          <h2 className="ds-section-label">{t("profile.account")}</h2>
        </div>
        <div className="px-5 pb-3">
          <InfoRow first icon={CalendarDays} label={t("profile.memberSince")} value={formatDate(user.createdAt)} testId="profile-row-joined" />
          <InfoRow
            icon={Clock3}
            label={t("profile.lastSignIn")}
            value={user.lastLoginAt ? formatSmartDateTime(user.lastLoginAt, undefined, t) : t("profile.never")}
            testId="profile-row-last-login"
          />
          <InfoRow icon={ShieldCheck} label={t("profile.status")} value={t("profile.active")} testId="profile-row-status" />
        </div>
      </section>

      <div className="pb-8" />

      <Sheet
        open={phoneStep !== null}
        title={phoneStep === "code" ? t("profile.verifyPhoneTitle") : t("profile.changePhoneTitle")}
        onClose={closePhoneChange}
        closeButton={false}
      >
        {phoneStep === "number" && (
          <div className="px-5 pb-6 flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4 py-1" style={{ borderBottom: "1px solid var(--divider)" }}>
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("profile.currentPhone")}</p>
              <p className="text-14 font-semibold" dir="ltr">{shownPhone}</p>
            </div>
            <div>
              <label className="ds-section-label block mb-1.5" htmlFor="profile-new-phone" style={{ color: "var(--text-secondary)" }}>{t("profile.newPhone")}</label>
              <input
                id="profile-new-phone"
                value={newPhone}
                onChange={(e) => { setNewPhone(e.target.value); setPhoneError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") void sendCode(); }}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t("common.phonePlaceholder")}
                className="w-full h-12 px-4 rounded-[var(--radius-control)] text-14 outline-none"
                style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
                data-testid="profile-new-phone"
              />
              <p className="mt-2 text-11 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{t("profile.newPhoneHint")}</p>
            </div>
            {phoneError && <p className="text-12" style={{ color: "var(--error)" }} role="alert">{phoneError}</p>}
            <button type="button" onClick={sendCode} disabled={sending || !newPhone.trim()} className="h-12 rounded-full text-13 font-bold disabled:opacity-50" style={{ background: "var(--brand)", color: "var(--ink-fg)" }} data-testid="profile-send-code">
              {sending ? t("profile.sending") : t("profile.sendCode")}
            </button>
          </div>
        )}
        {phoneStep === "code" && (
          <div className="px-5 pb-6 flex flex-col gap-4">
            <p className="text-13 text-center leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {t("profile.codeSent", { phone: formatPhoneDisplay(codePhone) ?? codePhone })}
            </p>
            <OTPInput value={otp} onChange={(value) => { setOtp(value); setPhoneError(""); }} disabled={verifying} error={Boolean(phoneError)} />
            {isDemoOtpMode && <p className="text-12 text-center" style={{ color: "var(--text-tertiary)" }}>{t("profile.demoCode", { code: DEMO_OTP_CODE })}</p>}
            {phoneError && <p className="text-12 text-center" style={{ color: "var(--error)" }} role="alert">{phoneError}</p>}
            <button type="button" onClick={() => void verifyCode()} disabled={verifying || otp.length !== 6} className="h-12 rounded-full text-13 font-bold disabled:opacity-50" style={{ background: "var(--brand)", color: "var(--ink-fg)" }} data-testid="profile-verify-code">
              {verifying ? t("auth.verifying") : t("profile.verifyAndChange")}
            </button>
            <button type="button" onClick={() => void resendCode()} disabled={sending || resendIn > 0} className="text-12 font-semibold disabled:opacity-50" style={{ color: "var(--brand-dark)" }}>
              {resendIn > 0 ? t("profile.resendIn", { seconds: resendIn }) : t("profile.resend")}
            </button>
          </div>
        )}
      </Sheet>

      {/* The picture is framed before it is stored, the same step every other image in the app
          gets: the tile is a circle, so the frame is a square and what is saved is what is seen. */}
      {pendingAvatar && (
        <ImageCrop
          file={pendingAvatar}
          aspect={1}
          onCancel={() => setPendingAvatar(null)}
          onConfirm={(file) => void uploadAvatar(file)}
        />
      )}
    </div>
  );
}

/** One fact about the person. The action is a sibling of the text, never nested in it. */
function InfoRow({
  icon: Icon,
  label,
  value,
  actionLabel,
  onAction,
  verified = false,
  valueDir,
  first = false,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  actionLabel?: string;
  onAction?: () => void;
  verified?: boolean;
  valueDir?: "ltr" | "rtl" | "auto";
  first?: boolean;
  testId?: string;
}) {
  const t = useT();
  return (
    <div
      className="flex items-center gap-3 py-3.5"
      style={{ borderTop: first ? "none" : "1px solid var(--divider)" }}
      data-testid={testId}
    >
      <Icon size={15} strokeWidth={2} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
      <div className="min-w-0 flex-1">
        <p className="text-11" style={{ color: "var(--text-secondary)" }}>{label}</p>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <p className="text-14 font-medium break-words" dir={valueDir}>{value}</p>
          {verified && (
            <>
              <BadgeCheck size={13} strokeWidth={2.4} className="shrink-0" style={{ color: "var(--brand-dark)" }} aria-hidden="true" />
              <span className="sr-only">{t("business.verified")}</span>
            </>
          )}
        </div>
      </div>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="shrink-0 text-12 font-semibold ds-pressable flex items-center gap-0.5" style={{ color: "var(--text-secondary)" }}>
          {actionLabel}
          <ChevronRight size={13} />
        </button>
      )}
    </div>
  );
}
