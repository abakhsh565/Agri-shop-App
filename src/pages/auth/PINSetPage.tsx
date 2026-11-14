import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AuthLayout from "@/components/layout/AuthLayout";
import NavHeader from "@/components/ui/NavHeader";
import PINInput from "@/components/ui/PINInput";
import { savePin } from "@/lib/pinLock";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { homePathForUser } from "@/lib/experience";
import { openWorkspace } from "@/lib/workspace";

export default function PINSetPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { returnTo?: string } | null;
  const returnTo = state?.returnTo;
  const { user, setUser } = useAuthStore();
  const [step, setStep] = useState<"set" | "confirm">("set");
  const [firstPin, setFirstPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const [saveError, setSaveError] = useState(false);

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
      // No success screen: the PIN is the last thing onboarding asks for, so it opens the
      // shop straight away. A like-for-like swap from Settings goes back where it came from.
      if (returnTo) {
        navigate(returnTo, { replace: true });
      } else {
        void enter();
      }
    }
  }

  /** The PIN is the last step: from here the account's own shop opens, with no chooser. */
  async function enter() {
    const opened = user ? await openWorkspace(user) : { ok: false as const };
    const next = opened.ok ? opened.user : user;
    if (next && opened.ok) setUser(next);
    if (!opened.ok) {
      setSaveError(true);
      setError(true);
      return;
    }
    navigate(homePathForUser(next), { replace: true });
  }

  const pin = step === "set" ? firstPin : confirmPin;
  const setter = step === "set" ? setFirstPin : setConfirmPin;

  function handleChange(val: string) {
    setter(val);
    if (val.length === 4) handleSetComplete(val);
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
