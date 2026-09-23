import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import PINInput from "@/components/ui/PINInput";
import Button from "@/components/ui/Button";
import { verifyPin, verifyPinDetailed, clearPin } from "@/lib/pinLock";
import { useAuthStore } from "@/stores/authStore";
import { getUserFromSession } from "@/lib/auth";
import type { User } from "@/types";
import { useT } from "@/lib/i18n";

/**
 * Single-step PIN login screen.
 * SplashPage passes the user object via navigation state.
 * User enters 4-digit PIN → verified against localStorage hash → dashboard.
 * If PIN wrong or not set → auto-redirect to OTP flow.
 * If "Forgot PIN" → auto-redirect to forgot PIN flow.
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

  if (!routeUserOrAuth) {
    // No user at all → go to login
    navigate("/login", { replace: true });
    return null;
  }

  const user: User = routeUserOrAuth;

  async function handlePinComplete(val: string) {
    if (val.length < 4 || verifying) return;
    setVerifying(true);
    try {
      const result = await verifyPinDetailed(user.id, val);
      if (result.status === "ok") {
        // PIN correct → re-fetch latest user data from DB to ensure
        // profile changes made by admin (or elsewhere) are reflected
        const freshUser = await getUserFromSession();
        setUser(freshUser ?? user);
        const dest = user.role === "admin" || user.role === "co_admin"
          ? "/admin/dashboard" : "/employee/dashboard";
        navigate(dest, { replace: true });
      } else if (result.status === "no_pin") {
        // PIN was never set or storage was cleared → go to OTP flow
        setPendingPhone(user.phone);
        setPendingFlow("login");
        navigate("/login/otp", { replace: true, state: { user } });
      } else if (result.status === "error") {
        // Decryption/storage error — NOT a wrong PIN
        // Do NOT clear the PIN. Show error and allow retry.
        setError(t("copy.storageError"));
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
      <div className="flex flex-col flex-1 items-center gap-5 sm:gap-8 px-4 py-4 sm:p-6 sm:pt-8">
        <div className="flex flex-col items-center gap-1.5 sm:gap-2 text-center">
          {user.photoUrl ? (
            <img src={user.photoUrl} alt="" className="w-12 h-12 sm:w-16 sm:h-16 rounded-full object-cover mb-1 sm:mb-2" />
          ) : (
            <div
              className="w-12 h-12 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-lg sm:text-xl font-bold mb-1 sm:mb-2"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <p className="text-lg sm:text-xl font-bold text-foreground">
            Welcome, {user.name.split(" ")[0]}
          </p>
          <p className="text-xs sm:text-sm text-caption">{t("auth.pinPrompt")}</p>
          {error && (
            <p className="text-xs sm:text-sm text-[#ef4444]">{error}</p>
          )}
        </div>

        <PINInput value={pinValue} onChange={handleChange} error={!!error} shake={shake} />

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
