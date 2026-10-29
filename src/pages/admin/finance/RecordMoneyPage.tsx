import { useCallback, useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, ChevronDown, X } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import Button from "@/components/ui/Button";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { pkToday } from "@/lib/pkDate";
import { formatCurrency } from "@/lib/formatters";
import {
  CATEGORY_KEY,
  METHOD_KEY,
  recordFinanceEntry,
  type FinanceEntryKind,
  type FinanceMethod,
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
 */

const KINDS: FinanceEntryKind[] = ["income", "expense", "drawing"];

const CATEGORIES: Record<FinanceEntryKind, string[]> = {
  income: ["sales", "other_income", "investment", "loan_received"],
  expense: ["stock_purchase", "rent", "utilities", "salaries", "transport", "maintenance", "other_expense"],
  drawing: ["personal_use", "owner_pay", "other_drawing"],
};

const METHODS: FinanceMethod[] = ["cash", "bank", "easypaisa", "jazzcash"];

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

/**
 * One choice, opened in place.
 *
 * The category and the payment method were sheets: a tap raised a full overlay to answer a
 * question whose answer is three words, then that overlay had to be dismissed before the form
 * could be finished. Both now open a panel under their own field (owner's instruction,
 * 2026-10-29), so the choice happens where the reader is looking and the form never leaves the
 * screen. The panel is `end-0`/`start-0`, so it aligns with the field in either reading direction.
 */
function InlineSelect({
  value,
  options,
  onChange,
  label,
  testId,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  label: string;
  testId: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="relative">
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        data-testid={testId}
        onClick={() => setOpen((value) => !value)}
        className="ds-field w-full text-start ds-pressable"
      >
        <span className="flex-1 text-13 truncate" style={{ color: "var(--text-primary)" }}>
          {selected?.label ?? ""}
        </span>
        <ChevronDown
          size={16}
          className="shrink-0"
          style={{
            color: "var(--text-secondary)",
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 180ms ease",
          }}
        />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
            style={{ background: "transparent" }}
          />
          <div
            role="listbox"
            aria-label={label}
            className="absolute start-0 end-0 top-full mt-2 z-50 rounded-[var(--radius-card)] py-1 overflow-y-auto"
            style={{
              maxHeight: 260,
              background: "var(--tone-sheet)",
              border: "1px solid var(--divider)",
              boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
            }}
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-testid={`${testId}-option-${option.value}`}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-start text-13 ds-pressable"
                  style={{ color: active ? "var(--brand-dark)" : "var(--text-primary)" }}
                >
                  <span className="flex-1 truncate">{option.label}</span>
                  {active && <Check size={15} className="shrink-0" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function RecordMoneyPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { addToast } = useUIStore();
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
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

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

  async function handleSave() {
    if (submittingRef.current) return;
    setError("");

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
      await recordFinanceEntry({
        kind,
        amount: Math.round(paid * 100) / 100,
        category,
        method,
        occurredOn: day || undefined,
        counterparty,
        note,
      });
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
          <div key={kind} className="ds-tab-swap flex flex-col gap-4 flex-1">
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
              <input
                type="date"
                value={day}
                max={today}
                onChange={(e) => setDay(e.target.value)}
                aria-label={t("finance.date")}
                data-testid="record-date"
                className="w-full text-13"
              />
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
              <PlainField
                testId="record-counterparty"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                placeholder={t("finance.counterpartyPlaceholder")}
                aria-label={t("finance.counterparty")}
              />
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
          </div>
        )}

        {role === "owner" && (
          <div className="mt-auto pt-6">
            <Button
              fullWidth
              size="lg"
              onClick={handleSave}
              loading={saving}
              disabled={!amount}
              testId="record-save"
            >
              <Check size={18} className="me-2" />
              {t(SAVE_KEY[kind])}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
