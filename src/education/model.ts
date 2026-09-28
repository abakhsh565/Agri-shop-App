import type { LucideIcon } from "lucide-react";
import {
  ShoppingBag,
  Package,
  UserCheck,
  ShoppingCart,
  HandCoins,
  BarChart2,
  BellRing,
  Users,
  Compass,
  ShieldCheck,
  MoreHorizontal,
} from "lucide-react";
import type { I18nKey } from "@/lib/i18n";
import { hasPermission } from "@/lib/tenantContext";
import { useAuthStore } from "@/stores/authStore";
import type { MembershipRole, PermissionCode } from "@/types";

/**
 * THE education model.
 *
 * One authoritative list of what the app teaches, read by all four experiences:
 * the first-run welcome, the guided tour, the App guide screen and (next pass)
 * Features & benefits. A sentence lives here once, as a dictionary key, so the
 * existing i18n coverage/parity guards prove it exists in English *and* Urdu
 * before it can ship.
 *
 * Two rules this file exists to enforce:
 *
 *  1. **Real targets only.** `anchor` names a `data-tour` attribute carried by an
 *     actual element of the app. Nothing is positioned by coordinates, and no
 *     element was invented for the tour — `tests/unit/educationGuard.test.ts`
 *     fails if an anchor stops existing in the code.
 *  2. **Skipped, never broken.** A step whose target is absent at runtime (an
 *     unpermitted module, a screen that legitimately hides a block) is passed
 *     over silently by the overlay instead of pointing at nothing.
 */

/** Membership roles, as the app actually stores them (`users.role` + membership). */
export type EduRole = MembershipRole;

export interface TourStep {
  /** Stable id; also the key the guard reports by. */
  id: string;
  titleKey: I18nKey;
  bodyKey: I18nKey;
  /** The `data-tour="…"` value on the real element this step points at. */
  anchor: string;
  /** Route within the shell, e.g. `/more`. Steps on one screen share a route. */
  route: string;
  /** Who is taught this. An employee never sees the owner's tour. */
  roles: EduRole[];
  /** Permission the step needs; without it the step is skipped for that user. */
  requires?: PermissionCode;
  /** Lower first. Numeric so a step can be inserted later without renumbering. */
  order: number;
}

export interface GuideSection {
  id: string;
  titleKey: I18nKey;
  bodyKey: I18nKey;
  icon: LucideIcon;
  roles: EduRole[];
}

export interface IntroSlide {
  id: string;
  titleKey: I18nKey;
  bodyKey: I18nKey;
  icon: LucideIcon;
  /**
   * The real screen this slide talks about, captured from the app itself by the media
   * pipeline (`tests/media/capture.spec.ts`) in both themes. A new owner recognises the
   * app they are about to open instead of looking at an illustration of it.
   */
  image: { light: string; dark: string };
}

const OWNER: EduRole[] = ["owner", "admin"];
const EMPLOYEE: EduRole[] = ["employee"];
const EVERYONE: EduRole[] = [...OWNER, ...EMPLOYEE];

/**
 * The owner tour: ten stops, because the app has ten places worth teaching —
 * not because ten is a round number.
 *
 * Steps 1–5 are on Home (the figures, the three daily actions, and three tabs the
 * bottom bar shows there). Steps 6–10 move to the More menu, whose rows are the
 * modules an owner manages. The overlay navigates to a step's route itself; it is
 * never the *tour* that leaves the user somewhere unexpected, and closing it
 * navigates nowhere.
 */
export const OWNER_TOUR: TourStep[] = [
  { id: "owner.kpis",     titleKey: "edu.step.kpis.title",        bodyKey: "edu.step.kpis.body",        anchor: "home:kpis",          route: "/dashboard", roles: OWNER, order: 10 },
  { id: "owner.actions",  titleKey: "edu.step.actions.title",     bodyKey: "edu.step.actions.body",     anchor: "home:actions",       route: "/dashboard", roles: OWNER, order: 20 },
  { id: "owner.sales",    titleKey: "edu.step.sales.title",       bodyKey: "edu.step.sales.body",       anchor: "tab:admin.sales",    route: "/dashboard", roles: OWNER, order: 30, requires: "sales.view" },
  { id: "owner.stock",    titleKey: "edu.step.stock.title",       bodyKey: "edu.step.stock.body",       anchor: "tab:admin.inventory",route: "/dashboard", roles: OWNER, order: 40, requires: "products.view" },
  { id: "owner.scan",     titleKey: "edu.step.scan.title",        bodyKey: "edu.step.scan.body",        anchor: "tab:scan",           route: "/dashboard", roles: OWNER, order: 50 },
  { id: "owner.customers",titleKey: "edu.step.customers.title",   bodyKey: "edu.step.customers.body",   anchor: "more:customers",     route: "/more",      roles: OWNER, order: 60, requires: "customers.view" },
  { id: "owner.suppliers",titleKey: "edu.step.suppliers.title",   bodyKey: "edu.step.suppliers.body",   anchor: "more:companies",     route: "/more",      roles: OWNER, order: 70, requires: "companies.view" },
  { id: "owner.purchases",titleKey: "edu.step.purchases.title",   bodyKey: "edu.step.purchases.body",   anchor: "more:purchases",     route: "/more",      roles: OWNER, order: 80, requires: "purchases.view" },
  { id: "owner.payments", titleKey: "edu.step.payments.title",    bodyKey: "edu.step.payments.body",    anchor: "more:payments",      route: "/more",      roles: OWNER, order: 90, requires: "payments.view" },
  { id: "owner.reports",  titleKey: "edu.step.reports.title",     bodyKey: "edu.step.reports.body",     anchor: "more:reports",       route: "/more",      roles: OWNER, order: 100, requires: "reports.view" },
];

/**
 * The employee tour is a different tour, not the owner's with holes in it: it
 * teaches only what an employee's day contains — their own figures, the buttons
 * they press, and the four tabs they have. Steps whose permission the employee's
 * role does not grant are skipped, so a shop that narrows a role automatically
 * narrows the tour.
 */
export const EMPLOYEE_TOUR: TourStep[] = [
  { id: "emp.today",   titleKey: "edu.step.empkpis.title",   bodyKey: "edu.step.empkpis.body",   anchor: "home:kpis",        route: "/dashboard", roles: EMPLOYEE, order: 10 },
  { id: "emp.actions", titleKey: "edu.step.empactions.title",bodyKey: "edu.step.empactions.body",anchor: "home:actions",     route: "/dashboard", roles: EMPLOYEE, order: 20, requires: "sales.create" },
  { id: "emp.sales",   titleKey: "edu.step.sales.title",     bodyKey: "edu.step.sales.body",     anchor: "tab:nav.sales",    route: "/dashboard", roles: EMPLOYEE, order: 30, requires: "sales.view" },
  { id: "emp.scan",    titleKey: "edu.step.scan.title",      bodyKey: "edu.step.scan.body",      anchor: "tab:scan",         route: "/dashboard", roles: EMPLOYEE, order: 40 },
  { id: "emp.stock",   titleKey: "edu.step.stock.title",     bodyKey: "edu.step.stock.body",     anchor: "tab:nav.products", route: "/dashboard", roles: EMPLOYEE, order: 50, requires: "products.view" },
  { id: "emp.customers",titleKey: "edu.step.customers.title",bodyKey: "edu.step.customers.body", anchor: "tab:nav.customers",route: "/dashboard", roles: EMPLOYEE, order: 60, requires: "customers.view" },
];

export const TOUR_STEPS: TourStep[] = [...OWNER_TOUR, ...EMPLOYEE_TOUR];

/**
 * The App guide's sections. Informational, not a tour: this is where someone who
 * has finished onboarding comes back to read how the app works.
 */
export const GUIDE_SECTIONS: GuideSection[] = [
  { id: "about", titleKey: "edu.guide.about.title", bodyKey: "edu.guide.about.body", icon: Compass,     roles: EVERYONE },
  // "How a day works" used to sit here as one sentence. The workflows below carry that idea
  // properly — the actual sequence, step by step, on the screens it happens on.
  { id: "can",   titleKey: "edu.guide.can.title",   bodyKey: "edu.guide.can.owner",  icon: ShieldCheck, roles: OWNER },
  { id: "can",   titleKey: "edu.guide.can.title",   bodyKey: "edu.guide.can.employee", icon: ShieldCheck, roles: EMPLOYEE },
  { id: "cant",  titleKey: "edu.guide.cant.title",  bodyKey: "edu.guide.cant.owner", icon: MoreHorizontal, roles: OWNER },
  { id: "cant",  titleKey: "edu.guide.cant.title",  bodyKey: "edu.guide.cant.employee", icon: MoreHorizontal, roles: EMPLOYEE },
];

/** The three screens shown once, before the first sign-in. */
export const INTRO_SLIDES: IntroSlide[] = [
  { id: "sell",   titleKey: "edu.intro.1.title", bodyKey: "edu.intro.1.body", icon: ShoppingBag, image: { light: "/education/intro-sell-light.png", dark: "/education/intro-sell-dark.png" } },
  { id: "udhaar", titleKey: "edu.intro.2.title", bodyKey: "edu.intro.2.body", icon: UserCheck,   image: { light: "/education/intro-udhaar-light.png", dark: "/education/intro-udhaar-dark.png" } },
  { id: "profit", titleKey: "edu.intro.3.title", bodyKey: "edu.intro.3.body", icon: BarChart2,   image: { light: "/education/intro-profit-light.png", dark: "/education/intro-profit-dark.png" } },
];

export interface Tutorial {
  id: string;
  titleKey: I18nKey;
  /** The guide flow this walkthrough belongs to, when it is one of them. */
  workflowId?: string;
  /** What the recording shows, numbered the way the video shows it. */
  stepKeys: I18nKey[];
  /**
   * The shipped recording: this app, driven in Urdu, with the narration burned in as the
   * caption strip. Recorded and encoded from the real UI by the media pipeline, so it
   * always shows the product as it currently ships — never a reference mock-up.
   */
  file: string;
  poster: string;
}

/**
 * The workflows that get a full visual walkthrough.
 *
 * Chosen by one rule: a multi-step flow where a new user can get lost and a wrong tap costs
 * money. Everything smaller is a contextual explanation (see `SCREEN_HELP`); anything that is
 * a question rather than a walkthrough is a FAQ. The three flows the guide already narrates
 * plus the reports walkthrough are exactly that set — a sale, a collection, stock coming in,
 * and reading the numbers — so a video always has matching step copy beside it.
 */
export const TUTORIALS: Tutorial[] = [
  { id: "sale",    titleKey: "edu.w.sale.title",    workflowId: "sale",    stepKeys: ["edu.w.sale.1", "edu.w.sale.2", "edu.w.sale.3"],          file: "/tutorials/new-sale.webm",       poster: "/tutorials/new-sale.png" },
  { id: "collect", titleKey: "edu.w.collect.title", workflowId: "collect", stepKeys: ["edu.w.collect.1", "edu.w.collect.2", "edu.w.collect.3"], file: "/tutorials/collect-payment.webm", poster: "/tutorials/collect-payment.png" },
  { id: "stock",   titleKey: "edu.w.stock.title",   workflowId: "stock",   stepKeys: ["edu.w.stock.1", "edu.w.stock.2", "edu.w.stock.3"],       file: "/tutorials/stock-in.webm",       poster: "/tutorials/stock-in.png" },
  { id: "reports", titleKey: "edu.w.reports.title", workflowId: "reports", stepKeys: ["edu.w.reports.1", "edu.w.reports.2", "edu.w.reports.3"], file: "/tutorials/reports.webm",       poster: "/tutorials/reports.png" },
];

export function tutorialById(id: string | undefined): Tutorial | undefined {
  return id ? TUTORIALS.find((t) => t.id === id) : undefined;
}

export interface ScreenHelp {
  id: string;
  /** Shell-relative route prefix this help belongs to. The longest match wins. */
  match: string;
  titleKey: I18nKey;
  /** What this screen is, in one sentence a shopkeeper would say. */
  whatKey: I18nKey;
  /** The two or three things worth understanding on it. */
  pointKeys: I18nKey[];
  /** The walkthrough to offer beside the explanation, when one exists. */
  tutorialId?: string;
  /** A screen only one role has. Absent means both. */
  roles?: EduRole[];
}

/**
 * Help for the screen you are already on.
 *
 * The point of this list is that nobody has to leave the job they are doing and search a
 * guide: the explanation for *this* screen is available *on* this screen. It is derived from
 * the routes the shells actually have, and matched by longest prefix, so a detail screen
 * (`/sales/abc`) is told apart from the flow that starts there (`/sales/new`) without any
 * per-screen wiring.
 */
export const SCREEN_HELP: ScreenHelp[] = [
  { id: "home",        match: "/dashboard",  titleKey: "edu.h.home.title",        whatKey: "edu.h.home.what",        pointKeys: ["edu.h.home.1", "edu.h.home.2", "edu.h.home.3"] },
  { id: "saleNew",     match: "/sales/new",  titleKey: "edu.h.saleNew.title",     whatKey: "edu.h.saleNew.what",     pointKeys: ["edu.h.saleNew.1", "edu.h.saleNew.2", "edu.h.saleNew.3"],     tutorialId: "sale" },
  { id: "saleDetail",  match: "/sales/",     titleKey: "edu.h.saleDetail.title",  whatKey: "edu.h.saleDetail.what",  pointKeys: ["edu.h.saleDetail.1", "edu.h.saleDetail.2", "edu.h.saleDetail.3"] },
  { id: "salesList",   match: "/sales",      titleKey: "edu.h.salesList.title",   whatKey: "edu.h.salesList.what",   pointKeys: ["edu.h.salesList.1", "edu.h.salesList.2", "edu.h.salesList.3"] },
  { id: "customersList", match: "/customers", titleKey: "edu.h.customersList.title", whatKey: "edu.h.customersList.what", pointKeys: ["edu.h.customersList.1", "edu.h.customersList.2", "edu.h.customersList.3"] },
  { id: "customer",    match: "/customers/", titleKey: "edu.h.customer.title",    whatKey: "edu.h.customer.what",    pointKeys: ["edu.h.customer.1", "edu.h.customer.2", "edu.h.customer.3"], tutorialId: "collect" },
  { id: "stock",       match: "/products",   titleKey: "edu.h.stock.title",       whatKey: "edu.h.stock.what",       pointKeys: ["edu.h.stock.1", "edu.h.stock.2", "edu.h.stock.3"] },
  { id: "purchases",   match: "/purchases",  titleKey: "edu.h.purchases.title",   whatKey: "edu.h.purchases.what",   pointKeys: ["edu.h.purchases.1", "edu.h.purchases.2", "edu.h.purchases.3"], tutorialId: "stock" },
  { id: "payments",    match: "/payments",   titleKey: "edu.h.payments.title",    whatKey: "edu.h.payments.what",    pointKeys: ["edu.h.payments.1", "edu.h.payments.2", "edu.h.payments.3"] },
  { id: "reports",     match: "/reports",    titleKey: "edu.h.reports.title",     whatKey: "edu.h.reports.what",     pointKeys: ["edu.h.reports.1", "edu.h.reports.2", "edu.h.reports.3"],     tutorialId: "reports" },
  { id: "reminders",   match: "/alerts",     titleKey: "edu.h.reminders.title",   whatKey: "edu.h.reminders.what",   pointKeys: ["edu.h.reminders.1", "edu.h.reminders.2", "edu.h.reminders.3"] },
  { id: "settings",    match: "/settings",   titleKey: "edu.h.settings.title",    whatKey: "edu.h.settings.what",    pointKeys: ["edu.h.settings.1", "edu.h.settings.2", "edu.h.settings.3"] },
];

/**
 * The help for a path, or nothing when this screen has no explanation of its own.
 *
 * Longest prefix, so `/sales/new` is the new-sale help and `/sales/abc` is the bill help even
 * though a bill path also starts with `/sales`. Returning nothing is a valid answer: the
 * affordance is simply absent on screens that teach nothing, rather than a generic page of
 * filler.
 */
export function helpForPath(relativePath: string): ScreenHelp | undefined {
  const path = relativePath.split("?")[0];
  return [...SCREEN_HELP]
    .filter((h) => path === h.match || path.startsWith(h.match.endsWith("/") ? h.match : `${h.match}/`))
    .sort((a, b) => b.match.length - a.match.length)[0];
}

export interface FaqItem {
  id: string;
  qKey: I18nKey;
  aKey: I18nKey;
}

/**
 * Questions a first-time shopkeeper actually asks, answered from the app's real behaviour.
 * Kept in the education model with everything else so the answers are translated by the same
 * guards as the rest of the copy.
 */
export const FAQS: FaqItem[] = [
  { id: "sale",       qKey: "edu.faq.q1",  aKey: "edu.faq.a1" },
  { id: "udhaar",     qKey: "edu.faq.q2",  aKey: "edu.faq.a2" },
  { id: "collect",    qKey: "edu.faq.q3",  aKey: "edu.faq.a3" },
  { id: "owesMe",     qKey: "edu.faq.q4",  aKey: "edu.faq.a4" },
  { id: "stockIn",    qKey: "edu.faq.q5",  aKey: "edu.faq.a5" },
  { id: "lowStock",   qKey: "edu.faq.q6",  aKey: "edu.faq.a6" },
  { id: "reminders",  qKey: "edu.faq.q7",  aKey: "edu.faq.a7" },
  { id: "reports",    qKey: "edu.faq.q8",  aKey: "edu.faq.a8" },
  { id: "noAccess",   qKey: "edu.faq.q9",  aKey: "edu.faq.a9" },
  { id: "employee",   qKey: "edu.faq.q10", aKey: "edu.faq.a10" },
];

/** True when this role is taught the owner tour. */
export function isOwnerRole(role: EduRole | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * The steps for one person, in order, already filtered by role. Permission
 * filtering happens at render time in the overlay, because permissions can change
 * while the app is open (the owner edits a role) and the tour must follow.
 */
export function tourForRole(role: EduRole | undefined): TourStep[] {
  const steps = isOwnerRole(role) ? OWNER_TOUR : EMPLOYEE_TOUR;
  return [...steps].sort((a, b) => a.order - b.order);
}

/**
 * The steps one person will really be shown: their role's tour, minus any step whose
 * permission they do not hold. Both the overlay and the App guide's "N short stops"
 * line read this, so the count a person is promised is the count they get — a shop
 * that narrows a role automatically shortens the tour *and* the sentence about it.
 */
export function visibleTourSteps(role: EduRole | undefined): TourStep[] {
  return tourForRole(role).filter((step) => !step.requires || hasPermission(step.requires));
}

/** The guide sections for one person — never the other role's permission wording. */
export function guideForRole(role: EduRole | undefined): GuideSection[] {
  const mine = isOwnerRole(role) ? OWNER : EMPLOYEE;
  return GUIDE_SECTIONS.filter((s) => s.roles.some((r) => mine.includes(r)));
}

export interface Feature {
  id: string;
  titleKey: I18nKey;
  /** What the capability does, in the owner's own terms. */
  whatKey: I18nKey;
  /** Why a shop keeps it — the part that makes it worth learning. */
  whyKey: I18nKey;
  icon: LucideIcon;
  /** Opening it needs this; without it the feature is explained, not offered. */
  requires: PermissionCode;
  /** Routes are shell-relative; an employee shell has fewer of these screens. */
  adminPath: string;
  employeePath?: string;
}

/**
 * What the app can do, derived from the modules that actually exist.
 *
 * Every entry names a capability the shipped app has, its real screen, and the permission
 * that screen needs. There is no marketing copy and no capability the app lacks: a feature
 * an employee cannot open is still explained (so they understand the product) but is never
 * presented as a control they hold — `featurePath` returns null for it, and the row renders
 * as a plain line with a quiet "owner only" note instead of a chevron.
 */
export const FEATURES: Feature[] = [
  { id: "sales",     titleKey: "edu.f.sales.title",     whatKey: "edu.f.sales.what",     whyKey: "edu.f.sales.why",     icon: ShoppingBag,  requires: "sales.view",     adminPath: "/sales",              employeePath: "/sales" },
  { id: "stock",     titleKey: "edu.f.stock.title",     whatKey: "edu.f.stock.what",     whyKey: "edu.f.stock.why",     icon: Package,      requires: "products.view",  adminPath: "/products",           employeePath: "/products" },
  { id: "customers", titleKey: "edu.f.customers.title", whatKey: "edu.f.customers.what", whyKey: "edu.f.customers.why", icon: UserCheck,    requires: "customers.view", adminPath: "/customers",          employeePath: "/customers" },
  { id: "purchases", titleKey: "edu.f.purchases.title", whatKey: "edu.f.purchases.what", whyKey: "edu.f.purchases.why", icon: ShoppingCart, requires: "purchases.view", adminPath: "/purchases" },
  { id: "payments",  titleKey: "edu.f.payments.title",  whatKey: "edu.f.payments.what",  whyKey: "edu.f.payments.why",  icon: HandCoins,    requires: "payments.view",  adminPath: "/payments" },
  { id: "reports",   titleKey: "edu.f.reports.title",   whatKey: "edu.f.reports.what",   whyKey: "edu.f.reports.why",   icon: BarChart2,    requires: "reports.view",   adminPath: "/reports" },
  { id: "alerts",    titleKey: "edu.f.alerts.title",    whatKey: "edu.f.alerts.what",    whyKey: "edu.f.alerts.why",    icon: BellRing,     requires: "alerts.view",    adminPath: "/alerts/reminders" },
  { id: "staff",     titleKey: "edu.f.staff.title",     whatKey: "edu.f.staff.what",     whyKey: "edu.f.staff.why",     icon: Users,        requires: "employees.view", adminPath: "/employees" },
];

export interface Workflow {
  id: string;
  titleKey: I18nKey;
  /** The capability this work belongs to; its access decides whether the flow is "yours". */
  featureId: string;
  /** The steps, in the order they happen. Plain sentences, one action each. */
  stepKeys: I18nKey[];
}

/**
 * The three flows that cover a shop's day, each told as the sequence it actually is.
 *
 * This is the part of education a list of features cannot carry: the owner learns *what the
 * app can do* from `FEATURES` and *what happens next* here. Each step names the real control
 * it presses, using the same words the screen uses in that language, so following the guide
 * and doing the work are the same set of instructions.
 *
 * A flow is not gated — an employee reads all three and learns how the shop runs — but a
 * flow whose capability they cannot open is titled as the owner's, exactly as a locked
 * feature is, so nothing reads as a control they hold.
 */
export const WORKFLOWS: Workflow[] = [
  { id: "sale",    titleKey: "edu.w.sale.title",    featureId: "sales",     stepKeys: ["edu.w.sale.1", "edu.w.sale.2", "edu.w.sale.3"] },
  { id: "collect", titleKey: "edu.w.collect.title", featureId: "customers", stepKeys: ["edu.w.collect.1", "edu.w.collect.2", "edu.w.collect.3"] },
  { id: "stock",   titleKey: "edu.w.stock.title",   featureId: "purchases", stepKeys: ["edu.w.stock.1", "edu.w.stock.2", "edu.w.stock.3"] },
  { id: "reports", titleKey: "edu.w.reports.title", featureId: "reports",   stepKeys: ["edu.w.reports.1", "edu.w.reports.2", "edu.w.reports.3"] },
];

/** The feature a workflow belongs to — undefined only if the model is mis-wired. */
export function featureById(id: string): Feature | undefined {
  return FEATURES.find((f) => f.id === id);
}

/**
 * Where a feature opens for this person, or `null` when it is theirs to understand but
 * not to use: no screen in their shell, or no permission for it.
 */
export function featurePath(feature: Feature, role: EduRole | undefined): string | null {
  const path = isOwnerRole(role) ? feature.adminPath : feature.employeePath;
  if (!path) return null;
  return hasPermission(feature.requires) ? path : null;
}

/**
 * The signed-in person's role, in the one spelling the education system compares against.
 * It lives here so the overlay and the guide cannot drift apart on what "an employee" is.
 */
export function currentEduRole(): EduRole | undefined {
  const user = useAuthStore.getState().user;
  return user?.membershipRole ?? user?.role;
}
