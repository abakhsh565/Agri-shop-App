import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { hasPin } from "@/lib/pinLock";
import { getUserFromSession } from "@/lib/auth";
import StatusBar from "@/components/ui/StatusBar";

export default function SplashPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(async () => {
      if (user && user.isActive) {
        // Re-fetch latest user data from DB so admin-made changes (name, photo, etc.) are reflected
        const freshUser = await getUserFromSession();
        const latestUser = freshUser ?? user;
        // Always update local store — membership fields (tenantId, role, etc.)
        // may have changed since last save and must be persisted.
        if (freshUser) {
          useAuthStore.getState().setUser(freshUser);
        }
        if (hasPin(latestUser.id)) {
          // PIN exists → PIN login screen
          navigate("/login/pin", { replace: true, state: { user: latestUser } });
        } else {
          // No PIN set → prompt to create one (mandatory for all users)
          const dest = (latestUser.role === "admin" || latestUser.role === "co_admin")
            ? "/admin/dashboard"
            : "/employee/dashboard";
          navigate("/login/pin-set", { replace: true, state: { returnTo: dest } });
        }
      } else {
        navigate("/login", { replace: true });
      }
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col bg-white min-h-full w-full justify-between">
      <StatusBar />
      <div className="flex flex-col items-center justify-center gap-6 py-[120px] flex-1">
        <div className="w-20 h-20 bg-black rounded-[40px] flex items-center justify-center">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <path d="M20 32C20 32 8 24 8 16C8 10.5 13.5 6 20 8C26.5 6 32 10.5 32 16C32 24 20 32 20 32Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d="M20 8V32M20 16C20 16 14 12 14 8" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-[32px] font-bold text-black">AgriShop</p>
          <p className="text-sm text-[#888]">Smart Retail for Agriculture</p>
        </div>
      </div>
      <div className="flex flex-col items-center p-6">
        <p className="text-[11px] text-[#888] uppercase tracking-wide">Employee Facing App</p>
      </div>
    </div>
  );
}
