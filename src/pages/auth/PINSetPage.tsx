import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Check, ChevronRight, Fingerprint, Loader2 } from "lucide-react";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import PINInput from "@/components/ui/PINInput";
import { savePin } from "@/lib/pinLock";
import { biometricPlatformAvailable, enrolBiometric, hasBiometricEnrolment } from "@/lib/biometric";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useEducationStore } from "@/stores/educationStore";
import { useT } from "@/lib/i18n";

export default function PINSetPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { returnTo?: string; celebrate?: boolean } | null;
  const returnTo = state?.returnTo;
  const celebrate = state?.celebrate === true;
  const { user } = useAuthStore();
  const [done, setDone] = useState(false);
  const [step, setStep] = useState<"set" | "confirm">("set");
  const [firstPin, setFirstPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const [saveError, setSaveError] = useState(false);

  /**
   * The fingerprint, offered at the one moment it can honestly be asked for.
   *
   * The person has just proved who they are — they came through the code step and chose a
   * PIN — and this is the last screen of onboarding, so nothing they are being asked to trust
   * is new to them. Asking anywhere else would be asking a stranger.
   *
   * This is also the *only* place most people will ever meet it. Leaving it to Settings means
   * the finger is offered to whoever happens to open Settings, which for an employee is
   * nobody — and then the lock screen has nothing to offer back, which is how a fingerprint
   * feature quietly does not exist on the phones it was built for.
   *
   * Three states, because "off" and "this phone cannot do it" are different sentences and
   * only one of them is the person's to change.
   */
  const [fingerprint, setFingerprint] = useState<"checking" | "on" | "off" | "unavailable">("checking");
  const [fingerprintBusy, setFingerprintBusy] = useState(false);

  useEffect(() => {
    if (!done || !user) return;
    let alive = true;
    if (hasBiometricEnrolment(user.id)) {
      setFingerprint("on");
      return;
    }
    biometricPlatformAvailable().then((available) => {
      if (alive) setFingerprint(available ? "off" : "unavailable");
    });
    return () => { alive = false; };
  }, [done, user]);

  async function handleEnrolFingerprint() {
    if (!user || fingerprintBusy) return;
    setFingerprintBusy(true);
    try {
      const result = await enrolBiometric(user.id, user.name || user.phone);
      if (result.status === "ok") {
        setFingerprint("on");
        useUIStore.getState().addToast(t("fingerprint.enrolled"), "success");
      } else if (result.status === "unsupported") {
        setFingerprint("unavailable");
        useUIStore.getState().addToast(t("fingerprint.unsupported"), "error");
      } else if (result.status === "cancelled") {
        // Dismissing the prompt is a decision, not a failure. The row stays exactly as it
        // was, so "not now" costs nothing and can be reconsidered a second later.
        useUIStore.getState().addToast(t("fingerprint.cancelled"), "error");
      } else {
        useUIStore.getState().addToast(t("fingerprint.failed"), "error");
      }
    } finally {
      setFingerprintBusy(false);
    }
  }

  async function handleSetComplete(pin: string) {
    if (pin.length < 4) return;
    if (step === "set") {
      setFirstPin(pin);
      setStep("confirm");
      setConfirmPin("");
    } else {
      if (pin !== firstPin) {
        setError(true);
        setShake(true);
        setTimeout(() => { setShake(false); setError(false); setStep("set"); setFirstPin(""); setConfirmPin(""); }, 600);
        return;
      }
      // The PIN is the recurring way back in, so the server holds it (migration 0148) and
      // verifies it. A refusal here is almost always the network — say so and go back to
      // choosing a PIN rather than telling someone their PIN was set when it was not.
      if (user) {
        const saved = await savePin(user.id, pin);
        if (!saved) {
          setSaveError(true);
          setError(true);
          setShake(true);
          setTimeout(() => { setShake(false); setError(false); }, 600);
          setStep("set");
          setFirstPin("");
          setConfirmPin("");
          return;
        }
      }
      // Changing a PIN from Settings is a like-for-like swap: go straight back, with no
      // ceremony. Standing the PIN up for the first time (onboarding it) earns the success
      // screen, which says what changed and offers the two things a new owner wants next.
      if (returnTo && !celebrate) {
        navigate(returnTo, { replace: true });
      } else {
        setDone(true);
      }
    }
  }

  const dest = (user?.role === "admin") ? "/admin/dashboard" : "/employee/dashboard";

  const pin = step === "set" ? firstPin : confirmPin;
  const setter = step === "set" ? setFirstPin : setConfirmPin;

  function handleChange(val: string) {
    setter(val);
    if (val.length === 4) handleSetComplete(val);
  }

  //
  // Done: the PIN is set. Two ways to leave, both real — open the shop, or be shown around it.
  // "Show me around" starts the guided tour *and* lands on the dashboard, because the tour
  // rings elements that live inside the shell; the overlay is mounted there and picks the
  // state up on arrival, so the person sees the tour running over their own dashboard.
  if (done) {
    return (
      <AuthLayout>
        <div className="flex flex-col flex-1 justify-between" data-testid="pin-done">
          <div className="flex flex-col items-center px-6 pt-16 text-center">
            <span
              className="size-16 rounded-full flex items-center justify-center"
              style={{ background: "color-mix(in srgb, var(--brand) 18%, transparent)" }}
            >
              <Check size={30} strokeWidth={2.5} style={{ color: "var(--brand-dark)" }} />
            </span>
            <p className="text-22 font-bold mt-5" style={{ color: "var(--text-primary)" }} data-testid="pin-done-title">
              {t("auth.pinDoneTitle")}
            </p>
            <p className="text-14 mt-2 max-w-[300px]" style={{ color: "var(--text-secondary)" }}>
              {t("auth.pinDoneBody")}
            </p>
          </div>

          <div className="flex flex-col gap-2 p-6">
            {/* The offer, above the two ways out: it is the only thing on this screen being
                asked rather than answered, and it is the last chance to set it up without a
                trip to Settings. Absent when the phone has no finger reader — a row that
                looks tappable and then refuses is worse than one that is not there. */}
            {(fingerprint === "off" || fingerprint === "on") && (
              <button
                type="button"
                onClick={handleEnrolFingerprint}
                disabled={fingerprintBusy || fingerprint === "on"}
                data-testid="pin-done-fingerprint"
                className="w-full flex items-center gap-3 px-4 py-3 rounded-[var(--radius-tile)] text-start ds-pressable"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-control)",
                }}
              >
                <Fingerprint
                  size={22}
                  strokeWidth={1.6}
                  style={{ color: fingerprint === "on" ? "var(--brand-dark)" : "var(--text-secondary)" }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-14 font-bold" style={{ color: "var(--text-primary)" }}>
                    {fingerprint === "on" ? t("fingerprint.enrolled") : t("fingerprint.offerTitle")}
                  </span>
                  <span className="block text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {fingerprint === "on" ? t("fingerprint.offerDone") : t("fingerprint.offerBody")}
                  </span>
                </span>
                {fingerprintBusy
                  ? <Loader2 size={18} className="animate-spin" style={{ color: "var(--brand-dark)" }} />
                  : fingerprint === "on"
                    ? <Check size={18} strokeWidth={2.5} style={{ color: "var(--brand-dark)" }} />
                    : <ChevronRight size={18} style={{ color: "var(--text-tertiary)" }} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate(dest, { replace: true })}
              data-testid="pin-done-open"
              className="ds-btn-brand w-full h-12 text-15 font-bold"
            >
              {t("auth.pinDonePrimary")}
            </button>
            <button
              type="button"
              onClick={() => {
                useEducationStore.getState().startTour();
                navigate(dest, { replace: true });
              }}
              data-testid="pin-done-tour"
              className="w-full h-11 text-14 font-semibold"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("auth.pinDoneTour")}
            </button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <NavHeader title={step === "set" ? t("auth.setPinBtn") : t("auth.confirmPinBtn")} noBack />
      {/* Same measurement as the other PIN screens (see `.ds-auth-screen`): the keypad scales
          with the height the screen actually has, so choosing a PIN is one screen on every
          phone rather than a screen with the last row of keys below the fold. */}
      <div
        className="ds-auth-screen flex flex-col flex-1 items-center px-6"
        style={{ gap: "var(--auth-rhythm, 24px)", paddingBlock: "var(--auth-pad, 24px)" }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-xl font-bold text-foreground">
            {step === "set" ? t("auth.setPinHelp") : t("auth.confirmPin")}
          </p>
          <p className="text-sm text-caption">
            {step === "set"
              ? t("auth.pinSetHintQuick")
              : t("auth.pinReenterHint")}
          </p>
          {error && (
            <p className="text-sm text-[#ef4444]">
              {saveError ? t("copy.storageError") : t("auth.pinMismatch")}
            </p>
          )}
        </div>
        <PINInput value={pin} onChange={handleChange} error={error} shake={shake} />
      </div>
    </AuthLayout>
  );
}
