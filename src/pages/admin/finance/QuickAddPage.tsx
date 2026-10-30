import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  HandCoins,
  Mic,
  Receipt,
  RotateCcw,
  Sparkles,
  Square,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import DateField from "@/components/ui/DateField";
import InlineSelect from "@/components/ui/InlineSelect";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { pkToday } from "@/lib/pkDate";
import { formatCurrency } from "@/lib/formatters";
import { friendlyForTest } from "@/lib/db";
import { listen } from "@/lib/assistant";
import { parseQuickAdd, type QuickAddKind } from "@/lib/quickAdd";
import {
  CATEGORY_KEY,
  FINANCE_CATEGORIES,
  FINANCE_METHODS,
  KIND_LABEL_KEY,
  METHOD_KEY,
  recordFinanceEntry,
  type FinanceMethod,
} from "@/lib/financeEntries";

/**
 * Quick add — one sentence in, one confirmed ledger row out.
 *
 * WHY IT IS A SENTENCE AND NOT A FORM. The owner already has the full form; this is for the
 * moment they are walking through the shop and want to write down "paid 5000 rent to Malik"
 * before they forget. The sentence is read locally (see `lib/quickAdd`), shown back as a
 * confirmation, and only then written through the existing `record_finance_entry` RPC.
 *
 * THREE THINGS IT WILL NOT DO.
 *   1. It does not record a sale. "sold …" is recognised and sent to the sale flow, because a
 *      sale also moves stock and the customer's balance.
 *   2. It does not save anything before the confirmation is on screen. The button names the
 *      amount it will write.
 *   3. It does not require the microphone. Speaking is a shortcut; typing is always available,
 *      and a phone whose browser cannot listen says so instead of failing silently.
 *
 * The save is guarded by ref + state, the same way the full form is, so a double tap on a phone
 * cannot write the same amount twice.
 */
export default function QuickAddPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const language = useThemeStore((s) => s.language);
  const role = useAuthStore((s) => s.user?.membershipRole);
  const { addToast } = useUIStore();

  const [sentence, setSentence] = useState("");
  const [kind, setKind] = useState<QuickAddKind>("expense");
  const [amount, setAmount] = useState("");
  const [party, setParty] = useState("");
  const [category, setCategory] = useState(FINANCE_CATEGORIES.expense[0]);
  const [method, setMethod] = useState<FinanceMethod>("cash");
  const [day, setDay] = useState(pkToday());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [listening, setListening] = useState(false);
  const [heardSomething, setHeardSomething] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ amount: number; kind: QuickAddKind } | null>(null);
  const savingRef = useRef(false);
  const stopListeningRef = useRef<(() => void) | null>(null);

  const parsed = useMemo(() => parseQuickAdd(sentence), [sentence]);

  /**
   * A new sentence is a new reading. The fields follow it, which is what makes the form feel like
   * a confirmation rather than a second place to type. Editing a field does not change the
   * sentence, so `parsed` stays the same object and nothing overwrites the edit.
   */
  useEffect(() => {
    setAmount(parsed.amount == null ? "" : String(parsed.amount));
    setParty(parsed.party);
    setNote(parsed.note);
    if (parsed.kind) setKind(parsed.kind);
    if (parsed.method) setMethod(parsed.method);
    const nextKind = parsed.kind ?? "expense";
    if (parsed.category && FINANCE_CATEGORIES[nextKind].includes(parsed.category)) {
      setCategory(parsed.category);
    } else {
      setCategory((current) =>
        FINANCE_CATEGORIES[nextKind].includes(current) ? current : FINANCE_CATEGORIES[nextKind][0],
      );
    }
  }, [parsed]);

  useEffect(
    () => () => {
      stopListeningRef.current?.();
    },
    [],
  );

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
        (text) => {
          setSentence(text);
          setHeardSomething(true);
        },
        () => {
          stopListeningRef.current = null;
          setListening(false);
        },
        language === "ur" ? "ur-PK" : "en-PK",
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

  function chooseKind(next: QuickAddKind) {
    setKind(next);
    if (!FINANCE_CATEGORIES[next].includes(category)) setCategory(FINANCE_CATEGORIES[next][0]);
    setError("");
  }

  function reset() {
    setSaved(null);
    setSentence("");
    setAmount("");
    setParty("");
    setNote("");
    setError("");
    setVoiceError("");
    setKind("expense");
    setCategory(FINANCE_CATEGORIES.expense[0]);
    setMethod("cash");
  }

  const paid = Number(amount);
  const amountIsValid = Number.isFinite(paid) && paid > 0 && paid <= 1_000_000_000_000;

  async function handleSave() {
    if (savingRef.current) return;
    setError("");
    if (!amountIsValid) {
      setError(t("finance.amountError"));
      return;
    }
    if (!FINANCE_CATEGORIES[kind].includes(category)) {
      setError(t("finance.quickAdd.categoryError"));
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      await recordFinanceEntry({
        kind,
        amount: Math.round(paid * 100) / 100,
        category,
        method,
        occurredOn: day || undefined,
        counterparty: party,
        note,
      });
      addToast(t("finance.saved", { amount: formatCurrency(paid) }), "success");
      setSaved({ amount: paid, kind });
      setSentence("");
      setAmount("");
      setParty("");
      setNote("");
    } catch (e) {
      setError(e instanceof Error && e.message ? friendlyForTest(e.message) : t("finance.saveFailed"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const kindMeta: { kind: QuickAddKind; icon: LucideIcon; hintKey: I18nKey }[] = [
    { kind: "income", icon: HandCoins, hintKey: "finance.quickAdd.kindHint.income" },
    { kind: "expense", icon: Receipt, hintKey: "finance.quickAdd.kindHint.expense" },
    { kind: "drawing", icon: Undo2, hintKey: "finance.quickAdd.kindHint.drawing" },
  ];

  const labelStyle = { color: "var(--text-secondary)" } as const;

  return (
    <div
      className="flex flex-col w-full min-h-full flex-1"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="quick-add-page"
    >
      <StatusBar />
      <NavHeader title={t("finance.quickAdd.title")} backTo={`${base}/settings/hub/finance`} />

      <div className="px-4 pt-1 pb-3">
        <p className="text-13" style={{ color: "var(--text-secondary)" }}>
          {t("finance.quickAdd.subtitle")}
        </p>
      </div>

      {role !== "owner" ? (
        <div className="px-4 pt-2">
          <p className="text-12" style={{ color: "var(--text-secondary)" }} data-testid="quick-add-owner-only">
            {t("finance.ownerOnly")}
          </p>
        </div>
      ) : (
        <div className="px-4 flex flex-col gap-4 pb-10">
          {saved ? (
            <div
              className="rounded-[var(--radius-card)] p-5 flex flex-col gap-2"
              style={{ background: "var(--tone-card)" }}
              data-testid="quick-add-saved"
            >
              <CheckCircle2 size={28} style={{ color: "var(--brand)" }} />
              <p className="text-13 font-bold">{t("finance.quickAdd.savedTitle")}</p>
              <p className="text-28 font-bold tabular-nums" style={{ color: "var(--brand-dark)" }}>
                {formatCurrency(saved.amount)}
              </p>
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                {t(KIND_LABEL_KEY[saved.kind])}
              </p>
              <div className="flex flex-col gap-2 pt-3">
                <Button fullWidth size="lg" onClick={reset} testId="quick-add-another">
                  <RotateCcw size={16} className="me-2" />
                  {t("finance.quickAdd.another")}
                </Button>
                <Button
                  fullWidth
                  size="lg"
                  variant="outline"
                  onClick={() => navigate(`${base}/settings/hub/finance/entries`)}
                  testId="quick-add-ledger"
                >
                  {t("finance.quickAdd.viewLedger")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* The sentence. One field, a microphone beside it, and examples for the first use. */}
              <div
                className="rounded-[var(--radius-card)] p-4"
                style={{ background: "var(--tone-card)" }}
              >
                <div className="flex items-center gap-2 pb-2">
                  <Sparkles size={16} style={{ color: "var(--brand)" }} />
                  <p className="text-12 font-bold">{t("finance.quickAdd.sayIt")}</p>
                </div>
                <textarea
                  value={sentence}
                  onChange={(e) => {
                    setSentence(e.target.value);
                    setHeardSomething(false);
                    setError("");
                  }}
                  rows={3}
                  placeholder={t("finance.quickAdd.placeholder")}
                  aria-label={t("finance.quickAdd.sayIt")}
                  data-testid="quick-add-sentence"
                  className="w-full bg-transparent outline-none text-15 resize-none"
                  style={{ color: "var(--text-primary)" }}
                />
                <div className="flex items-center justify-between gap-3 pt-2">
                  <p className="text-11 min-w-0" style={{ color: "var(--text-tertiary)" }}>
                    {listening
                      ? t("finance.quickAdd.listening")
                      : heardSomething
                        ? t("finance.quickAdd.heard")
                        : t("finance.quickAdd.typeInstead")}
                  </p>
                  <button
                    type="button"
                    onClick={toggleListening}
                    aria-label={
                      listening ? t("finance.quickAdd.stop") : t("finance.quickAdd.mic")
                    }
                    data-testid="quick-add-mic"
                    className="size-11 rounded-full shrink-0 flex items-center justify-center ds-pressable"
                    style={{
                      background: listening ? "var(--error)" : "var(--brand)",
                      color: "#fff",
                    }}
                  >
                    {listening ? <Square size={16} /> : <Mic size={18} />}
                  </button>
                </div>
                {voiceError && (
                  <p className="text-11 pt-2" style={{ color: "var(--error)" }} data-testid="quick-add-voice-error">
                    {voiceError}
                  </p>
                )}
              </div>

              {/* Examples. They are chips, not help text: tapping one is faster than reading how it works. */}
              <div className="flex flex-col gap-2">
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                  {t("finance.quickAdd.examples")}
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {[
                    "finance.quickAdd.example1",
                    "finance.quickAdd.example2",
                    "finance.quickAdd.example3",
                  ].map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSentence(t(key as I18nKey));
                        setHeardSomething(false);
                      }}
                      className="shrink-0 rounded-full px-3 py-2 text-11 text-start ds-pressable"
                      style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                    >
                      {t(key as I18nKey)}
                    </button>
                  ))}
                </div>
              </div>

              {parsed.looksLikeSale ? (
                /* A sale is not this ledger's row. Saying so here is cheaper than a wrong row that
                   makes the shelf and the books disagree. */
                <div
                  className="rounded-[var(--radius-card)] p-4 flex flex-col gap-2"
                  style={{ background: "var(--tone-card)" }}
                  data-testid="quick-add-sale-warning"
                >
                  <AlertTriangle size={20} style={{ color: "var(--warning)" }} />
                  <p className="text-13 font-bold">{t("finance.quickAdd.saleTitle")}</p>
                  <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                    {t("finance.quickAdd.saleBody")}
                  </p>
                  <Button
                    fullWidth
                    size="md"
                    variant="outline"
                    onClick={() => navigate(`${base}/sale`)}
                    testId="quick-add-go-sale"
                  >
                    {t("finance.quickAdd.goToSale")}
                    <ArrowRight size={16} className="ms-2" />
                  </Button>
                </div>
              ) : (
                <>
                  {amountIsValid && (
                    <div
                      className="rounded-[var(--radius-card)] p-4 flex items-center justify-between gap-3"
                      style={{ background: "var(--surface-2)" }}
                      data-testid="quick-add-confirm"
                    >
                      <div className="min-w-0">
                        <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                          {t("finance.quickAdd.check")}
                        </p>
                        <p className="text-22 font-bold tabular-nums">
                          {formatCurrency(paid)}
                        </p>
                        <p className="text-11 truncate" style={{ color: "var(--text-secondary)" }}>
                          {t(KIND_LABEL_KEY[kind])}
                          {party ? ` · ${party}` : ""}
                          {` · ${t(CATEGORY_KEY[category])}`}
                        </p>
                      </div>
                      <Check size={22} style={{ color: "var(--brand)" }} />
                    </div>
                  )}

                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <p className="text-12 font-semibold" style={labelStyle}>
                        {t("finance.quickAdd.whatHappened")}
                      </p>
                      <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("finance.quickAdd.whatHappened")}>
                        {kindMeta.map((entry) => {
                          const Icon = entry.icon;
                          const active = entry.kind === kind;
                          return (
                            <button
                              key={entry.kind}
                              type="button"
                              onClick={() => chooseKind(entry.kind)}
                              aria-pressed={active}
                              data-testid={`quick-add-kind-${entry.kind}`}
                              className="flex flex-col items-start gap-1 rounded-[var(--radius-card)] p-3 text-start ds-pressable"
                              style={{
                                background: active ? "var(--brand-light)" : "var(--surface-2)",
                                border: `1px solid ${active ? "var(--brand)" : "var(--field-border)"}`,
                              }}
                            >
                              <Icon size={16} style={{ color: active ? "var(--brand-dark)" : "var(--text-secondary)" }} />
                              <span className="text-11 font-bold" style={{ color: active ? "var(--brand-dark)" : "var(--text-primary)" }}>
                                {t(KIND_LABEL_KEY[entry.kind])}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-11" style={{ color: "var(--text-tertiary)" }}>
                        {t(kindMeta.find((entry) => entry.kind === kind)!.hintKey)}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="text-12 font-semibold" style={labelStyle}>
                        {t("finance.amount")}
                      </p>
                      <div className="ds-field">
                        <span className="text-13 font-semibold me-2 shrink-0" style={{ color: "var(--text-secondary)" }}>
                          Rs
                        </span>
                        <input
                          value={amount}
                          onChange={(e) => {
                            setAmount(e.target.value.replace(/[^0-9.]/g, ""));
                            setError("");
                          }}
                          inputMode="decimal"
                          placeholder="0.00"
                          aria-label={t("finance.amount")}
                          data-testid="quick-add-amount"
                          className="flex-1 min-w-0 h-full bg-transparent outline-none text-13 tabular-nums"
                          style={{ color: "var(--text-primary)" }}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-12 font-semibold" style={labelStyle}>
                          {t("finance.quickAdd.party")}
                        </p>
                        <span className="text-11" style={{ color: "var(--text-tertiary)" }}>
                          {t("finance.optional")}
                        </span>
                      </div>
                      <div className="ds-field">
                        <input
                          value={party}
                          onChange={(e) => setParty(e.target.value)}
                          placeholder={t("finance.counterpartyPlaceholder")}
                          aria-label={t("finance.quickAdd.party")}
                          data-testid="quick-add-party"
                          className="flex-1 min-w-0 h-full bg-transparent outline-none text-13"
                          style={{ color: "var(--text-primary)" }}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="text-12 font-semibold" style={labelStyle}>
                        {t("finance.category")}
                      </p>
                      <InlineSelect
                        value={category}
                        options={FINANCE_CATEGORIES[kind].map((value) => ({
                          value,
                          label: t(CATEGORY_KEY[value]),
                        }))}
                        onChange={setCategory}
                        label={t("finance.category")}
                        testId="quick-add-category"
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="text-12 font-semibold" style={labelStyle}>
                        {t("finance.method")}
                      </p>
                      <InlineSelect
                        value={method}
                        options={FINANCE_METHODS.map((value) => ({
                          value,
                          label: t(METHOD_KEY[value]),
                        }))}
                        onChange={(value) => setMethod(value as FinanceMethod)}
                        label={t("finance.method")}
                        testId="quick-add-method"
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="text-12 font-semibold" style={labelStyle}>
                        {t("finance.date")}
                      </p>
                      <DateField
                        value={day}
                        max={pkToday()}
                        onChange={setDay}
                        ariaLabel={t("finance.date")}
                        testId="quick-add-date"
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <p className="text-12 font-semibold" style={labelStyle}>
                        {t("finance.description")}
                      </p>
                      <div className="ds-field">
                        <input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder={t("finance.notePlaceholder.expense")}
                          aria-label={t("finance.description")}
                          data-testid="quick-add-note"
                          className="flex-1 min-w-0 h-full bg-transparent outline-none text-13"
                          style={{ color: "var(--text-primary)" }}
                        />
                      </div>
                    </div>
                  </div>

                  {error && (
                    <p className="text-11" style={{ color: "var(--error)" }} data-testid="quick-add-error">
                      {error}
                    </p>
                  )}

                  <div className="pt-1">
                    <Button
                      fullWidth
                      size="lg"
                      onClick={handleSave}
                      loading={saving}
                      disabled={!amountIsValid}
                      testId="quick-add-record"
                    >
                      <Check size={18} className="me-2" />
                      {amountIsValid
                        ? t("finance.quickAdd.record", { amount: formatCurrency(paid) })
                        : t("finance.quickAdd.recordAction")}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
