import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Fingerprint, Loader2 } from "lucide-react";
import AuthLayout from "@/components/layout/AuthLayout";
import Photo from "@/components/ui/Photo";
import NavHeader from "@/components/ui/NavHeader";
import PINInput from "@/components/ui/PINInput";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import { verifyPinDetailed, clearPin } from "@/lib/pinLock";
import { biometricPlatformAvailable, hasBiometricEnrolment, unlockWithBiometric } from "@/lib/biometric";
import { useAuthStore } from "@/stores/authStore";
import { resumeSession } from "@/lib/auth";
import { pinAllowedOnThisDevice, rememberLastProfile } from "@/lib/loginWindow";
import type { User } from "@/types";
import { useT } from "@/lib/i18n";
import { homePathForUser } from "@/lib/experience";

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
  // "hidden" also covers a phone with no finger reader: the mark is only drawn when there is
  // something behind it.
  const [bioState, setBioState] = useState<"hidden" | "ready" | "working" | "failed">("hidden");
  /**
   * The sheet that asks for the finger.
   *
   * A screen, not a silent OS prompt, for two reasons. The first is that it can *say* what it
   * wants and offer the way out beside it — a fingerprint dialog that appears from nowhere is
   * the thing people dismiss without reading. The second is mechanical: WebAuthn will not open
   * a prompt without a gesture, so the version of this screen that fired the prompt by itself
   * on arrival was, in a browser, a prompt that never appeared at all.
   */
  const [bioSheet, setBioSheet] = useState(false);
  /** The phone is asked once, on arrival. A second automatic opening is a nag. */
  const promptedRef = useRef(false);

  /**
   * Enrolling a fingerprint is only worth doing if the app then asks for it.
   *
   * So the question is asked on arrival, unasked, whenever this account has a finger enrolled
   * on this phone — which is the entire point of enrolling. It opens the sheet, it does not
   * fire the prompt: the person is told what is about to happen and taps the one thing that
   * starts it. Cancelling costs nothing — the keypad is underneath, unchanged, and the mark is
   * still there to try again.
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
        setBioSheet(true);
      }
    });
    return () => { alive = false; };
  }, [routeUser?.id, authUser?.id]);

  /**
   * Every hook is above this line, and the bail-out is below all of them.
   *
   * This screen mounts before it has a user — a cold launch resolves the profile a tick later
   * — and while the early return sat above the effect above, that second render called one
   * hook more than the first. React refuses that outright ("Rendered more hooks than during
   * the previous render") and replaces the app with an error screen, which is what happened
   * the first time this effect was reached on a real launch. A conditional return above a
   * hook is not a style question; it is a crash waiting for the second render.
   */
  if (!routeUserOrAuth) {
    // No user at all → go to login
    navigate("/login", { replace: true });
    return null;
  }

  const user: User = routeUserOrAuth;

  /** The one way into the app, whichever check got us here. */
  async function enterApp() {
    // Re-open the session the account's own login identity, and re-read the profile so changes
    // made by an admin (name, photo, role) are reflected. The PIN and the fingerprint both land
    // here, and neither of them is a session by itself.
    void rememberLastProfile(user);
    const resumed = await resumeSession(user);
    if (resumed.status === "signed_out") {
      // The server answered: there is no usable profile for this number any more (the account
      // was erased, or it was closed). Nothing on this device may keep painting it.
      useAuthStore.getState().logout();
      navigate("/login", { replace: true });
      return;
    }
    if (resumed.status === "offline") {
      // The server could not be asked. The PIN was already accepted — by the server before the
      // connection dropped, or by this device's own record — so the known profile and its
      // cached rows are what the shop gets, rather than a wall.
      setUser(user);
      navigate(destFor(user), { replace: true });
      return;
    }
    if (resumed.status === "login_not_ready") {
      // The number has no login identity on the server: the owner re-sends the invitation.
      setError(t("auth.loginNotReady"));
      return;
    }
    if (resumed.status === "error") {
      setError(t("auth.sessionFailed"));
      return;
    }
    setUser(resumed.user);
    void rememberLastProfile(resumed.user);
    navigate(destFor(resumed.user), { replace: true });
  }

  /** Where each kind of account lands once it is in. */
  function destFor(who: User): string {
    return homePathForUser(who);
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
      // A stale record on the phone. Hide the mark rather than offering something that cannot
      // work; the PIN below is untouched.
      setBioState("hidden");
      setBioSheet(false);
      return;
    }
    if (result.status === "unsupported") {
      // The phone answered that it has no finger reader after all (or the app was built
      // without the native bridge). Say so once, then stop offering it — a control that
      // cannot work is worse than no control.
      setBioState("hidden");
      setBioSheet(false);
      setError(t("fingerprint.unsupported"));
      return;
    }
    if (result.status === "cancelled") {
      // Dismissed on purpose — say nothing about it, and leave the sheet open so the mark is
      // one tap away rather than needing the screen to be re-entered.
      setBioState("ready");
      return;
    }
    setBioState("failed");
    setError(t("fingerprint.failed"));
  }

  /**
   * From the mark on the screen: the tap opens the sheet AND is the gesture the prompt needs,
   * so the person does not tap twice for one intention. The sheet is already on screen by the
   * time the system dialog draws over it, so nothing appears from nowhere.
   */
  function startBiometric() {
    setBioSheet(true);
    if (bioState !== "working") void runBiometricUnlock();
  }

  async function handlePinComplete(val: string) {
    if (val.length < 4 || verifying) return;
    setVerifying(true);
    try {
      const result = await verifyPinDetailed(user.id, val);
      if (result.status === "ok") {
        // The PIN is accepted — but is it still allowed to stand in for the number? The same
        // question the launch asked, asked again at the door, so a keypad left open overnight
        // cannot be used to walk past the one-month rule.
        if (!(await pinAllowedOnThisDevice(user.id))) {
          setPendingPhone(user.phone);
          setPendingFlow("login");
          navigate("/login", { replace: true, state: { reverify: true } });
          return;
        }
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
          <Photo
            src={user.photoUrl}
            className="ds-auth-avatar rounded-full object-cover mb-1"
            fallback={(
              <div
                className="ds-auth-avatar rounded-full flex items-center justify-center text-lg sm:text-xl font-bold mb-1"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
          />
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

        {/* The finger, under the keypad's own dots and centred on the screen.

            Deliberately a glyph and nothing else. The word it used to carry ("Use fingerprint")
            competed with the keypad for the eye on the one screen that should be all keypad,
            and it made the alternative look like a third field. A finger mark directly under
            the dots says the same thing in the space of one line, and it is the shape every
            phone-lock screen uses for this, so it needs no words. It is still a real button:
            64px of touch target, and a label for anyone who cannot see it. */}
        {bioState !== "hidden" && (
          <button
            type="button"
            onClick={startBiometric}
            disabled={bioState === "working"}
            aria-label={t("fingerprint.use")}
            data-testid="use-fingerprint"
            className="ds-pressable flex items-center justify-center rounded-full disabled:opacity-60"
            style={{ width: 64, height: 64, marginTop: -4 }}
          >
            {bioState === "working"
              ? <Loader2 size={34} className="animate-spin" style={{ color: "var(--brand-dark)" }} />
              : <Fingerprint size={38} style={{ color: "var(--brand-dark)" }} strokeWidth={1.5} />}
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

      {/* The ask, as a sheet.

          It says who it is for, it holds the one control that starts the check, and it carries
          the way out ("Enter PIN instead") in the same breath — the two things a system dialog
          cannot do. Dismissing it changes nothing: the keypad is exactly as it was. */}
      <Sheet
        open={bioSheet}
        onClose={() => setBioSheet(false)}
        title={t("fingerprint.sheetTitle")}
      >
        <div className="px-4 pb-7 pt-1 flex flex-col items-center text-center" data-testid="fingerprint-sheet">
          <button
            type="button"
            onClick={() => { if (bioState !== "working") void runBiometricUnlock(); }}
            disabled={bioState === "working"}
            aria-label={t("fingerprint.use")}
            data-testid="fingerprint-verify"
            className="ds-pressable flex items-center justify-center rounded-full"
            style={{
              width: 88,
              height: 88,
              background: "var(--surface-2)",
              border: "1px solid var(--border-control)",
            }}
          >
            {bioState === "working"
              ? <Loader2 size={44} className="animate-spin" style={{ color: "var(--brand-dark)" }} />
              : <Fingerprint size={46} style={{ color: "var(--brand-dark)" }} strokeWidth={1.4} />}
          </button>

          {/* One line, and it says what to do — not who it is for and what will happen. The
              name on it was the app talking about the person standing there holding the phone,
              and the mark above already says which check this is; the instruction is the part
              that was missing. */}
          <p
            className="text-12 mt-4"
            style={{ color: "var(--text-secondary)", fontWeight: 300 }}
          >
            {bioState === "working" ? t("fingerprint.checking") : t("fingerprint.sheetBody")}
          </p>
          {error && <p className="text-13 mt-2 text-[#ef4444]">{error}</p>}

          <Button
            variant="ghost"
            fullWidth
            className="mt-5"
            onClick={() => setBioSheet(false)}
            testId="fingerprint-use-pin"
          >
            {t("fingerprint.usePin")}
          </Button>
        </div>
      </Sheet>
    </AuthLayout>
  );
}
