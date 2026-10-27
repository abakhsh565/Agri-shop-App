import BusinessSettingsSheet from '@/components/ui/BusinessSettingsSheet';
import StockAlertsSheet from '@/components/ui/StockAlertsSheet';
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  AlertTriangle, BarChart3, BellRing, Building2, Check, ChevronRight, Cog, Fingerprint,
  Gauge, GitBranch, Globe, Landmark, Loader2, Lock, LogOut, MessageSquare, Moon, Package,
  ShoppingCart, SlidersHorizontal, Sun, Trash2, TrendingUp, Truck, UserCog, Users, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { useShellBase } from "@/lib/useShellBase";
import { deleteAccount } from "@/lib/auth";
import { forgetLastProfile, forgetPhoneVerification } from "@/lib/loginWindow";
import { entryDoor } from "@/lib/entryDoor";
import { OWNER_ROWS, useOwnerRows } from "@/lib/ownerRows";
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
interface MenuRow {
  id: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  /** The section's own screen, or the one route that is not a section (`/dashboard`). */
  to: string;
  testId?: string;
}

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
  // Which rows the owner has moved onto this screen, and the panel that moves them back.
  const [customizing, setCustomizing] = useState(false);
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
  const { where, rowsOn, move } = useOwnerRows();
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

  const menuGroups: { id: string; heading: string; rows: MenuRow[] }[] = [
    {
      id: "business",
      heading: t("settings.menuGroup.business"),
      rows: [
        { id: "home", icon: Gauge, label: t("settings.menu.home"), hint: t("settings.menu.home.hint"), to: "/dashboard" },
        { id: "overview", icon: TrendingUp, label: t("settings.menu.overview"), hint: t("settings.menu.overview.hint"), to: "/settings/hub/overview" },
        { id: "branches", icon: GitBranch, label: t("settings.menu.branches"), hint: t("settings.menu.branches.hint"), to: "/settings/hub/branches" },
      ],
    },
    {
      id: "operations",
      heading: t("settings.menuGroup.operations"),
      rows: [
        { id: "sales", icon: ShoppingCart, label: t("settings.menu.sales"), hint: t("settings.menu.sales.hint"), to: "/settings/hub/sales" },
        { id: "inventory", icon: Package, label: t("settings.menu.inventory"), hint: t("settings.menu.inventory.hint"), to: "/settings/hub/inventory" },
        { id: "customers", icon: Users, label: t("settings.menu.customers"), hint: t("settings.menu.customers.hint"), to: "/settings/hub/customers" },
        { id: "purchases", icon: Truck, label: t("settings.menu.purchases"), hint: t("settings.menu.purchases.hint"), to: "/settings/hub/purchases" },
      ],
    },
    {
      id: "finance",
      heading: t("settings.menuGroup.finance"),
      rows: [
        { id: "money", icon: Landmark, label: t("settings.menu.finance"), hint: t("settings.menu.finance.hint"), to: "/settings/hub/finance" },
        { id: "reports", icon: BarChart3, label: t("settings.menu.reports"), hint: t("settings.menu.reports.hint"), to: "/settings/hub/reports" },
        { id: "reminders", icon: BellRing, label: t("settings.menu.reminders"), hint: t("settings.menu.reminders.hint"), to: "/settings/hub/reminders" },
      ],
    },
    {
      id: "people",
      heading: t("settings.menuGroup.people"),
      rows: [
        { id: "people", icon: UserCog, label: t("settings.menu.people"), hint: t("settings.menu.people.hint"), to: "/settings/hub/people" },
        { id: "business-profile", icon: Building2, label: t("settings.menu.businessProfile"), hint: t("settings.menu.businessProfile.hint"), to: "/settings/hub/business-profile" },
        { id: "preferences", icon: Cog, label: t("settings.menu.settings"), hint: t("settings.menu.settings.hint"), to: "/settings/hub/preferences" },
      ],
    },
  ];

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
            the way in: a chevron rather than a pill that said "Edit", because a row that opens a
            screen says so with an arrow. The branches themselves live on that screen too. */}
        <ProfileCard
          testId={inAddedBranch ? "settings-edit-branch" : "settings-open-profile"}
          onOpen={() =>
            navigate(
              inAddedBranch && activeBranch
                ? `${base}/settings/branches/${activeBranch.id}`
                : `${base}/settings/profile`,
            )
          }
        />

        {/* ── What the business runs on ────────────────────────────────────────────
            Four groups, and under each name the things inside it. The rows are the
            destinations; the cards below are the state of the business and of this phone. */}
        {menuGroups.map((group) => (
          <section key={group.id} className="px-4 pt-4" data-testid={`settings-group-${group.id}`}>
            {/* A real heading, so the groups are navigable by heading in a screen reader as
                well as by eye — the rows underneath are the group's contents. */}
            <h2 className="ds-section px-1 mb-2">{group.heading}</h2>
            <ListCard>
              {group.rows.map((row) => {
                const Icon = row.icon;
                return (
                  <ListRow
                    key={row.id}
                    testId={`settings-row-${row.id}`}
                    icon={Icon}
                    title={row.label}
                    meta={row.hint}
                    onClick={() => navigate(`${base}${row.to}`)}
                    trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
                  />
                );
              })}
            </ListCard>
          </section>
        ))}

        {/* The shop's three facts. They describe the shop, not the day: Home's figures follow a
            date filter and a branch, these never do. */}
        <ShopOverviewCard />

        {/* Business setup status. Persistent, not a one-time wizard: it shows what is done
            and what is missing, and disappears by itself once nothing is missing. It carries
            this page's own section markup, so it reads as one of the existing sections. */}
        <SetupProgress className="px-4 pt-3.5 animate-fade-in-up delay-75" />

        {/* The inbox.
            Messages was the bar's fifth tab for a while, and the bar's fifth slot is the owner's
            menu again — so the inbox ships here, one row away from the screen that already
            answers "what is in this account". Its own card rather than a row inside the
            preferences below: an unread conversation is not a device setting, and putting it
            between "Language" and "Dark Mode" would have said it was. */}
        <div className="px-4 pt-3.5 animate-fade-in-up delay-100">
          <ListCard>
            <ListRow
              onClick={() => navigate(`${base}/messages`)}
              icon={MessageSquare}
              title={t("admin.messages")}
              testId="settings-messages"
              trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            />
          </ListCard>
        </div>

        {/* Rows the owner moved out of the suite.
            The shop's own menu — Money, Stock, People and App — is no longer rendered on this
            page: it lives on the More screen, the bar's fifth tab (`pages/admin/more`). So a row
            appears here only because the owner moved it, through the control at the foot of this
            page, and the block renders nothing at all when nothing was moved. Both screens still
            read one catalogue (`lib/ownerRows`), so a row can never be listed twice. */}
        {rowsOn("settings").some((row) => row.group !== "app") && (
          <div className="px-4 pt-3.5 animate-fade-in-up delay-100">
            <ListCard>
              {rowsOn("settings")
                .filter((row) => row.group !== "app")
                .map((row) => {
                  const Icon = row.icon;
                  return (
                    <ListRow
                      key={row.id}
                      anchor={row.anchor}
                      onClick={() => (row.path ? navigate(`${base}${row.path}`) : setShowBusinessSettings(true))}
                      icon={Icon}
                      title={t(row.labelKey)}
                      meta={row.metaKey ? t(row.metaKey) : undefined}
                      trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
                    />
                  );
                })}
            </ListCard>
          </div>
        )}

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
                anything: everything that is *work* — people, stock, roles, crops — lives in the
                owner suite. A row moved here is rendered by the catalogue below, so it is never
                shown twice. */}
            {rowsOn("settings")
              .filter((row) => row.group === "app")
              .map((row) => {
                const Icon = row.icon;
                return (
                  <ListRow
                    key={row.id}
                    anchor={row.anchor}
                    onClick={() => row.path && navigate(`${base}${row.path}`)}
                    icon={Icon}
                    title={t(row.labelKey)}
                    trailing={
                      <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
                    }
                  />
                );
              })}
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

        {/* Where each row lives.
            The owner suite is the screen for the shop and this is the screen for the phone and
            the person, but which one a shopkeeper reaches for is habit — so the arrangement is
            theirs to change. One tap moves a row across; the choice is remembered per account,
            in the shop it was made in, on this device only. */}
        <div className="px-4 pt-3.5 animate-fade-in-up delay-150">
          <ListCard>
            <ListRow
              onClick={() => setCustomizing((v) => !v)}
              icon={SlidersHorizontal}
              title={customizing ? t("settings.done") : t("settings.customize")}
              meta={customizing ? undefined : t("settings.customizeHint")}
              testId="settings-customize"
              trailing={
                <ChevronRight
                  size={14}
                  className="shrink-0 transition-transform"
                  style={{ color: "var(--text-secondary)", transform: customizing ? "rotate(90deg)" : undefined }}
                />
              }
            />
            {customizing &&
              OWNER_ROWS.map((row) => {
                const Icon = row.icon;
                const here = where(row.id) === "settings";
                return (
                  // Deliberately no row action while customizing: the only thing a tap can do
                  // here is move the row, so the panel cannot close itself out from under the
                  // next row the owner was about to move.
                  <ListRow
                    key={row.id}
                    icon={Icon}
                    title={t(row.labelKey)}
                    description={here ? t("settings.livesHere") : t("settings.livesInSuite")}
                    trailing={
                      <button
                        type="button"
                        data-testid={`move-${row.id}`}
                        onClick={() => move(row.id, here ? "suite" : "settings")}
                        className="shrink-0 rounded-full px-3 h-8 text-12 font-bold"
                        style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
                      >
                        {here ? t("settings.moveToSuite") : t("settings.moveHere")}
                      </button>
                    }
                  />
                );
              })}
          </ListCard>
        </div>

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
