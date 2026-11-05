import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, ContactRound, Mic, Square, X } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import Button from "@/components/ui/Button";
import DateField from "@/components/ui/DateField";
import InlineSelect from "@/components/ui/InlineSelect";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { useCustomersStore } from "@/stores/customersStore";
import { canPickContact, pickContact } from "@/lib/contacts";
import { pkToday } from "@/lib/pkDate";
import { formatCurrency } from "@/lib/formatters";
import { listen } from "@/lib/assistant";
import { parseQuickAdd } from "@/lib/quickAdd";
import FinanceMediaField, { type FinanceMediaView } from "@/components/finance/FinanceMediaField";
import {
  MAX_MEDIA_BYTES,
  mediaMime,
  uploadFinanceMedia,
  type FinanceMediaDraft,
} from "@/lib/financeMedia";
import {
  CATEGORY_KEY,
  FINANCE_CATEGORIES,
  FINANCE_METHODS,
  METHOD_KEY,
  REPEAT_KEY,
  recordFinanceEntry,
  type FinanceEntryKind,
  type FinanceMethod,
  type RepeatUnit,
} from "@/lib/financeEntries";

/**
 * Recording money that is not a sale — income, an expense, or the owner drawing cash.
 *
 * THE SHAPE IS THE OWNER'S REFERENCE (2026-10-29). The screen is a black page with the three
 * kinds as plain words across its top; under them a raised grey surface carries the form. That
 * is the app's own sheet language used as a page: the header is the frame, the grey panel is the
 * sheet you fill in, and nothing floats between them.
 *
 * ONE SCREEN, THREE TABS. The fields are the same and only the words and the category list
 * change, so switching a tab keeps what was already typed — what a person does when they realise
 * the money went out rather than came in.
 *
 * THE TAB MOVE IS ANIMATED, DELIBERATELY QUIETLY. A thin brand mark slides to the tab you chose
 * (its position measured from the real button, so it is right in English and Urdu alike) and the
 * form settles in under it. Both are transform/opacity-only, both take ~220ms, and the app-wide
 * reduced-motion rule collapses them for anyone who asks for less motion.
 *
 * WHAT THE SCREEN DOES NOT DECIDE. The database derives the shop and the branch from the session
 * and refuses a future day (0254); this form only collects the six facts a row needs and gives
 * fast feedback on the amount. It cannot file money into another branch, because it never sends
 * one.
 *
 * THE SAVE IS GUARDED TWICE. `saving` disables the button after a re-render; `submittingRef` stops
 * the second tap synchronously, before React has drawn anything — the same reentrancy rule the
 * supplier-payment form follows, so one confirm cannot record two rows.
 *
 * PAPERS AND A VOICE NOTE ARRIVE LAST. The row is written first, then each file is uploaded against
 * its id (0261). Uploading before the row would leave invisible storage when the write failed, and
 * a bill photographed on a phone is the one thing on this form that must not be retyped. If an
 * upload fails, the money row is already saved: the screen says so, keeps the failed drafts with
 * their local previews, and turns the save button into "Retry attachments". Nothing is lost, and
 * a second tap cannot write a second row.
 */

const KINDS: FinanceEntryKind[] = ["income", "expense", "drawing"];

// The categories and methods come from the ledger's own catalogue, because the correction sheet
// on the other side of this screen draws the same lists. Two copies would let one screen offer a
// category the other cannot display.
const CATEGORIES = FINANCE_CATEGORIES;
const METHODS = FINANCE_METHODS;

/** The four cadences, in the order a reader thinks of them: once, then the calendar. */
const REPEATS: RepeatUnit[] = ["none", "day", "week", "month", "year"];

/** How the every-n row names its unit; a cadence of 1 reads "day", not "days". */
const REPEAT_UNIT_KEY = {
  day: "finance.repeat.days",
  week: "finance.repeat.weeks",
  month: "finance.repeat.months",
  year: "finance.repeat.years",
} as const;

/** The singular, for the ordinary case of every one. */
const REPEAT_UNIT_ONE_KEY = {
  day: "finance.repeat.unitDay",
  week: "finance.repeat.unitWeek",
  month: "finance.repeat.unitMonth",
  year: "finance.repeat.unitYear",
} as const;

/** The tab's own words: the same three the overflow menu offers. */
const KIND_LABEL_KEY: Record<FinanceEntryKind, I18nKey> = {
  income: "finance.tab.income",
  expense: "finance.tab.expense",
  drawing: "finance.tab.drawing",
};

/** The button names the kind it saves, so the last thing read before a tap is what it will do. */
const SAVE_KEY: Record<FinanceEntryKind, I18nKey> = {
  income: "finance.save.income",
  expense: "finance.save.expense",
  drawing: "finance.save.drawing",
};

/** The example under the description field, different for each kind. */
const NOTE_PLACEHOLDER_KEY: Record<FinanceEntryKind, I18nKey> = {
  income: "finance.notePlaceholder.income",
  expense: "finance.notePlaceholder.expense",
  drawing: "finance.notePlaceholder.drawing",
};

/**
 * One field on the sheet: the app's rounded field shell, without an outline.
 *
 * The form used to mix three shapes — the amount box at card radius, the shared `Input`'s 18px
 * outline, and the selectors — so no two rows read as the same control (owner's note,
 * 2026-10-29). Every field on this screen now uses this shell: `--radius-field` (the app's pill)
 * on `--surface`, with a bare input that draws no border of its own. That last part matters in
 * the phone's WebView, where an unstyled `<input>` still paints the browser's 1px control edge.
 */
function PlainField({
  testId,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { testId: string }) {
  // The shell owns the field: its 48px height, its fill, its light resting edge and the green
  // edge while it holds focus. `.ds-field input` takes the inner input's own edge away, so the
  // browser's 1px control line cannot draw a second box inside the pill.
  return (
    <div className="ds-field">
      <input
        {...input}
        data-testid={testId}
        className="flex-1 min-w-0 h-full bg-transparent outline-none text-13"
        style={{ color: "var(--text-primary)" }}
      />
    </div>
  );
}

export default function RecordMoneyPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { addToast } = useUIStore();
  const customers = useCustomersStore((s) => s.customers);
  const role = useAuthStore((s) => s.user?.membershipRole);
  const language = useThemeStore((s) => s.language);

  const requested = params.get("kind") as FinanceEntryKind | null;
  const kind: FinanceEntryKind = requested && KINDS.includes(requested) ? requested : "income";

  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(pkToday());
  const [category, setCategory] = useState(CATEGORIES[kind][0]);
  const [method, setMethod] = useState<FinanceMethod>("cash");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>("none");
  const [repeatEvery, setRepeatEvery] = useState("1");
  const [error, setError] = useState("");
  const [sentence, setSentence] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const stopListeningRef = useRef<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const activeShopId = useShopStore((s) => s.activeShopId);
  const activeBranchId = useShopStore((s) => s.activeBranchId);

  // The files chosen but not yet uploaded. The row does not exist for the first few seconds of
  // their life, so they cannot carry an entry id yet; `savedId` below is what changes that.
  const [drafts, setDrafts] = useState<FinanceMediaDraft[]>([]);
  const draftUrls = useRef<Set<string>>(new Set());
  const [mediaNote, setMediaNote] = useState("");
  // Set when the row is written but at least one file is not. While it is set the money fields are
  // closed: the retry is about the papers, and changing the amount under a saved row would be a
  // correction this screen does not perform.
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedAmount, setSavedAmount] = useState(0);

  useEffect(() => () => {
    for (const url of draftUrls.current) URL.revokeObjectURL(url);
    stopListeningRef.current?.();
  }, []);

  /**
   * The sentence is the shortcut, not a second form. It fills the fields that follow it, and the
   * owner can then correct any one of them before saving; editing a field does not change the
   * sentence, so the same read is not applied again over the correction.
   */
  const parsed = useMemo(() => parseQuickAdd(sentence), [sentence]);

  useEffect(() => {
    if (!sentence.trim() || parsed.looksLikeSale) return;

    if (parsed.amount != null) setAmount(String(parsed.amount));
    if (parsed.party) setCounterparty(parsed.party);
    if (parsed.note) setNote(parsed.note);
    if (parsed.method) setMethod(parsed.method);

    if (parsed.kind) {
      const nextKind = parsed.kind;
      if (nextKind !== kind) {
        setParams(nextKind === "income" ? {} : { kind: nextKind }, { replace: true });
      }
      setCategory(
        parsed.category && CATEGORIES[nextKind].includes(parsed.category)
          ? parsed.category
          : CATEGORIES[nextKind][0],
      );
    } else if (parsed.category && CATEGORIES[kind].includes(parsed.category)) {
      setCategory(parsed.category);
    }

    setError("");
    // The sentence is the only trigger: editing a field must not be overwritten by the same
    // reading, and the current kind/category are already in scope for the tab it names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  /** Frees one preview and its object URL together — a leaked blob URL is memory the tab keeps. */
  function dropDraft(key: string) {
    setDrafts((current) => {
      const found = current.find((draft) => draft.key === key);
      if (found) {
        URL.revokeObjectURL(found.url);
        draftUrls.current.delete(found.url);
      }
      return current.filter((draft) => draft.key !== key);
    });
  }

  function addPhotos(files: File[]) {
    const room = files.filter((file) => file.size <= MAX_MEDIA_BYTES);
    if (room.length < files.length) setMediaNote(t("finance.media.tooLarge"));
    else setMediaNote("");
    const next = room.map<FinanceMediaDraft>((file) => {
      const url = URL.createObjectURL(file);
      draftUrls.current.add(url);
      return {
        key: crypto.randomUUID(),
        kind: "photo",
        file,
        url,
        durationMs: null,
        mime: mediaMime(file, "photo"),
        uploaded: false,
      };
    });
    if (next.length) setDrafts((current) => [...current, ...next]);
  }

  function addVoice(file: File, durationMs: number) {
    if (file.size > MAX_MEDIA_BYTES) {
      setMediaNote(t("finance.media.tooLarge"));
      return;
    }
    const url = URL.createObjectURL(file);
    draftUrls.current.add(url);
    setMediaNote("");
    setDrafts((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        kind: "voice",
        file,
        url,
        durationMs,
        mime: mediaMime(file, "voice"),
        uploaded: false,
      },
    ]);
  }

  /**
   * Uploads whatever is still a draft, in order, and returns whether everything landed.
   *
   * A failure is kept, not dropped: the draft stays in the list with its preview so the retry
   * uploads exactly the file that failed. Successes are freed immediately, so a retry never
   * writes the same receipt twice.
   */
  async function pushDrafts(entryId: string): Promise<boolean> {
    if (!activeShopId || !activeBranchId) {
      setMediaNote(t("finance.media.noBranch"));
      return false;
    }
    const failed: FinanceMediaDraft[] = [];
    for (const draft of drafts) {
      if (draft.file.size > MAX_MEDIA_BYTES) {
        failed.push(draft);
        continue;
      }
      try {
        await uploadFinanceMedia({
          shopId: activeShopId,
          branchId: activeBranchId,
          entryId,
          kind: draft.kind,
          file: draft.file,
          durationMs: draft.durationMs,
        });
        URL.revokeObjectURL(draft.url);
        draftUrls.current.delete(draft.url);
      } catch {
        failed.push(draft);
      }
    }
    setDrafts(failed);
    if (failed.length) {
      setMediaNote(t("finance.media.uploadFailed", { count: String(failed.length) }));
      return false;
    }
    setMediaNote("");
    return true;
  }

  const today = pkToday();

  /**
   * The sliding mark under the chosen tab.
   *
   * Measured from the real buttons rather than computed from their text, so the mark is exactly
   * under the label in either language, at any font size, at any width. It is stored as physical
   * offsets because that is what `offsetLeft` reports; the container is the positioning context.
   */
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Partial<Record<FinanceEntryKind, HTMLButtonElement | null>>>({});
  const [mark, setMark] = useState({ left: 0, width: 0 });

  const measureMark = useCallback(() => {
    const active = tabRefs.current[kind];
    if (!active) return;
    setMark({ left: active.offsetLeft, width: active.offsetWidth });
  }, [kind]);

  useLayoutEffect(() => {
    measureMark();
  }, [measureMark, language]);

  useEffect(() => {
    const host = tabListRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureMark);
    observer.observe(host);
    return () => observer.disconnect();
  }, [measureMark]);

  function chooseKind(next: FinanceEntryKind) {
    if (next === kind) return;
    // The category list belongs to the kind, so it moves with it; the rest of the form is the
    // reader's and stays exactly as they typed it.
    setCategory(CATEGORIES[next][0]);
    setError("");
    setParams(next === "income" ? {} : { kind: next }, { replace: true });
  }

  function stopListening() {
    stopListeningRef.current?.();
    stopListeningRef.current = null;
    setListening(false);
  }

  function toggleListening() {
    if (listening) {
      stopListening();
      return;
    }
    setVoiceError("");
    try {
      const stop = listen(
        (text) => setSentence(text),
        () => {
          stopListeningRef.current = null;
          setListening(false);
        },
        language === "ur" ? "ur-PK" : "en-PK",
        (code) => {
          setListening(false);
          setVoiceError(
            code === "unsupported"
              ? t("finance.quickAdd.voiceUnsupported")
              : code === "permission"
                ? t("finance.quickAdd.voicePermission")
                : t("finance.quickAdd.voiceFailed"),
          );
        },
      );
      if (!stop) {
        setVoiceError(t("finance.quickAdd.voiceUnsupported"));
        return;
      }
      stopListeningRef.current = stop;
      setListening(true);
    } catch {
      setVoiceError(t("finance.quickAdd.voiceFailed"));
      setListening(false);
    }
  }

  async function handleSave() {
    if (submittingRef.current) return;
    setError("");

    if (parsed.looksLikeSale) {
      setError(t("finance.quickAdd.saleBody"));
      return;
    }

    const paid = Number(amount);
    if (!Number.isFinite(paid) || paid <= 0) {
      setError(t("finance.amountError"));
      return;
    }
    if (paid > 1_000_000_000_000) {
      setError(t("finance.amountTooLarge"));
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    try {
      // A previous attempt already wrote the row; this tap is only carrying its papers over.
      if (savedId) {
        if (await pushDrafts(savedId)) {
          addToast(t("finance.saved", { amount: formatCurrency(savedAmount) }), "success");
          navigate(`${base}/settings/hub/finance`, { replace: true });
        }
        return;
      }

      const id = await recordFinanceEntry({
        kind,
        amount: Math.round(paid * 100) / 100,
        category,
        method,
        occurredOn: day || undefined,
        counterparty,
        note,
        repeatUnit,
        // The server clamps a bad number to the range it accepts; the field is numeric and the
        // input handler already refuses a blank, so this only ever normalises text to a number.
        repeatEvery: Math.max(1, Number(repeatEvery) || 1),
      });

      if (drafts.length) {
        setSavedAmount(paid);
        setSavedId(id);
        if (!(await pushDrafts(id))) {
          // The money is recorded. Saying "saved" and leaving would hide the missing papers.
          addToast(t("finance.media.entrySavedOnly", { amount: formatCurrency(paid) }), "info");
          return;
        }
      }

      addToast(t("finance.saved", { amount: formatCurrency(paid) }), "success");
      navigate(`${base}/settings/hub/finance`, { replace: true });
    } catch (e) {
      // The row may or may not have been written — the message says the save did not finish
      // rather than claiming nothing happened.
      setError(e instanceof Error && e.message ? e.message : t("finance.saveFailed"));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  /**
   * The drafts as the media control draws them.
   *
   * A draft is a `FinanceMediaDraft` because it has a `File` to upload; the control only needs
   * what it paints, so the conversion happens here rather than teaching the control about upload
   * state it does not own. Every view is a draft on this screen: nothing has an id yet.
   */
  const mediaViews = (wanted: "photo" | "voice"): FinanceMediaView[] =>
    drafts
      .filter((draft) => draft.kind === wanted)
      .map((draft) => ({
        key: draft.key,
        kind: draft.kind,
        url: draft.url,
        durationMs: draft.durationMs,
        draft: true,
      }));

  const labelStyle = { color: "var(--text-secondary)" } as const;
  const optionalStyle = { color: "var(--text-tertiary)" } as const;

  // `flex-1` as well as `min-h-full` on the page: it is the only child of the shell's flex
  // column, and a percentage min-height does not resolve against a flex-basis parent — without
  // it the sheet stopped at the form's own height instead of reaching the bottom of the screen.
  return (
    <div
      className="flex flex-col w-full min-h-full flex-1"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="record-money-page"
      data-kind={kind}
    >
      <StatusBar />

      {/* ── The frame ────────────────────────────────────────────────────────────
          Black page, the cross, then the three kinds as words. No segmented control, no
          boxes: the only difference between them is weight and the mark that slides. */}
      <div className="px-4 pt-1 pb-4">
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => navigate(`${base}/settings/hub/finance`)}
            aria-label={t("common.close")}
            data-testid="record-money-close"
            className="ds-iconbtn shrink-0"
            style={{ color: "var(--text-secondary)" }}
          >
            <X size={22} />
          </button>

          <div ref={tabListRef} className="relative flex items-center gap-5 min-w-0" role="tablist">
            {KINDS.map((option) => {
              const active = option === kind;
              return (
                <button
                  key={option}
                  ref={(node) => {
                    tabRefs.current[option] = node;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`record-tab-${option}`}
                  onClick={() => chooseKind(option)}
                  className="shrink-0 whitespace-nowrap ds-pressable transition-colors duration-150"
                  style={{
                    color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    fontWeight: active ? 700 : 500,
                    fontSize: active ? 15 : 14,
                  }}
                >
                  {t(KIND_LABEL_KEY[option])}
                </button>
              );
            })}

            {/* The mark that travels. It is decoration for the eye only — the tab's own
                `aria-selected` is what a screen reader announces. */}
            <span
              aria-hidden
              className="absolute -bottom-2 h-[2px] rounded-full"
              data-testid="record-tab-mark"
              style={{
                left: mark.left,
                width: mark.width,
                background: mark.width ? "var(--brand)" : "transparent",
                transition:
                  "left 220ms cubic-bezier(0.32, 0.72, 0, 1), width 220ms cubic-bezier(0.32, 0.72, 0, 1)",
              }}
            />
          </div>
        </div>
      </div>

      {/* ── The sheet ────────────────────────────────────────────────────────────
          The raised grey surface the form lives on. It fills the rest of the screen and keeps
          the sheet's own radius, so the page reads as the frame around one panel rather than
          a form floating on black. */}
      {/* The panel fades into the page instead of ending on an edge (owner's reference,
          2026-10-29). Only the top corners are rounded, because the bottom of the panel is no
          longer a corner: the grey starts at `--tone-sheet` and arrives at `--background` by the
          bottom of the screen, so the form appears to sit ON the page rather than in a floating
          card with a visible rim. The stop at 38% keeps the fields on an even tone before the
          fade begins, so no label sits in a gradient. */}
      <div
        className="ds-panel flex-1 min-h-0 flex flex-col mx-0 px-4 pt-6 pb-10 overflow-y-auto"
        style={{
          background:
            "linear-gradient(180deg, var(--tone-sheet) 0%, var(--tone-sheet) 38%, var(--background) 100%)",
          // 16px, per the owner's measurement — the panel is a surface, not a modal sheet, so
          // it does not borrow the 40px sheet radius.
          borderStartStartRadius: 16,
          borderStartEndRadius: 16,
        }}
        data-testid="record-money-sheet"
      >
        {role !== "owner" ? (
          <p className="text-12" style={{ color: "var(--text-secondary)" }} data-testid="record-owner-only">
            {t("finance.ownerOnly")}
          </p>
        ) : (
          // `key` restarts the settle-in animation when the kind changes; the values themselves
          // live in this component, so nothing typed is lost with the element.
          <div key={savedId ? "saved" : kind} className="ds-tab-swap flex flex-col gap-4 flex-1">
            {savedId ? (
              <div className="flex flex-col gap-1" data-testid="record-saved-note">
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                  {t("finance.media.savedTitle")}
                </p>
                <p className="text-22 font-bold tabular-nums" style={{ color: "var(--brand-dark)" }}>
                  {formatCurrency(savedAmount)}
                </p>
                <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>
                  {mediaNote || t("finance.media.retryHint")}
                </p>
              </div>
            ) : (
            <>
            {/* One compact sentence field, above the form it fills. It is the quick-add screen
                folded into the form: no second save path, no second set of fields, and no extra
                card around it. The microphone sits inside the field it writes into. */}
            <div className="flex flex-col gap-1.5" data-testid="record-quick">
              <div className="relative">
                <textarea
                  value={sentence}
                  onChange={(e) => {
                    setSentence(e.target.value);
                    setError("");
                  }}
                  rows={2}
                  disabled={saving}
                  placeholder={
                    listening
                      ? t("finance.quickAdd.listening")
                      : t("finance.quickAdd.placeholder")
                  }
                  aria-label={t("finance.quickAdd.sayIt")}
                  data-testid="record-sentence"
                  className="w-full outline-none text-15 resize-none ps-3 pe-14 py-3 rounded-[var(--radius)] focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_var(--brand-light)] disabled:opacity-45"
                  style={{ color: "var(--text-primary)", minHeight: 68 }}
                />
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={saving}
                  aria-label={listening ? t("finance.quickAdd.stop") : t("finance.quickAdd.mic")}
                  data-testid="record-mic"
                  className={`absolute end-2.5 bottom-2.5 size-10 rounded-full flex items-center justify-center ds-pressable disabled:opacity-45 ${
                    listening ? "animate-pulse-brand" : ""
                  }`}
                  style={{
                    background: listening ? "var(--error)" : "var(--brand)",
                    color: "#fff",
                  }}
                >
                  {listening ? <Square size={16} /> : <Mic size={18} />}
                </button>
              </div>
              {parsed.looksLikeSale && (
                <p className="text-11" style={{ color: "var(--warning)" }} data-testid="record-sale-warning">
                  {t("finance.quickAdd.saleBody")}
                </p>
              )}
              {voiceError && (
                <p className="text-11" style={{ color: "var(--error)" }} data-testid="record-voice-error">
                  {voiceError}
                </p>
              )}
            </div>

            {/* Amount — the "Rs" sits in the field, so the number and its currency are one
                control rather than a label and a guess. */}
            <div className="flex flex-col gap-2">
              <p className="text-12 font-semibold" style={labelStyle}>{t("finance.amount")}</p>
              {/* No border unless it is reporting a problem. The wrapper is already a lighter
                  surface than the sheet under it, so the field reads as a field; the 1px control
                  edge on top of that was the pale rectangle the owner asked to remove. The error
                  keeps a border because then it is saying something. */}
              {/* The same shell as every other field; only the edge colour changes when the
                  amount is the thing that is wrong. */}
              <div
                className="ds-field"
                style={{ borderColor: error ? "var(--error)" : undefined }}
              >
                <span className="text-13 font-semibold me-2 shrink-0" style={{ color: "var(--text-secondary)" }}>
                  Rs
                </span>
                <input
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                    // The error described the previous attempt; the first keystroke starts a
                    // new one, so it goes away rather than sitting under a fixed amount.
                    if (error) setError("");
                  }}
                  inputMode="decimal"
                  placeholder="0.00"
                  aria-label={t("finance.amount")}
                  data-testid="record-amount"
                  // The shell carries the field; this element is only the text in it.
                  // `.ds-field input` removes the browser's own control edge, which is what
                  // drew the "light line" inside the pill on the phone's WebView.
                  className="flex-1 h-full bg-transparent outline-none text-13 tabular-nums"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
              {error && <p className="text-11" style={{ color: "var(--error)" }} data-testid="record-error">{error}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-12 font-semibold" style={labelStyle}>{t("finance.date")}</p>
              {/* A date is its own field: the app's date rule draws the pill, the calendar glyph
                  and the same resting/focus edges, so it does not need a shell around it. */}
              <DateField
                value={day}
                max={today}
                onChange={setDay}
                ariaLabel={t("finance.date")}
                testId="record-date"
              />
            </div>

            {/* Repeat (owner, 2026-10-30): the same money again on a cadence. The first row is the
                one being saved; the rest are posted by the ledger when each falls due, which is
                said under the field so "recurring" is not mistaken for "counted already". */}
            <div className="flex flex-col gap-2">
              <p className="text-12 font-semibold" style={labelStyle}>{t("finance.repeat")}</p>
              <InlineSelect
                value={repeatUnit}
                options={REPEATS.map((value) => ({ value, label: t(REPEAT_KEY[value]) }))}
                onChange={(value) => setRepeatUnit(value as RepeatUnit)}
                label={t("finance.repeat")}
                testId="record-repeat"
              />

              {repeatUnit !== "none" && (
                <div className="flex items-center gap-2 pt-1" data-testid="record-repeat-every-row">
                  <span className="text-12 shrink-0" style={labelStyle}>{t("finance.repeat.every")}</span>
                  <div className="ds-field" style={{ width: 84 }}>
                    <input
                      value={repeatEvery}
                      onChange={(e) => setRepeatEvery(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                      onBlur={() => setRepeatEvery(String(Math.min(60, Math.max(1, Number(repeatEvery) || 1))))}
                      inputMode="numeric"
                      aria-label={t("finance.repeat.every")}
                      data-testid="record-repeat-every"
                      className="flex-1 min-w-0 h-full bg-transparent outline-none text-13 tabular-nums text-center"
                      style={{ color: "var(--text-primary)" }}
                    />
                  </div>
                  <span className="text-12" style={labelStyle}>
                    {t(
                      (Number(repeatEvery) || 1) <= 1
                        ? REPEAT_UNIT_ONE_KEY[repeatUnit as "day" | "week" | "month"]
                        : REPEAT_UNIT_KEY[repeatUnit as "day" | "week" | "month"],
                    )}
                  </span>
                </div>
              )}

              {repeatUnit !== "none" && (
                <p className="text-11" style={{ color: "var(--text-tertiary)" }}>
                  {t("finance.repeat.hint")}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-12 font-semibold" style={labelStyle}>{t("finance.category")}</p>
              <InlineSelect
                value={category}
                options={CATEGORIES[kind].map((value) => ({
                  value,
                  label: t(CATEGORY_KEY[value]),
                }))}
                onChange={setCategory}
                label={t("finance.category")}
                testId="record-category"
              />
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-12 font-semibold" style={labelStyle}>{t("finance.method")}</p>
              <InlineSelect
                value={method}
                options={METHODS.map((value) => ({
                  value,
                  label: t(METHOD_KEY[value]),
                }))}
                onChange={(value) => setMethod(value as FinanceMethod)}
                label={t("finance.method")}
                testId="record-method"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-12 font-semibold" style={labelStyle}>{t("finance.counterparty")}</p>
                <span className="text-11" style={optionalStyle}>{t("finance.optional")}</span>
              </div>
              <div className="flex items-stretch gap-2">
                <div className="flex-1 min-w-0">
                  <PlainField
                    testId="record-counterparty"
                    list="record-counterparty-options"
                    value={counterparty}
                    onChange={(e) => setCounterparty(e.target.value)}
                    placeholder={t("finance.counterpartyPlaceholder")}
                    aria-label={t("finance.counterparty")}
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!canPickContact()) {
                      addToast(t("contacts.notSupported"), "info");
                      return;
                    }
                    try {
                      const contact = await pickContact();
                      if (contact?.name) setCounterparty(contact.name);
                    } catch {
                      addToast(t("contacts.permissionDenied"), "error");
                    }
                  }}
                  disabled={saving}
                  aria-label={t("contacts.pick")}
                  title={t("contacts.pick")}
                  data-testid="record-counterparty-contact"
                  className="size-12 rounded-full flex items-center justify-center shrink-0 active:opacity-70 disabled:opacity-45"
                  style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--divider)" }}
                >
                  <ContactRound size={17} />
                </button>
              </div>
              {/* A saved customer is a suggestion, not a lock: the field still accepts a name
                  typed by hand. The contact button is the same native picker the customer form
                  uses, so the phone's address book is available without a second sign-in. */}
              <datalist id="record-counterparty-options">
                {customers
                  .filter((customer) => !customer.isArchived)
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((customer) => (
                    <option key={customer.id} value={customer.name} />
                  ))}
              </datalist>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-12 font-semibold" style={labelStyle}>{t("finance.description")}</p>
                <span className="text-11" style={optionalStyle}>{t("finance.optional")}</span>
              </div>
              <PlainField
                testId="record-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t(NOTE_PLACEHOLDER_KEY[kind])}
                aria-label={t("finance.description")}
              />
            </div>
            </>
            )}

            {/* Receipts and a spoken explanation (0261). They belong to the row, not to the form:
                the row is written first, so this block stays on the screen while its files finish
                and can be retried without recording the money twice. */}
            <div className="pt-2">
              <FinanceMediaField
                photos={mediaViews("photo")}
                voices={mediaViews("voice")}
                busy={saving}
                onAddPhotos={addPhotos}
                onRemove={(view) => dropDraft(view.key)}
                onRecorded={addVoice}
              />
              <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
                {t("finance.media.privateNote")}
              </p>
              {mediaNote && !savedId && (
                <p className="text-11 mt-1" style={{ color: "var(--error)" }} data-testid="record-media-error">
                  {mediaNote}
                </p>
              )}
            </div>
          </div>
        )}

        {role === "owner" && (
          <div className="mt-auto pt-6">
            <Button
              fullWidth
              size="lg"
              onClick={handleSave}
              loading={saving}
              disabled={!savedId && (!amount || parsed.looksLikeSale)}
              testId="record-save"
            >
              <Check size={18} className="me-2" />
              {savedId ? t("finance.media.retryUploads") : t(SAVE_KEY[kind])}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
