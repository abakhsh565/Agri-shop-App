import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import PINInput from "@/components/ui/PINInput";
import Button from "@/components/ui/Button";
import { verifyPin, clearPin } from "@/lib/pinLock";
import { useAuthStore } from "@/stores/authStore";
import { getUserFromSession } from "@/lib/auth";
import type { User } from "@/types";

/**
 * Single-step PIN login screen.
 * SplashPage passes the user object via navigation state.
 * User enters 4-digit PIN → verified against localStorage hash → dashboard.
 * If PIN wrong or not set → auto-redirect to OTP flow.
 * If "Forgot PIN" → auto-redirect to forgot PIN flow.
 */
export default function PINLoginPage() {
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
      const ok = await verifyPin(user.id, val);
      if (ok) {
        // PIN correct → re-fetch latest user data from DB to ensure
        // profile changes made by admin (or elsewhere) are reflected
        const freshUser = await getUserFromSession();
        setUser(freshUser ?? user);
        const dest = user.role === "admin" || user.role === "co_admin"
          ? "/admin/dashboard" : "/employee/dashboard";
        navigate(dest, { replace: true });
      } else {
        // PIN wrong or not set on this device → auto-fallback to OTP
        clearPin(user.id);
        setPendingPhone(user.phone);
        setPendingFlow("login");
        navigate("/login/otp", { replace: true, state: { user } });
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
      <NavHeader title="Sign In" backTo="/login" />
      <div className="flex flex-col flex-1 items-center gap-8 p-6 pt-8">
        <div className="flex flex-col items-center gap-2 text-center">
          {user.photoUrl ? (
            <img src={user.photoUrl} alt="" className="w-16 h-16 rounded-full object-cover mb-2" />
          ) : (
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold mb-2"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <p className="text-xl font-bold text-black">
            Welcome, {user.name.split(" ")[0]}
          </p>
          <p className="text-sm text-[#888]">Enter your 4-digit PIN to continue</p>
          {error && (
            <p className="text-sm text-[#ef4444]">{error}</p>
          )}
        </div>

        <PINInput value={pinValue} onChange={handleChange} error={!!error} shake={shake} />

        {verifying && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[#888]">Verifying...</p>
          </div>
        )}

        <button onClick={handleForgotPIN} className="text-sm font-medium text-[#888] underline underline-offset-2">
          Forgot PIN?
        </button>
      </div>
    </AuthLayout>
  );
}
