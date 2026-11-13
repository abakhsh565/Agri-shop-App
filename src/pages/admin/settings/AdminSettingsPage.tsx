import BusinessSettingsSheet from '@/components/ui/BusinessSettingsSheet';
import StockAlertsSheet from '@/components/ui/StockAlertsSheet';
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  AlertTriangle, Bell, Check, ChevronRight, Compass, Fingerprint, Gauge, Globe, Loader2, Lock,
  LogOut, MessageSquare, Moon, ShieldCheck, Sun, Trash2, UserCog, X,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import SetupProgress from "@/components/ui/SetupProgress";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ProfileCard from "@/components/shop/ProfileCard";
import ShopOverviewCard from "@/components/shop/ShopOverviewCard";
import DeleteTargetSheet from "@/components/shop/DeleteTargetSheet";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore, applyTheme } from "@/stores/themeStore";
import { useShopStore } from "@/stores/shopStore";
import { useUIStore } from "@/stores/uiStore";
import { clearDeviceSession } from "@/lib/deviceSession";
import { hasPin } from "@/lib/pinLock";
import { useT } from "@/lib/i18n";
import { HUB_SECTIONS } from "@/lib/settingsHub";
import { useShellBase } from "@/lib/useShellBase";
import { deleteAccount } from "@/lib/auth";
import { forgetLastProfile, forgetPhoneVerification } from "@/lib/loginWindow";
import { entryDoor } from "@/lib/entryDoor";
import { APP_NAME, APP_VERSION } from "@/lib/brand";
import {
  biometricUnavailableReason,
  BIOMETRIC_REASON_KEY,
  enrolBiometric,
  hasBiometricEnrolment,
  removeBiometric,
  type BiometricReason,
  type EnrolResult,
} from "@/lib/biometric";

const LANG_LABELS: Record<string, string> = { en: "English", ur: "اردو" };

/**
 * Which screen each part of the business lives on, in four groups.
 *
 * The owner asked for this shape: Business, Operations, Finance & insights, People & configuration
 * — and under every row, the things inside it, so "Products & Inventory" says *Products · Stock ·
 * Movements · Low Stock · Expiry* before it is opened. A row opens the section's own screen
 * (`settings/hub/:sectionId`), which lists the jobs inside that part of the business from the same
 * catalogue this menu reads (`lib/settingsHub`) — so a section can never offer a job the app does
 * not have, and the two levels cannot drift apart.
 *
 * ONLY HOME IS NOT A SECTION. It is the dashboard itself, and a hub whose single row said "go to
 * the dashboard" would be a screen that exists to be clicked through.
 *
 * WHAT THIS IS NOT is a replacement for the screen. Everything Settings already carried stays
 * exactly where it was — the profile card, the shop's figures, the setup line, the inbox, the
 * device preferences (language, theme, PIN, fingerprint) and the way out. The menu is added
 * above them: the destinations first, then the state of the business and the phone.
 */
export default function AdminSettingsPage() {
  const navigate = useNavigate();
  const t = useT();
  const { addToast } = useUIStore();
  const { user, logout } = useAuthStore();
  const { theme, toggleTheme, language, setLanguage } = useThemeStore();
  const [showBusinessSettings, setShowBusinessSettings] = useState(false);
  /**
   * Deleting the branch this account is working in.
   *
   * The row that used to be here deleted the whole ACCOUNT. What an owner actually needs at
   * the foot of Settings is the branch they are standing in — that is the thing they add
   * and remove, and it is the thing whose removal is not obvious. The account itself is not
   * what this screen manages: removing it would take every branch with it.
   */
  const [accountDeleteOpen, setAccountDeleteOpen] = useState(false);
  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const activeShopId = useShopStore((s) => s.activeShopId);
  const activeShopName = useShopStore((s) => s.activeShopName);
  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;

  /**
   * This screen belongs to the branch it is showing.
   *
   * On the account's own branch it is the person's settings — their photo, their name,
   * their number. On a branch the account ADDED it is that branch's settings: a branch
   * mark, the branch's name, and what is inside it. The rows below stay the same, because
   * language and dark mode are this device's preferences either way.
   */
  const inAddedBranch = branchesLoaded && !!activeBranch && !activeBranch.isMain;

  /**
   * The destructive row is the one thing that differs.
   *
   * On the main branch, and on an account with a single branch, there is no branch to
   * delete — the database refuses both — so the row offered is the ACCOUNT, which is the
   * destructive action that really is available there. Inside an added branch it is that
   * branch. One row, always something that can actually happen: a control that exists only
   * to be refused teaches the owner the app is broken rather than that the rule exists.
   */
  const canDeleteActiveBranch = user?.membershipRole === "owner" && !!activeBranch && !activeBranch.isMain && branches.length > 1;
  // The shop's own low-stock policy. It sits here rather than on the suite because it is a
  // notification preference, next to the one that decides where notifications go.
  const [showStockAlerts, setShowStockAlerts] = useState(false);
  // Fingerprint login. Two-tier state because "off" and "this phone cannot do it" are
  // different sentences to read, and only one of them is the owner's to change.
  const [fingerprint, setFingerprint] = useState<"checking" | "on" | "off" | "unavailable">("checking");
  /** When it reads "unavailable", this is why — the device's own answer, not a guess. */
  const [fingerprintReason, setFingerprintReason] = useState<BiometricReason | null>(null);
  const [fingerprintBusy, setFingerprintBusy] = useState(false);
  const [confirmFingerprintOff, setConfirmFingerprintOff] = useState(false);
  const isUrdu = language === "ur";
  const base = useShellBase();
  const location = useLocation();

  useEffect(() => { applyTheme(theme); }, []);

  /**
   * An address that names a block on this page brings it into view — that is what such an address
   * says it does, and it is how the Settings section of the menu reaches "Language / Appearance".
   *
   * The scroll belongs to this screen, not to the sender. `SectionHubPage` yields the address
   * (`/settings#settings-preferences`) but cannot know when these cards have been laid out; a
   * timer fired from there ran against a half-built page and scrolled nothing, leaving the block
   * 1541px below the frame with the scroll still at the top (observed 2026-10-28). One frame after
   * the route renders, the layout is final and the element is where the reader will find it.
   */
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash]);

  // Which of the three states this phone is in. Asked once, when the screen opens, because
  // the answer decides whether the row is an action or a statement.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    if (hasBiometricEnrolment(user.id)) {
      setFingerprint("on");
      return;
    }
    // The reason is kept, not just the verdict: "this phone cannot use a fingerprint" told the
    // owner nothing, and read as a fault in a phone that uses fingerprints for everything else.
    biometricUnavailableReason().then((reason) => {
      if (!alive) return;
      setFingerprintReason(reason);
      setFingerprint(reason === null ? "off" : "unavailable");
    });
    return () => { alive = false; };
  }, [user]);

  /**
   * Turning it on, from Settings.
   *
   * Offered here and at the moment a PIN is first set, which are the two points where the
   * person has just proved who they are — asking for a fingerprint at any other time would
   * be asking them to trust a screen they have not yet opened.
   */
  async function handleEnrolFingerprint() {
    if (!user || fingerprintBusy) return;
    setFingerprintBusy(true);
    try {
      const result: EnrolResult = await enrolBiometric(user.id, user.name || user.phone);
      if (result.status === "ok") {
        setFingerprint("on");
        addToast(t("fingerprint.enrolled"), "success");
      } else if (result.status === "unsupported") {
        // Say which of the causes it is, and read it from the device rather than assuming.
        setFingerprintReason(await biometricUnavailableReason());
        setFingerprint("unavailable");
        addToast(t("fingerprint.unsupported"), "error");
      } else if (result.status === "cancelled") {
        // Dismissing the prompt is a decision, not a failure — say so quietly and leave
        // the row exactly as it was.
        addToast(t("fingerprint.cancelled"), "error");
      } else {
        addToast(t("fingerprint.unsupported"), "error");
      }
    } finally {
      setFingerprintBusy(false);
    }
  }

  /**
   * Signing out — which is not the same as this phone forgetting its owner.
   *
   * The session ends, the cached rows are dropped, and then the SAME decision the launch screen
   * makes is asked again (`lib/entryDoor.ts`): if this device can open with the PIN and the number
   * was confirmed within the month, the keypad is what appears, not the phone field. Landing on
   * "enter your number" the moment after signing out is the one screen the whole PIN rule exists
   * to avoid — and it also invited people to take a code they did not need.
   */
  async function handleLogout() {
    if (user) clearDeviceSession(user.phone);
    logout();
    const door = await entryDoor();
    if (door.door === "pin") {
      useAuthStore.getState().setUser(door.user);
      navigate("/login/pin", { replace: true, state: { user: door.user } });
      return;
    }
    navigate("/login", { replace: true });
  }

  /**
   * Delete the account, for good — the second half of the flow the sheet runs.
   *
   * The erasing happens in the database (`delete_my_account`), which is also where it is
   * decided whether that means every branch this account answers for or just this login. The
   * screen's only jobs are to leave the person somewhere that exists afterwards — the account
   * they signed in with does not — and to forget the two things this device remembers about
   * it: which profile it last served, and when its number was last confirmed. Leaving either
   * behind would offer a PIN, or a gate, for an account that is gone.
   *
   * ORDER IS THE WHOLE POINT. This used to forget the device FIRST and erase second, so a
   * deletion the database refused still left a phone that had forgotten its owner: the next
   * launch asked for a number and a code on top of an account that was still there, and the
   * registration that followed attached to that surviving account — the data the owner had
   * just asked to be rid of came back with it. The device is now forgotten only after the
   * erasure has actually happened; a failure keeps the device as it was and says so.
   */
  async function handleDeleteAccount() {
    try {
      await deleteAccount();
      if (user) {
        clearDeviceSession(user.phone);
        forgetLastProfile();
        forgetPhoneVerification(user.id);
      }
      addToast(t("settings.deleteAccount.done"), "success");
      logout();
      navigate("/login", { replace: true });
    } catch {
      // Nothing on this device was touched, so the person lands back in the same account and
      // can try again — the opposite of being stranded on a sign-in screen for an account
      // that still exists.
      addToast(t("settings.deleteAccount.failed"), "error");
      setAccountDeleteOpen(false);
    }
  }

  function cycleLanguage() {
    setLanguage(language === "en" ? "ur" : "en");
  }

  // Settings carries no business destinations any more (owner, 2026-11-12). The two groups
  // that used to sit here — Business (Financial overview, Branches, Business Profile) and
  // Operations (Products & Inventory) — repeated doors that More already has, on the screen
  // whose job is this account and this phone. What is left is configuration only.

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}
      data-testid="admin-settings-page"
    >
      <div>
        <StatusBar />
        {/* Dismiss, not back: Settings is a destination you leave, so it carries a close
            cross on the trailing edge (the reference's own pattern) instead of a back arrow
            on the leading one. The hardware back button still works — nothing is trapped. */}
        <NavHeader
          title={t("settings.title") ?? "Profile & Settings"}
          noBack
          right={
            <button
              onClick={() => navigate("/admin/dashboard")}
              aria-label={t("common.close")}
              data-testid="settings-close"
              className="flex items-center justify-center size-8 rounded-full active:opacity-60"
            >
              <X size={18} style={{ color: "var(--text-primary)" }} />
            </button>
          }
        />

        {/* Profile card — the same card as the ones below it, and the same card the profile
            screen repeats at the top of itself (`shop/ProfileCard`, one implementation). It is
            the way in, always to the profile: the card answers "whose account is this", and that
            answer does not change because the account happens to be standing in an added branch
            (owner's correction, 2026-10-30). A branch is a destination of its own, in the
            branches block below, not a second meaning for this card's tap. */}
        <ProfileCard
          testId="settings-open-profile"
          onOpen={() => navigate(`${base}/settings/profile`)}
        />

        {/* The shop's three facts. They describe the shop, not the day: Home's figures follow a
            date filter and a branch, these never do. */}
        <ShopOverviewCard />

        {/* Business setup status. Persistent, not a one-time wizard: it shows what is done
            and what is missing, and disappears by itself once nothing is missing. It carries
            this page's own section markup, so it reads as one of the existing sections. */}
        <SetupProgress className="px-4 pt-3.5 animate-fade-in-up delay-75" />

        {/* Conversations, alerts and the activity log are work, not configuration. They live
            in More now; this page keeps only the shop's own configuration and this phone. */}

        {/* The phone and the person: comfort first, and no heading anywhere on this block.
            A heading earns its place only when a row could otherwise be misread; "Language"
            and "Dark Mode" cannot be, so they are simply the first rows. The reference splits
            groups by whitespace alone, and state is carried as a quiet line under the label
            rather than a value pushed to the far right. */}
        <div className="px-4 pt-3.5 animate-fade-in-up delay-75" id="settings-preferences">
          <ListCard>
            {/* "My shops" used to open here as well as on the owner suite's own card. Which shop
                you are working in is a fact about the shop, so it is named once, on the suite. */}
            <ListRow
              onClick={cycleLanguage}
              icon={Globe}
              title={t("settings.language")}
              meta={LANG_LABELS[language]}
              trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            />
            <ListRow
              onClick={toggleTheme}
              icon={theme === "dark" ? Moon : Sun}
              title={theme === "dark" ? t("settings.darkMode") : t("settings.lightMode")}
              trailing={
                <div
                  className="relative w-12 h-6 rounded-full transition-all duration-300 shrink-0"
                  style={{ background: theme === "dark" ? "var(--brand)" : "var(--muted)" }}
                >
                  <div
                    className="absolute top-1 w-4 h-4 rounded-full transition-all duration-300"
                    data-testid="theme-knob"
                    /* Logical inset: the knob travels from the inline start (off) to the
                       inline end (on), so the switch reads the same in Urdu as in English. */
                    style={{
                      insetInlineStart: theme === "dark" ? "calc(100% - 20px)" : "4px",
                      background: theme === "dark" ? "#0a0a0a" : "var(--text-secondary)",
                    }}
                  />
                </div>
              }
            />
            <ListRow
              onClick={() => navigate("/login/pin-set", { state: { returnTo: "/admin/settings" } })}
              icon={Lock}
              title={user && hasPin(user.id) ? t("settings.changePin") : t("settings.setupPin")}
              trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            />
            <ListRow
              onClick={() => navigate("/identity")}
              icon={ShieldCheck}
              title={t("identity.title")}
              meta={t("identity.settingsMeta")}
              testId="settings-identity"
              trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            />
            {/* Fingerprint login — the second way into a phone that already belongs to
                someone. The row has no action when the phone cannot do it: a row that
                looks tappable and then refuses is worse than one that reads as a fact. */}
            <ListRow
              onClick={
                fingerprint === "on" ? () => setConfirmFingerprintOff(true)
                : fingerprint === "off" ? handleEnrolFingerprint
                : undefined
              }
              icon={Fingerprint}
              title={t("settings.fingerprint")}
              meta={
                fingerprint === "on" ? t("settings.fingerprint.on")
                : fingerprint === "off" ? t("settings.fingerprint.off")
                : fingerprint === "unavailable"
                  ? t(BIOMETRIC_REASON_KEY[fingerprintReason ?? "unknown"])
                  : undefined
              }
              testId="settings-fingerprint"
              trailing={
                fingerprintBusy || fingerprint === "checking" ? (
                  <Loader2 size={14} className="animate-spin shrink-0" style={{ color: "var(--text-secondary)" }} />
                ) : fingerprint === "on" ? (
                  <Check size={16} strokeWidth={2.5} className="shrink-0" style={{ color: "var(--brand-dark)" }} />
                ) : fingerprint === "off" ? (
                  <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
                ) : undefined
              }
            />
            {/* The shop's own records, and only the ones an owner reads without having to do
                anything: everything that is *work* — people, stock, roles, crops — opens from
                the four section groups above. These three are destinations rather than parts
                of the business, so they sit with the phone's preferences. */}
            {/* When the shop is warned about low stock, and how loudly. The number this
                sets is the one a new product starts at; a product that has been given its
                own number on the product form keeps it. */}
            <ListRow
              onClick={() => setShowStockAlerts(true)}
              icon={AlertTriangle}
              title={t("settings.lowStockAlerts")}
              meta={t("settings.lowStockAlerts.hint")}
              testId="settings-stock-alerts"
              trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            />
          </ListCard>
        </div>

        {showBusinessSettings && <BusinessSettingsSheet onClose={() => setShowBusinessSettings(false)} onSave={() => {}} />}
        {showStockAlerts && <StockAlertsSheet onClose={() => setShowStockAlerts(false)} />}

      </div>

      {/* One destructive row, alone, at the foot — the reference's shape. */}
      <div className="px-4 pt-3.5 pb-6 animate-fade-in-up delay-225">
        <ListCard>
          <ListRow
            danger
            onClick={handleLogout}
            icon={LogOut}
            title={t("settings.signOut")}
          />
          {/* Heavier than signing out, and only drawn when it can actually happen: the main
              branch and an account's only branch cannot be deleted, so the row is absent
              rather than offering something the database will refuse. The four-step sheet
              is where the irreversible part is spelled out. */}
          {canDeleteActiveBranch && activeBranch ? (
            <ListRow
              danger
              testId="settings-delete-branch"
              onClick={() => navigate(`${base}/settings/branches/${activeBranch.id}`)}
              icon={Trash2}
              title={t("branchFlow.archive")}
              meta={t("branchFlow.archiveHint")}
            />
          ) : (
            /* Inside the main branch — and on an account with a single branch — the branch
               cannot be deleted, so the destructive row offered here is the ACCOUNT. That is
               what this screen used to carry, and removing it left the owner with no way to
               close their own account at all. */
            <ListRow
              danger
              testId="settings-delete-account"
              onClick={() => setAccountDeleteOpen(true)}
              icon={Trash2}
              title={t("settings.deleteAccount")}
              meta={t("settings.deleteAccount.meta")}
            />
          )}
        </ListCard>

        {/* What this build is. "Device / App Version" was a card of two rows that did
            nothing — an inventory app has no reason to tell a shop owner which handset
            they are on — so it is gone, and the version survives as the smallest text on
            the page, under the copyright, where every phone app puts it. */}
        <p className="text-11 mt-5 text-center" style={{ color: "var(--text-tertiary)" }}>
          © 2026 {APP_NAME} · v{APP_VERSION}
        </p>
      </div>

      {/* Turning it off is its own small confirmation, because it is the kind of setting
          someone taps by accident and then cannot work out how to undo. */}
      <ConfirmDialog
        open={confirmFingerprintOff}
        title={t("fingerprint.removeTitle")}
        message={t("fingerprint.removeBody")}
        confirmLabel={t("fingerprint.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          if (user) removeBiometric(user.id);
          setFingerprint("off");
          setConfirmFingerprintOff(false);
          addToast(t("fingerprint.removed"), "success");
        }}
        onCancel={() => setConfirmFingerprintOff(false)}
      />

      {/* The same four steps the Branches screen runs — one flow, one set of words, whether
          the subject is a branch reached from More or from here, or the account itself. */}
      {accountDeleteOpen && user && (
        <DeleteTargetSheet
          subject={{
            kind: "account",
            name: user.name,
            phone: user.phone,
            branchCount: branches.length,
          }}
          onClose={() => setAccountDeleteOpen(false)}
          onDeleted={() => void handleDeleteAccount()}
        />
      )}
    </div>
  );
}
