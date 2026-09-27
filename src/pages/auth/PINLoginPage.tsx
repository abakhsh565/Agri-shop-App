import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Fingerprint, Loader2 } from "lucide-react";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import PINInput from "@/components/ui/PINInput";
import Button from "@/components/ui/Button";
import { verifyPinDetailed, clearPin } from "@/lib/pinLock";
import { biometricPlatformAvailable, hasBiometricEnrolment, unlockWithBiometric } from "@/lib/biometric";
import { useAuthStore } from "@/stores/authStore";
import { getUserFromSession } from "@/lib/auth";
import type { User } from "@/types";
import { useT } from "@/lib/i18n";

/**
 * Single-step PIN login screen.
 * SplashPage passes the user object via navigation state.
 * User enters 4-digit PIN → verified by the server against its bcrypt hash when the server
 * can be reached, and by this device's own record when it cannot, so the keypad works on a
 * phone that has been offline for a week.
 * If the PIN is wrong → stay and retry. If the server says there is no PIN → OTP, which is
 * the documented identity check. If "Forgot PIN" → the forgot-PIN flow.
 */
export default function PINLoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser, setPendingPhone, setPendingFlow } = useAuthStore();

  // User passed from SplashPage via navigation state, or fallback to authStore
  const routeUser = (location.state as { user?: User } | null)?.user;
  const authUser = useAuthStore((s) => s.user);
  const routeUserOrAuth = routeUser ?? authUser;

  const [pinValue, setPinValue] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // "hidden" also covers a phone with no finger reader: the button is only drawn when
  // there is something behind it.
  const [bioState, setBioState] = useState<"hidden" | "ready" | "working" | "failed">("hidden");
  /** The phone is asked once, on arrival. A second automatic prompt is a nag. */
  const promptedRef = useRef(false);

  if (!routeUserOrAuth) {
    // No user at all → go to login
    navigate("/login", { replace: true });
    return null;
  }

  const user: User = routeUserOrAuth;

  /**
   * Enrolling a fingerprint is only worth doing if the app then asks for it.
   *
   * So the prompt happens on arrival, unprompted, whenever this account has a finger
   * enrolled on this phone — which is the entire point of enrolling. Cancelling costs
   * nothing: the keypad is underneath, unchanged, and the button stays there to retry.
   */
  useEffect(() => {
    const who = routeUser ?? authUser;
    if (!who || !hasBiometricEnrolment(who.id)) return;
    let alive = true;
    biometricPlatformAvailable().then((available) => {
      if (!alive || !available) return;
      setBioState("ready");
      if (!promptedRef.current) {
        promptedRef.current = true;
        void runBiometricUnlock();
      }
    });
    return () => { alive = false; };
  }, [routeUser?.id, authUser?.id]);

  /** The one way into the app, whichever check got us here. */
  async function enterApp() {
    // Re-fetch latest user data from DB so profile changes made by an admin (or elsewhere)
    // are reflected; the PIN and the fingerprint both land here.
    const freshUser = await getUserFromSession();
    setUser(freshUser ?? user);
    const dest = user.role === "admin" || user.role === "co_admin"
      ? "/admin/dashboard" : "/employee/dashboard";
    navigate(dest, { replace: true });
  }

  async function runBiometricUnlock() {
    if (bioState === "working") return;
    setError("");
    setBioState("working");
    const result = await unlockWithBiometric(user.id);
    if (result.status === "ok") {
      await enterApp();
      return;
    }
    if (result.status === "not_enrolled") {
      // A stale record on the phone. Hide the button rather than offering something that
      // cannot work; the PIN below is untouched.
      setBioState("hidden");
      return;
    }
    if (result.status === "cancelled") {
      // Dismissed on purpose — say nothing about it.
      setBioState("ready");
      return;
    }
    setBioState("failed");
    setError(t("fingerprint.failed"));
  }

  async function handlePinComplete(val: string) {
    if (val.length < 4 || verifying) return;
    setVerifying(true);
    try {
      const result = await verifyPinDetailed(user.id, val);
      if (result.status === "ok") {
        await enterApp();
      } else if (result.status === "no_pin") {
        // The server says this account has no PIN (never set, or cleared elsewhere), and this
        // device holds no copy that could have answered instead. The marker here is stale, so
        // drop it — that is what makes the code screen offer to set a PIN — then go through
        // OTP, which is the documented identity check.
        //
        // Note what no longer lands here: a launch with no connection. That used to be filed
        // as "no PIN" and cost the owner their PIN every time, which is the loop this fixes.
        clearPin(user.id);
        setPendingPhone(user.phone);
        setPendingFlow("login");
        navigate("/login/otp", { replace: true, state: { user } });
      } else if (result.status === "locked") {
        // Too many wrong tries, refused server-side. Nothing is lost — waiting is the way out.
        setError(t("copy.pinLocked"));
        setPinValue("");
      } else if (result.status === "error") {
        // Could not reach the server — NOT a wrong PIN. Clear nothing, allow retry.
        setError(t("copy.pinCheckFailed"));
        setPinValue("");
      } else {
        // result.status === "wrong" — genuinely incorrect PIN
        // Allow retry, do NOT delete the stored PIN
        setError(t("copy.pinWrong"));
        setPinValue("");
      }
    } finally {
      setVerifying(false);
    }
  }

  function handleChange(val: string) {
    setError("");
    setPinValue(val);
    if (val.length === 4) handlePinComplete(val);
  }

  function handleForgotPIN() {
    setPendingPhone(user.phone);
    setPendingFlow("forgot_pin");
    navigate("/login/forgot-pin", { replace: true, state: { user } });
  }

  return (
    <AuthLayout>
      <NavHeader title={t("auth.signIn")} backTo="/login" />
      {/* `ds-auth-screen` carries the one measurement this screen is built from: the key
          size, and the rhythm between the rows. Both read the live viewport height, so the
          whole column — greeting, dots, keypad, "Forgot PIN" — fits a short phone and a
          phone with the keyboard up, with no scrolling. */}
      <div
        className="ds-auth-screen flex flex-col flex-1 items-center px-4 sm:px-6"
        style={{ gap: "var(--auth-rhythm, 24px)", paddingBlock: "var(--auth-pad, 24px)" }}
      >
        <div className="flex flex-col items-center gap-1.5 sm:gap-2 text-center">
          {/* `ds-auth-avatar` scales with the height the screen was given — larger on a tall
              phone, smaller on a short one — so the greeting and the keypad share the budget
              instead of the picture taking a fixed 48px off it either way. */}
          {user.photoUrl ? (
            <img src={user.photoUrl} alt="" className="ds-auth-avatar rounded-full object-cover mb-1" />
          ) : (
            <div
              className="ds-auth-avatar rounded-full flex items-center justify-center text-lg sm:text-xl font-bold mb-1"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <p className="text-lg sm:text-xl font-bold text-foreground">
            Welcome, {user.name.split(" ")[0]}
          </p>
          {/* The one line on this screen that the keypad itself already says — the first to go
              on a short screen (see the max-height rule in the stylesheet). */}
          <p className="ds-auth-hint text-xs sm:text-sm text-caption">{t("auth.pinPrompt")}</p>
          {error && (
            <p className="text-xs sm:text-sm text-[#ef4444]">{error}</p>
          )}
        </div>

        <PINInput value={pinValue} onChange={handleChange} error={!!error} shake={shake} />

        {bioState !== "hidden" && (
          <button
            type="button"
            onClick={() => { if (bioState !== "working") void runBiometricUnlock(); }}
            disabled={bioState === "working"}
            data-testid="use-fingerprint"
            className="flex items-center gap-2 h-11 px-5 rounded-full text-13 font-bold ds-pressable disabled:opacity-60"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
          >
            {bioState === "working"
              ? <Loader2 size={16} className="animate-spin" />
              : <Fingerprint size={16} style={{ color: "var(--brand-dark)" }} />}
            {bioState === "working" ? t("fingerprint.checking") : t("fingerprint.use")}
          </button>
        )}

        {verifying && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-border-control border-t-transparent rounded-full animate-spin" />
            <p className="text-xs sm:text-sm text-caption">{t("auth.verifying")}</p>
          </div>
        )}

        <button onClick={handleForgotPIN} className="text-xs sm:text-sm font-medium text-caption underline underline-offset-2">
          {t("auth.forgotPin")}
        </button>
      </div>
    </AuthLayout>
  );
}
