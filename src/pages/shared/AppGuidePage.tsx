import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Compass,
  LayoutGrid,
  ListOrdered,
  MessageCircleQuestion,
  Play,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import SearchBar from "@/components/ui/SearchBar";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useEducationStore } from "@/stores/educationStore";
import AskQuestionSheet from "@/components/education/AskQuestionSheet";
import {
  FAQS,
  FEATURES,
  TUTORIALS,
  WORKFLOWS,
  currentEduRole,
  featureById,
  featurePath,
  guideForRole,
  isOwnerRole,
  visibleTourSteps,
} from "@/education/model";
import {
  buildGuideIndex,
  searchGuide,
  type GuideDoc,
  type GuideHit,
  type GuideHitKind,
} from "@/education/search";

/**
 * App guide — the permanent way back into the education system.
 *
 * WHAT THIS SCREEN IS FOR. Two questions, and they need different shapes:
 *
 *   • **"Where is it?"** — the guided tour, which teaches the real UI by pointing at it.
 *   • **"How does this work, and why?"** — the walkthroughs, the numbered flows, one line per
 *     capability and the questions a shopkeeper actually asks. This half is why someone comes
 *     back a month after onboarding, so it explains the product rather than listing links.
 *
 * THE SEARCH SITS UNDER THE TITLE CARD, on the page, and it is the way in (owner's request,
 * 2026-11-15). Someone arriving here usually has a word, not a section: "udhaar", "kharcha",
 * "profit". `education/search.ts` owns the matching — every sentence the model holds, in
 * English, Roman Urdu and Urdu script, with the screen you are standing on lifting an otherwise
 * equal answer. A capability this person cannot open is still explained, but renders as a line
 * with a quiet "owner only" note instead of a control that leads nowhere.
 *
 * THE FILTER STRIP ANSWERS DISCOVERY (owner's request, 2026-11-15). A new owner does not know
 * the guide's vocabulary, so typing is not always possible: **All · Screens · Answers · Videos
 * · Flows** narrows a set of results, and with an empty field it becomes a shelf — pick Videos
 * and you get the four walkthroughs, pick Answers and you get every question. The two controls
 * combine: choose Videos, then type "stock", and the results stay inside videos.
 *
 * WHAT CHANGED AND IS NO LONGER TAUGHT AS ITS OWN THING. Payments, the recorded-money ledger and
 * the statement are one money book now, and Business overview merged into Finance — so the
 * capability is Finance, at the Finance screen. The assistant, branch management and the two
 * flows behind them (recording money that is not a sale, adding a worker) are in the model.
 *
 * It does not depend on first-run state: someone who skipped the welcome on day one opens this
 * from More and gets everything again.
 */

type GuideFilter = "all" | GuideHitKind;

/** The categories, in the order a reader is most likely to want them. */
const FILTERS: { key: GuideFilter; labelKey: I18nKey }[] = [
  { key: "all", labelKey: "edu.filter.all" },
  { key: "feature", labelKey: "edu.search.features" },
  { key: "answer", labelKey: "edu.search.answers" },
  { key: "video", labelKey: "edu.search.videos" },
  { key: "workflow", labelKey: "edu.filter.flows" },
];

/** The result groups, in the order a reader is most likely to want them. */
const HIT_ORDER: GuideHitKind[] = ["feature", "video", "answer", "workflow", "action"];

const HIT_LABEL: Record<GuideHitKind, I18nKey> = {
  feature: "edu.search.features",
  video: "edu.search.videos",
  answer: "edu.search.answers",
  workflow: "edu.search.workflows",
  action: "edu.search.actions",
};

const HIT_ICON: Record<GuideHitKind, LucideIcon> = {
  feature: LayoutGrid,
  video: Play,
  answer: MessageCircleQuestion,
  workflow: ListOrdered,
  action: Sparkles,
};

export default function AppGuidePage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const base = useShellBase();
  const startTour = useEducationStore((s) => s.startTour);

  const [askOpen, setAskOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<GuideFilter>("all");

  const role = currentEduRole();
  const sections = guideForRole(role).filter((section) => section.id !== "about");
  // Both halves read the same filtered lists the tour and the permissions will use, so the
  // promise on this screen and what happens behind it cannot drift apart.
  const stops = visibleTourSteps(role).length;
  const features = FEATURES.map((feature) => ({ feature, path: featurePath(feature, role) }));

  const docs = buildGuideIndex(t, role, base, stops);
  const searching = query.trim().length > 0;
  const hits = searching ? searchGuide(docs, query, location.pathname) : [];

  /** The results a chosen category leaves — the same ranking, one kind. */
  const visibleHits = filter === "all" ? hits : hits.filter((hit) => hit.kind === filter);
  /** With no query, a category is a shelf rather than a filter: everything of that kind. */
  const shelf = filter === "all" ? [] : docs.filter((doc) => doc.kind === filter);
  const listing = searching ? visibleHits : shelf;
  const showListing = searching || filter !== "all";
  const listCount = searching ? visibleHits.length : shelf.length;

  /** How many answers each category holds — for this query, or in the guide as a whole. */
  function countFor(key: GuideFilter): number {
    const pool: GuideDoc[] = searching ? hits : docs;
    return key === "all" ? pool.length : pool.filter((doc) => doc.kind === key).length;
  }

  function resetAll() {
    setQuery("");
    setFilter("all");
  }

  /**
   * What a tap on a result does.
   *
   * Every explanation opens its own page (`/guide/:kind/:id`) first — the owner's request,
   * 2026-11-15: a capability row used to jump at the live screen before the reader had been
   * told what it was for, and a video row used to open a player with no explanation beside it.
   * The detail page is where those words live, and it carries the one button that goes on to
   * the real screen. A capability this person may not open still opens its explanation; only
   * the button is absent there.
   */
  function runDoc(doc: GuideDoc) {
    if (doc.action === "tour") {
      if (stops > 0) startTour();
      return;
    }
    if (doc.kind === "feature" || doc.kind === "workflow") {
      navigate(`${base}/guide/${doc.kind}/${doc.id.split(":")[1]}`);
      return;
    }
    if (doc.tutorialId) {
      navigate(`${base}/guide/tutorial/${doc.tutorialId}`);
      return;
    }
    if (doc.path) navigate(doc.path);
  }

  function docActionable(doc: GuideDoc): boolean {
    if (doc.action === "tour") return stops > 0;
    return doc.kind === "feature" || doc.kind === "video" || doc.kind === "workflow" || Boolean(doc.path);
  }

  function resultRow(doc: GuideDoc) {
    const Icon = HIT_ICON[doc.kind];
    const actionable = docActionable(doc);
    return (
      <ListRow
        key={doc.id}
        icon={Icon}
        title={doc.title}
        description={doc.detail}
        qualifier={doc.locked ? t("edu.guide.ownerOnly") : undefined}
        testId={`guide-result-${doc.id}`}
        onClick={actionable ? () => runDoc(doc) : undefined}
        trailing={
          !actionable ? undefined : doc.tutorialId ? (
            <Play size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
          ) : (
            <ChevronRight
              size={14}
              className="ds-row-chevron shrink-0"
              style={{ color: "var(--text-secondary)" }}
            />
          )
        }
      />
    );
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="guide-page"
    >
      <StatusBar />
      <NavHeader
        title={t("edu.guide.title")}
        noBack
        right={
          <button
            type="button"
            // Back to the screen that offered the guide: Settings for an owner (the fifth
            // tab, and the only menu tree), More for an employee (their shell keeps it).
            onClick={() => navigate(`${base}${isOwnerRole(role) ? "/settings" : "/more"}`)}
            aria-label={t("common.close")}
            data-testid="guide-close"
            className="ds-iconbtn"
          >
            <X size={18} />
          </button>
        }
      />

      {/* ── What this is ─────────────────────────────────────────────────────────────── */}
      <section
        className="mx-4 mt-2 rounded-[var(--radius-card)] p-4"
        style={{ background: "var(--tone-card)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-20 font-bold">{t("edu.guide.title")}</h1>
            <p className="mt-1 text-12" style={{ color: "var(--text-secondary)" }}>
              {t("edu.guide.sub")}
            </p>
          </div>
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            <Compass size={18} />
          </span>
        </div>
      </section>

      {/* ── The search, on the page under that card, because it is the way in ─────────── */}
      <div className="px-4 pt-3">
        <SearchBar
          data-testid="guide-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder={t("edu.guide.searchPlaceholder")}
          aria-label={t("edu.guide.search")}
        />
      </div>

      {/* ── The categories: narrow a search, or browse a shelf when nothing is typed ──── */}
      <div
        className="flex gap-2 overflow-x-auto px-4 pt-3 pb-1"
        style={{ scrollbarWidth: "none" }}
        role="group"
        aria-label={t("edu.filter.label")}
        data-testid="guide-filters"
      >
        {FILTERS.map(({ key, labelKey }) => {
          const active = filter === key;
          const count = countFor(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={active}
              data-testid={`guide-filter-${key}`}
              className="ds-chip shrink-0"
              style={
                active
                  ? { background: "var(--ink)", color: "var(--ink-fg)", borderColor: "var(--ink)" }
                  : undefined
              }
            >
              <span>{t(labelKey)}</span>
              <span
                className="ms-1.5 text-11 tabular-nums"
                style={{ color: active ? "var(--ink-fg)" : "var(--text-tertiary)", opacity: 0.8 }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {showListing ? (
        <div className="px-4 pt-3 pb-2" data-testid={searching ? "guide-results" : "guide-shelf"}>
          {listCount === 0 ? (
            <div className="flex flex-col items-center gap-2 pt-10 text-center">
              <span
                className="flex size-14 items-center justify-center rounded-full"
                style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
              >
                <Search size={22} />
              </span>
              <p className="text-15 font-semibold mt-1">{t("edu.search.empty")}</p>
              <p className="text-13" style={{ color: "var(--text-secondary)" }}>
                {t("edu.search.emptyHint")}
              </p>
              <button
                type="button"
                onClick={resetAll}
                className="ds-btn-brand h-10 px-4 text-13 font-bold mt-2"
                data-testid="guide-search-show-all"
              >
                {t("edu.search.showAll")}
              </button>
            </div>
          ) : (
            <>
              <p className="text-12" style={{ color: "var(--text-tertiary)" }}>
                {t("edu.search.count", { count: String(listCount) })}
              </p>
              {searching && filter === "all" ? (
                // A search across everything is grouped by what each answer IS, so a screen,
                // a video and an answer are told apart before the tap.
                HIT_ORDER.map((kind) => {
                  const group = visibleHits.filter((hit) => hit.kind === kind);
                  if (group.length === 0) return null;
                  return (
                    <section key={kind} className="mt-4">
                      <p className="ds-section-label mb-2">{t(HIT_LABEL[kind])}</p>
                      <ListCard>{group.map((hit) => resultRow(hit))}</ListCard>
                    </section>
                  );
                })
              ) : (
                // One category is already the heading — the strip above says which.
                <div className="mt-2">
                  <ListCard>{listing.map((doc) => resultRow(doc))}</ListCard>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {/* ── The tour: the half that teaches where things are ───────────────────────── */}
          <div className="px-4 pt-4">
            <ListCard section={t("edu.guide.startHere")}>
              <ListRow
                icon={Compass}
                title={t("edu.guide.startTour")}
                meta={t("edu.guide.tourHint", { count: String(stops) })}
                // A tour with no steps this person may be taught is not offered as an action:
                // the row explains itself and stays inert rather than opening nothing.
                onClick={stops > 0 ? startTour : undefined}
                trailing={
                  stops > 0 ? (
                    <ChevronRight
                      size={14}
                      className="ds-row-chevron shrink-0"
                      style={{ color: "var(--text-secondary)" }}
                    />
                  ) : undefined
                }
              />
            </ListCard>
          </div>

          {/* ── What the product is, and what this person holds ────────────────────────── */}
          <div className="px-4 pt-5">
            <p className="ds-section-label mb-2">{t("edu.guide.about.title")}</p>
            <p className="text-13" style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {t("edu.guide.about.body")}
            </p>
            <div className="mt-3">
              <ListCard>
                {sections.map((section) => (
                  <ListRow
                    key={section.bodyKey}
                    icon={section.icon}
                    title={t(section.titleKey)}
                    description={t(section.bodyKey)}
                  />
                ))}
              </ListCard>
            </div>
          </div>

          {/* ── Watching beats reading for the flows worth a full walkthrough ──────────── */}
          <div className="px-4 pt-5">
            <ListCard section={t("edu.tut.watch")}>
              {TUTORIALS.map((tutorial) => (
                <ListRow
                  key={tutorial.id}
                  tile={<PosterTile poster={tutorial.poster} />}
                  title={t(tutorial.titleKey)}
                  meta={t("edu.tut.urduNote")}
                  onClick={() => navigate(`${base}/guide/tutorial/${tutorial.id}`)}
                  testId={`guide-watch-${tutorial.id}`}
                  trailing={
                    <Play
                      size={14}
                      className="shrink-0"
                      style={{ color: "var(--text-secondary)" }}
                    />
                  }
                />
              ))}
            </ListCard>
          </div>

          {/* ── The flows, told as the sequence they actually are ─────────────────────── */}
          <div className="px-4 pt-5">
            <p className="ds-section-label mb-2">{t("edu.guide.workflows")}</p>
            {WORKFLOWS.map((workflow) => {
              const feature = featureById(workflow.featureId);
              const path = feature ? featurePath(feature, role) : null;
              return (
                <ListCard
                  key={workflow.id}
                  className="mb-4"
                  // A flow the person cannot run is titled as the owner's rather than hidden:
                  // understanding how the shop works is part of their job even when the till
                  // is not theirs to open.
                  section={
                    path
                      ? t(workflow.titleKey)
                      : `${t(workflow.titleKey)} · ${t("edu.guide.ownerOnly")}`
                  }
                >
                  {/* The number is the door. Each step opens its own page about that step, with
                      the one action that lands on the screen it happens on. */}
                  {workflow.stepKeys.map((key, index) => (
                    <ListRow
                      key={key}
                      tile={<StepMark n={index + 1} />}
                      title={t(key)}
                      onClick={() => navigate(`${base}/guide/step/${workflow.id}/${index + 1}`)}
                      testId={`guide-step-${workflow.id}-${index + 1}`}
                      trailing={
                        <ChevronRight
                          size={14}
                          className="ds-row-chevron shrink-0"
                          style={{ color: "var(--text-secondary)" }}
                        />
                      }
                    />
                  ))}
                </ListCard>
              );
            })}
          </div>

          {/* ── One line per capability: what it does, and why a shop keeps it ────────── */}
          <div className="px-4 pt-1">
            <ListCard section={t("edu.guide.features")}>
              {features.map(({ feature, path }) => (
                <ListRow
                  key={feature.id}
                  icon={feature.icon}
                  title={t(feature.titleKey)}
                  meta={t(feature.whatKey)}
                  description={t(feature.whyKey)}
                  // Explained either way; only offered when it is actually theirs to open.
                  qualifier={path ? undefined : t("edu.guide.ownerOnly")}
                  // The explanation is for everyone; the door at the end of it is not.
                  onClick={() => navigate(`${base}/guide/feature/${feature.id}`)}
                  trailing={
                    <ChevronRight
                      size={14}
                      className="ds-row-chevron shrink-0"
                      style={{ color: "var(--text-secondary)" }}
                    />
                  }
                />
              ))}
            </ListCard>
          </div>

          {/* ── The questions a first-time shopkeeper actually asks ───────────────────── */}
          <div className="px-4 pt-5">
            <ListCard section={t("edu.guide.faq")}>
              {FAQS.map((faq) => (
                <ListRow
                  key={faq.id}
                  title={t(faq.qKey)}
                  description={t(faq.aKey)}
                  testId={`guide-faq-${faq.id}`}
                />
              ))}
            </ListCard>
          </div>
        </>
      )}

      {/* The way out of the guide when the guide was not enough — in both modes, because a
          search that found nothing is exactly when a question needs asking. */}
      <div className="px-4 pt-5 pb-8">
        <ListCard>
          <ListRow
            icon={MessageCircleQuestion}
            title={t("edu.ask.title")}
            meta={t("edu.ask.hint")}
            onClick={() => setAskOpen(true)}
            testId="guide-ask"
          />
        </ListCard>
      </div>

      {askOpen && <AskQuestionSheet onClose={() => setAskOpen(false)} />}
    </div>
  );
}

/**
 * A walkthrough's own poster, cropped to the row.
 *
 * The recording is of this app, so its first frame already says which flow it is — a play glyph
 * on a grey tile would say less. `object-cover` keeps the phone shape inside the row's leading
 * slot instead of squashing it.
 */
function PosterTile({ poster }: { poster: string }) {
  return (
    <span
      className="block h-11 w-8 shrink-0 overflow-hidden rounded-[8px]"
      style={{ background: "var(--tone-sunken)" }}
    >
      <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" />
    </span>
  );
}

/**
 * A step's number, in the row's leading slot.
 *
 * Numerals rather than a glyph: the order is the instruction, and a digit cannot be
 * mistranslated. This is the same ring treatment the setup checklist uses for its steps.
 */
function StepMark({ n }: { n: number }) {
  return (
    <span
      className="size-5 rounded-full flex items-center justify-center shrink-0 text-11 font-bold"
      style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
    >
      {n}
    </span>
  );
}
