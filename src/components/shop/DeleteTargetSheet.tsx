import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Phone, ShoppingCart, Store, Trash2 } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import OTPInput from "@/components/ui/OTPInput";
import { useT } from "@/lib/i18n";
import { useShopStore, type BranchSummary, type BranchErrorCode } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { sendOTP, verifyConfirmOTP } from "@/lib/auth";

/**
 * The consequential flow, in four steps — for a branch, or for the whole account.
 *
 * One implementation for both, because they are the same act at two sizes and the request
 * was explicit that they must look and read the same: say what will happen (step 1, and it
 * must be ticked), say why (step 2), prove it is the account holder's own hand (step 3, a
 * code to the phone on the account), then show it is done (step 4). An act that only asks
 * "are you sure?" is answered by muscle memory; this one makes the person read the
 * consequence, name a reason and reach for their phone, and none of those can be tapped
 * through by accident.
 *
 * The two subjects differ in *what happens* and *where the account lands afterwards*, and that
 * is the whole of the difference: `DeleteSubject` carries the branch's counts when there is a
 * branch, and the copy keys follow the kind. The steps, the guards, the code window and the
 * layout are shared, so a fix to one is a fix to both.
 *
 * **The branch half archives; it does not erase.** `archive_operating_branch` stops the branch
 * accepting new work and keeps every record — its own audit row carries `historyPreserved:
 * true` — and the legacy tenant purge it used to call is revoked from `authenticated`, so this
 * sheet could not erase a branch now even if it asked. The branch copy therefore describes
 * archiving, and the acknowledgement is about the branch closing rather than about data being
 * destroyed. This half has no caller today: branch removal lives on the branch detail page
 * (`BranchesSection` routes every row there), which offers the same archive through a dialog.
 * It is kept correct and translated rather than left describing an erasure that cannot happen.
 *
 * Two rules hold the steps together:
 *
 *   1. **Nothing is attempted until step 3 succeeds.** The code is a confirmation, never the
 *      authorization: the database checks the caller's membership again when the RPC runs.
 *   2. **A refusal is shown where the decision was made**, in the app's own words, and the
 *      sheet stays open. The main branch, an account's last branch and a branch whose staff have
 *      not been moved are all refused by the database, not by hiding a button.
 *
 * The reason is required for a branch, because the archive is refused without one
 * (`VALIDATION: a reason is required`) and that reason is what the branch's history records; it
 * stays optional for an account. The free-text feedback is always optional.
 */

export type DeleteSubject =
  | {
      kind: "branch";
      id: string;
      name: string;
      createdAt: string | null;
      salesCount: number | null;
      employeeCount: number | null;
    }
  | {
      kind: "account";
      name: string;
      phone: string;
      /** How many branches go with it — the number the card states. */
      branchCount: number;
    };

const REASONS = [
  "branches.delete.reasonOpened",
  "branches.delete.reasonTemp",
  "branches.delete.reasonNeeded",
  "branches.delete.reasonCost",
  "branches.delete.reasonTrouble",
  "branches.delete.reasonOther",
] as const;

type Step = 1 | 2 | 3 | 4;

/** The four-segment bar: the reference's progress, drawn in this app's own two tones. */
function StepBar({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden="true">
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className="h-full flex-1 rounded-full"
          style={{ height: 4, background: n <= step ? "var(--brand)" : "var(--divider)" }}
        />
      ))}
    </div>
  );
}

/**
 * One reason, as a radio.
 *
 * The app had no radio option, and a radio is the right control here: exactly one answer,
 * and the current answer is readable without opening anything. Drawn at the same 20px as the
 * app's checkbox so the two do not look like they came from different designs.
 */
function ReasonOption({
  label,
  selected,
  onSelect,
  testId,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      data-testid={testId}
      className="w-full flex items-start gap-3 py-2.5 text-start ds-pressable"
    >
      <span
        className="mt-0.5 size-5 rounded-full shrink-0 flex items-center justify-center"
        style={{ border: `2px solid ${selected ? "var(--brand)" : "var(--text-secondary)"}` }}
      >
        {selected && <span className="size-2.5 rounded-full" style={{ background: "var(--brand)" }} />}
      </span>
      <span className="text-13 leading-snug" style={{ color: "var(--text-primary)" }}>
        {label}
      </span>
    </button>
  );
}

/** One fact row of the step-1 card: a mark, and the sentence it stands for. */
function FactRow({ icon: Icon, text }: { icon: typeof Store; text: string }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <div
        className="size-9 rounded-full flex items-center justify-center shrink-0"
        style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
        aria-hidden="true"
      >
        <Icon size={17} />
      </div>
      <p className="text-13" style={{ color: "var(--text-primary)" }}>{text}</p>
    </div>
  );
}

export default function DeleteTargetSheet({
  subject,
  onClose,
  onDeleted,
}: {
  subject: DeleteSubject;
  onClose: () => void;
  /** Called once the thing is really gone. The caller decides where to go next. */
  onDeleted: () => void;
}) {
  const t = useT();
  const { addToast } = useUIStore();
  const archiveBranch = useShopStore((s) => s.archiveBranch);
  const phone = useAuthStore((s) => s.user?.phone ?? "");
  /** Which wording this run uses. The steps are shared; the nouns are not. */
  const isAccount = subject.kind === "account";
  const P = isAccount ? "account.delete" : "branches.delete";

  const [step, setStep] = useState<Step>(1);
  const [understood, setUnderstood] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [feedback, setFeedback] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [done, setDone] = useState<{ name: string; fallbackName: string } | null>(null);
  /**
   * One attempt at a time, in refs rather than state: state is still `false` for the second
   * tap of a double tap inside the same task, and this is the one screen in the app where a
   * double tap could mean two deletes. A ref is set synchronously, before anything awaits.
   */
  const busyRef = useRef(false);
  const sendingRef = useRef(false);

  // A fresh code every 30s, the same window the sign-in flow uses. Shown, not hidden, so
  // "send a new code" cannot be hammered.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  /**
   * Step 2 → 3: the code is sent HERE, so nobody waits on a code they asked for two steps
   * ago. A send that fails is reported and the step is not advanced.
   */
  async function goToCode() {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setError(null);
    setSending(true);
    const result = await sendOTP(phone);
    sendingRef.current = false;
    setSending(false);
    if (!result.success) {
      setError(t(`${P}.sendFailed`));
      return;
    }
    setStep(3);
    setCooldown(30);
  }

  async function resend() {
    if (sendingRef.current || cooldown > 0) return;
    sendingRef.current = true;
    setError(null);
    setSending(true);
    const result = await sendOTP(phone);
    sendingRef.current = false;
    setSending(false);
    if (!result.success) {
      setError(t(`${P}.sendFailed`));
      return;
    }
    setCooldown(30);
    addToast(t(`${P}.sent`), "success");
  }

  /**
   * Step 3. The code is checked first, and only then is the delete attempted: a wrong code
   * must never reach the database. Every failure keeps the sheet on this step so the code
   * can be retyped without re-reading the loss and re-picking a reason.
   */
  async function confirmDelete() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);

    const codeOk = await verifyConfirmOTP(phone, code);
    if (!codeOk) {
      busyRef.current = false;
      setBusy(false);
      setError(t("branches.delete.wrongCode"));
      return;
    }

    if (isAccount) {
      // The account path is the caller's job — it is the one that has to sign out and leave
      // the app — but the sheet deliberately stays busy and stays mounted while that runs:
      // this is the last moment the person can see that something is happening, and the
      // armed guard is what stops a second tap from sending a second deletion.
      onDeleted();
      return;
    }

    // The reason the database records. The picked reason is the reason; anything typed into the
    // feedback box is carried along with it rather than dropped, because
    // `archive_operating_branch` takes one text field and the person's own words are the useful
    // part of the history.
    const archiveReason = [reason ? t(reason) : "", feedback.trim()].filter(Boolean).join(" — ");
    const result = await archiveBranch(subject.id, archiveReason);
    busyRef.current = false;
    setBusy(false);

    if (!result.ok || !result.archived) {
      setError(refusalText(result.code));
      return;
    }

    setDone({ name: result.archived.name, fallbackName: result.archived.fallbackName });
    setStep(4);
  }

  /**
   * The refusal, in the app's own words for the subject being closed.
   *
   * The branch-lifecycle codes name branch RPCs, so they read the branch copy whatever the
   * subject: the account path never calls one and cannot produce them. The three codes both
   * paths can produce (`denied`, `not_authenticated` and a genuine failure) read their own
   * kind's words, because "this branch" is the wrong noun on the account screen and the right
   * one on the branch screen — the bug this split fixes.
   */
  function refusalText(code: BranchErrorCode | undefined): string {
    switch (code) {
      case "main_branch": return t("branches.delete.errMain");
      case "last_branch": return t("branches.delete.errLast");
      // The archive is refused while anyone still has access here, so that no login or scope is
      // silently rewritten to another branch. The sentence lives in this sheet's own namespace:
      // it is the only screen that archives, and the commit that made it archive had to be
      // self-contained rather than depending on copy that was still in flight elsewhere.
      case "has_staff": return t("branches.delete.errStaff");
      case "not_found": return t("branches.delete.errNotFound");
      case "denied": return t(`${P}.errDenied`);
      case "not_authenticated": return t(`${P}.errAuth`);
      default: return t(`${P}.failed`);
    }
  }

  const branch = subject.kind === "branch" ? subject : null;
  const createdLabel = branch?.createdAt
    ? new Date(branch.createdAt).toLocaleDateString("en-PK", { year: "numeric", month: "long" })
    : null;
  /** The name the copy talks about: the branch's, or the account's own. */
  const titleArg = isAccount
    ? { name: subject.name, branch: subject.name }
    : { branch: branch!.name, name: branch!.name };

  return (
    <Sheet open title={t(`${P}.overline`)} onClose={onClose} closeButton={false}>
      <div className="px-4 pt-1 pb-3" data-testid={isAccount ? "account-delete" : `branch-delete-${branch!.id}`}>
        {/* Where in the job this screen is, above everything else. */}
        <span className="text-11" style={{ color: "var(--text-secondary)" }}>
          {t("branches.delete.step", { step: String(step) })}
        </span>
        <div className="mt-1.5">
          <StepBar step={step} />
        </div>

        {/* ── Step 1 · what is about to be lost ────────────────────────────────── */}
        {step === 1 && (
          <div data-testid="delete-step-1">
            <h2 className="text-22 font-bold mt-4 leading-tight" style={{ color: "var(--text-primary)" }}>
              {t(`${P}.step1Title`, titleArg)}
            </h2>
            <p className="text-13 mt-2 leading-snug" style={{ color: "var(--text-secondary)" }}>
              {t(`${P}.step1Body`)}
            </p>

            {/* Which thing this is, and what goes with it, as facts on one card — the same
                shape the reference uses to make the person check before they continue. */}
            <div
              className="mt-3 rounded-[var(--radius-card)] overflow-hidden"
              style={{ background: "var(--tone-card)" }}
            >
              <div className="flex items-center gap-3 px-3.5 py-3">
                <div
                  className="size-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                  aria-hidden="true"
                >
                  {isAccount ? <Trash2 size={17} /> : <Store size={17} />}
                </div>
                <div className="min-w-0">
                  <p className="text-13 font-bold truncate" style={{ color: "var(--text-primary)" }}>
                    {subject.name}
                  </p>
                  <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                    {t(`${P}.cardWhat`)}
                  </p>
                </div>
              </div>

              <div className="h-px ms-3.5" style={{ background: "var(--divider)" }} />
              {isAccount ? (
                <FactRow icon={Phone} text={t("account.delete.cardPhone", { phone: subject.phone })} />
              ) : createdLabel ? (
                <FactRow icon={CalendarDays} text={t("branches.delete.cardCreated", { date: createdLabel })} />
              ) : null}

              <div className="h-px ms-3.5" style={{ background: "var(--divider)" }} />
              {isAccount ? (
                <FactRow
                  icon={Store}
                  text={
                    subject.branchCount === 1
                      ? t("account.delete.cardOneBranch")
                      : t("account.delete.cardBranches", { count: String(subject.branchCount) })
                  }
                />
              ) : (
                <FactRow
                  icon={ShoppingCart}
                  text={
                    branch!.salesCount != null && branch!.salesCount > 0
                      ? t("branches.delete.cardTrades", { count: String(branch!.salesCount) })
                      : t("branches.delete.cardNoTrades")
                  }
                />
              )}
            </div>

            <p className="text-13 font-bold mt-4" style={{ color: "var(--text-primary)" }}>
              {t(`${P}.loseTitle`)}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {(["lose1", "lose2", "lose3", "lose4", "lose5"] as const).map((k) => (
                <li key={k} className="text-13 leading-snug" style={{ color: "var(--text-secondary)" }}>
                  {t(`${P}.${k}`)}
                </li>
              ))}
            </ul>

            {/* The reassurance matters as much as the warning: the fear this screen has to
                answer is "will my other shop lose its data too". */}
            <p className="text-13 font-bold mt-4" style={{ color: "var(--text-primary)" }}>
              {t(`${P}.safeTitle`)}
            </p>
            <p className="text-13 mt-1 leading-snug" style={{ color: "var(--text-secondary)" }}>
              {t(`${P}.safeBody`)}
            </p>

            {branch && branch.employeeCount != null && branch.employeeCount > 0 && (
              <p className="text-12 mt-3 leading-snug" style={{ color: "var(--text-secondary)" }}>
                {branch.employeeCount === 1
                  // One is its own sentence rather than "1 employees": a branch with a single
                  // person in it is the common case, not an edge case.
                  ? t("branches.delete.staffNoteOne")
                  : t("branches.delete.staffNote", { count: String(branch.employeeCount) })}
              </p>
            )}

            {/* The acknowledgement. The button stays disabled until it is ticked, so the loss
                is read before it can be acted on. */}
            <button
              type="button"
              role="checkbox"
              aria-checked={understood}
              onClick={() => setUnderstood((v) => !v)}
              data-testid="delete-understand"
              className="w-full flex items-start gap-3 mt-4 text-start ds-pressable"
            >
              <span className="mt-0.5"><Checkbox checked={understood} size={18} /></span>
              <span className="text-13 leading-snug" style={{ color: "var(--text-primary)" }}>
                {t(`${P}.understand`)}
              </span>
            </button>

            <Button
              fullWidth
              variant="danger"
              className="mt-4"
              disabled={!understood}
              onClick={() => setStep(2)}
              testId="delete-continue"
            >
              {t(`${P}.continue`)}
            </Button>
            <button
              type="button"
              onClick={onClose}
              data-testid="delete-back-1"
              className="mt-2 w-full h-10 text-12 ds-pressable"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("common.goBack")}
            </button>
          </div>
        )}

        {/* ── Step 2 · why ──────────────────────────────────────────────────────── */}
        {step === 2 && (
          <div data-testid="delete-step-2">
            <h2 className="text-22 font-bold mt-4 leading-tight" style={{ color: "var(--text-primary)" }}>
              {t(`${P}.step2Title`, titleArg)}
            </h2>
            <p className="text-13 mt-2 leading-snug" style={{ color: "var(--text-secondary)" }}>
              {t(`${P}.step2Body`)}
            </p>

            <p className="text-13 font-bold mt-4" style={{ color: "var(--text-primary)" }}>
              {t("branches.delete.reasonTitle")}
            </p>
            <div role="radiogroup" aria-label={t("branches.delete.reasonTitle")} className="mt-1">
              {REASONS.map((key) => (
                <ReasonOption
                  key={key}
                  label={t(key)}
                  selected={reason === key}
                  onSelect={() => setReason(reason === key ? null : key)}
                  testId={`delete-reason-${key.split(".").pop()}`}
                />
              ))}
            </div>

            <p className="text-13 font-bold mt-4" style={{ color: "var(--text-primary)" }}>
              {t("branches.delete.feedbackTitle")}
            </p>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={t("branches.delete.feedbackHint")}
              aria-label={t("branches.delete.feedbackHint")}
              data-testid="delete-feedback"
              className="w-full mt-2 rounded-[var(--radius-field)] p-3 text-13 outline-none resize-none"
              style={{
                background: "var(--field-bg)",
                color: "var(--text-primary)",
              }}
            />

            {error && (
              <p className="text-12 mt-2" style={{ color: "var(--error)" }} data-testid="delete-error">
                {error}
              </p>
            )}

            <Button
              fullWidth
              variant="danger"
              className="mt-4"
              loading={sending}
              // A branch is refused without a reason, so the step will not advance without one;
              // the account keeps the optional reason the reference allows.
              disabled={!isAccount && !reason}
              onClick={() => void goToCode()}
              testId="delete-confirm"
            >
              {t(`${P}.confirm`)}
            </Button>
            <button
              type="button"
              onClick={() => { setError(null); setStep(1); }}
              data-testid="delete-back-2"
              className="mt-2 w-full h-10 text-12 ds-pressable"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("common.goBack")}
            </button>
          </div>
        )}

        {/* ── Step 3 · the code ────────────────────────────────────────────────── */}
        {step === 3 && (
          <div data-testid="delete-step-3">
            <h2 className="text-22 font-bold mt-4 leading-tight" style={{ color: "var(--text-primary)" }}>
              {t(`${P}.step3Title`)}
            </h2>
            <p className="text-13 mt-2 leading-snug" style={{ color: "var(--text-secondary)" }}>
              {t(`${P}.step3Body`, { phone, ...titleArg })}
            </p>

            <p className="text-12 font-semibold mt-4" style={{ color: "var(--text-primary)" }}>
              {t("branches.delete.codeLabel")}
            </p>
            <div className="mt-2">
              <OTPInput value={code} onChange={(v) => { setCode(v); setError(null); }} error={!!error} />
            </div>

            {error && (
              <p className="text-12 mt-2" style={{ color: "var(--error)" }} data-testid="delete-error">
                {error}
              </p>
            )}

            <Button
              fullWidth
              variant="danger"
              className="mt-4"
              loading={busy}
              disabled={code.replace(/\D/g, "").length !== 6}
              onClick={() => void confirmDelete()}
              testId="delete-verify"
            >
              {busy ? t(`${P}.verifying`) : t(`${P}.verify`)}
            </Button>

            <button
              type="button"
              disabled={cooldown > 0 || sending}
              onClick={() => void resend()}
              data-testid="delete-resend"
              className="mt-2 w-full h-10 text-12 ds-pressable disabled:opacity-50"
              style={{ color: "var(--text-secondary)" }}
            >
              {sending
                ? t(`${P}.sending`)
                : cooldown > 0
                  ? t("branches.delete.resendIn", { seconds: String(cooldown) })
                  : t("branches.delete.resend")}
            </button>
            <button
              type="button"
              onClick={() => { setError(null); setCode(""); setStep(2); }}
              data-testid="delete-back-3"
              className="w-full h-9 text-12 ds-pressable"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("common.goBack")}
            </button>
          </div>
        )}

        {/* ── Step 4 · gone ────────────────────────────────────────────────────── */}
        {step === 4 && done && (
          <div data-testid="delete-step-4">
            <div
              className="mt-6 mx-auto size-14 rounded-full flex items-center justify-center"
              style={{ background: "var(--tone-sunken)" }}
            >
              <Check size={26} style={{ color: "var(--brand-dark)" }} />
            </div>
            <h2 className="text-20 font-bold mt-4 text-center leading-tight" style={{ color: "var(--text-primary)" }}>
              {t("branches.delete.step4Title", { branch: done.name })}
            </h2>
            <p className="text-13 mt-2 text-center leading-snug" style={{ color: "var(--text-secondary)" }}>
              {t("branches.delete.step4Body", {
                branch: done.name,
                fallback: done.fallbackName || t("shop.yourShop"),
              })}
            </p>
            <Button fullWidth className="mt-5" onClick={onClose} testId="delete-done">
              {t("branches.delete.done")}
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** The branch half, as a `DeleteSubject` the Branches screen and Settings both build. */
export function branchDeleteSubject(branch: BranchSummary): DeleteSubject {
  return {
    kind: "branch",
    id: branch.id,
    name: branch.name,
    createdAt: branch.createdAt,
    salesCount: branch.salesCount,
    employeeCount: branch.employeeCount,
  };
}

export function branchDeleteSubjectSafe(branch: BranchSummary): DeleteSubject {
  return {
    kind: "branch",
    id: branch.id,
    name: branch.name,
    createdAt: branch.createdAt,
    salesCount: branch.salesCount ?? 0,
    employeeCount: branch.employeeCount ?? 0,
  };
}
