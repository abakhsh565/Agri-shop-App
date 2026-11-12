import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import DateField from "@/components/ui/DateField";
import InlineSelect from "@/components/ui/InlineSelect";
import { Skeleton } from "@/components/ui/Skeleton";
import FinanceMediaField, { type FinanceMediaView } from "@/components/finance/FinanceMediaField";
import { useT, type I18nKey } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import {
  CATEGORY_KEY,
  FINANCE_CATEGORIES,
  FINANCE_METHODS,
  KIND_LABEL_KEY,
  METHOD_KEY,
  deleteFinanceEntry,
  updateFinanceEntry,
  useFinanceEntryDetail,
  type FinanceEntryChange,
  type FinanceEntryKind,
  type FinanceEntryMedia,
  type FinanceEntrySnapshot,
  type FinanceMethod,
} from "@/lib/financeEntries";
import {
  MAX_MEDIA_BYTES,
  financeMediaUrls,
  mediaMime,
  removeFinanceMedia,
  uploadFinanceMedia,
  type FinanceMediaDraft,
} from "@/lib/financeMedia";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";

/**
 * One recorded entry, in full: what it says, its papers, and everything that happened to it.
 *
 * WHY THIS IS A SHEET AND NOT A SCREEN. The ledger is a list of rows; opening one is a glance, a
 * correction, or a delete — not a place with its own address. It opens over the list it came from
 * and closes back into it, so the period, the filter and the search are exactly where they were.
 *
 * IT DOES NOT DECIDE WHO MAY WRITE. The owner-only rule is enforced by the database (0261); the
 * buttons are hidden for anyone else because a control that only exists to be refused is a lie
 * about what this account can do. A deleted row keeps its history and loses its actions: the past
 * is what the history is for, and re-editing a deletion would make the record ambiguous.
 *
 * THE PAPERS ARE SIGNED, NOT PUBLIC. The objects live in a private bucket; the sheet asks for
 * short-lived URLs and draws whatever was signed. A path that cannot be signed stays a placeholder
 * rather than a broken image, and the file itself is untouched.
 *
 * UPLOAD RETRY IS THE SAME RULE AS THE FORM. A file that fails stays in the field with its local
 * preview and the retry button sends exactly that file again; a file that lands is freed from the
 * list immediately, so a retry never attaches the same receipt twice.
 */

const KIND_ICON: Record<FinanceEntryKind, typeof ArrowDownLeft> = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  drawing: Undo2,
};

type SnapshotField = "kind" | "amount" | "occurredOn" | "category" | "method" | "counterparty" | "note";

const FIELD_KEY: Record<SnapshotField, I18nKey> = {
  kind: "finance.ledger.kind",
  amount: "finance.detail.field.amount",
  occurredOn: "finance.detail.field.date",
  category: "finance.detail.field.category",
  method: "finance.detail.field.method",
  counterparty: "finance.detail.field.counterparty",
  note: "finance.detail.field.note",
};

const ACTION_KEY = {
  created: "finance.detail.created",
  updated: "finance.detail.updated",
  deleted: "finance.detail.removed",
} as const;

interface FinanceEntrySheetProps {
  entryId: string | null;
  open: boolean;
  onClose: () => void;
  /** Re-read the list behind the sheet after any change it made. */
  onChanged: () => void;
}

export default function FinanceEntrySheet({ entryId, open, onClose, onChanged }: FinanceEntrySheetProps) {
  const t = useT();
  const language = useThemeStore((s) => s.language);
  const { addToast } = useUIStore();
  const role = useAuthStore((s) => s.user?.membershipRole);
  const isOwner = role === "owner";
  const activeShopId = useShopStore((s) => s.activeShopId);
  const activeBranchId = useShopStore((s) => s.activeBranchId);

  const { row, failed, loading, retry } = useFinanceEntryDetail(open ? entryId : null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<FinanceMediaDraft[]>([]);
  const draftUrls = useMemo(() => new Set<string>(), []);

  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState(pkToday());
  const [category, setCategory] = useState("");
  const [method, setMethod] = useState<FinanceMethod>("cash");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Synchronous claims, not the state above: two taps in one task both reach the handler before
  // React has drawn the disabled attribute, so the state is still false for the second one.
  const busyRef = useRef(false);
  const savingEditRef = useRef(false);
  const deletingRef = useRef(false);

  // A different entry means a different set of pictures, a closed editor and no leftovers from the
  // previous one. Nothing from one row may be shown on another.
  useEffect(() => {
    setEditing(false);
    setEditError("");
    setNotice("");
    setDrafts((current) => {
      for (const draft of current) URL.revokeObjectURL(draft.url);
      return [];
    });
    setUrls(new Map());
  }, [entryId]);

  useEffect(() => () => {
    for (const url of draftUrls) URL.revokeObjectURL(url);
  }, [draftUrls]);

  // Sign whatever this entry's papers are. A failure leaves the path unsigned; the tile says it is
  // loading rather than drawing a broken link.
  useEffect(() => {
    if (!row) return;
    let live = true;
    if (!row.media.length) {
      setUrls(new Map());
      return;
    }
    void financeMediaUrls(row.media.map((media) => media.path)).then((map) => {
      if (live) setUrls(map);
    });
    return () => {
      live = false;
    };
  }, [row]);

  // The editor starts from the row every time it opens, so a half-edited value from the previous
  // opening cannot be saved by mistake.
  useEffect(() => {
    if (!row || !editing) return;
    setAmount(String(row.amount));
    setDay(row.occurredOn);
    setCategory(row.category);
    setMethod((METHOD_KEY[row.method as FinanceMethod] ? row.method : "cash") as FinanceMethod);
    setCounterparty(row.counterparty ?? "");
    setNote(row.note ?? "");
    setEditError("");
  }, [row, editing]);

  const categoryLabel = (value: string) =>
    CATEGORY_KEY[value] ? t(CATEGORY_KEY[value]) : value || t("finance.unknown");
  const methodLabel = (value: string) =>
    METHOD_KEY[value as FinanceMethod] ? t(METHOD_KEY[value as FinanceMethod]) : value;
  const kindLabel = (value: FinanceEntryKind) => t(KIND_LABEL_KEY[value]);

  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(language === "ur" ? "ur-PK" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  const moment = (iso: string) =>
    new Date(iso).toLocaleString(language === "ur" ? "ur-PK" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  /** The value a snapshot holds, in the words the reader sees. */
  function snapshotValue(snapshot: FinanceEntrySnapshot | null, field: SnapshotField): string | null {
    if (!snapshot) return null;
    if (field === "amount") return snapshot.amount == null ? null : formatCurrency(Number(snapshot.amount));
    if (field === "occurredOn") return snapshot.occurredOn ? shortDate(snapshot.occurredOn) : null;
    if (field === "category") return snapshot.category ? categoryLabel(snapshot.category) : null;
    if (field === "method") return snapshot.method ? methodLabel(snapshot.method) : null;
    if (field === "kind") return snapshot.kind ? kindLabel(snapshot.kind) : null;
    const raw = field === "counterparty" ? snapshot.counterparty : snapshot.note;
    return raw && raw.trim() ? raw : null;
  }

  /** Only the fields that actually moved — a correction that renamed the note must not claim the amount did. */
  function changedFields(before: FinanceEntrySnapshot | null, after: FinanceEntrySnapshot | null) {
    if (!before || !after) return [] as { field: SnapshotField; from: string | null; to: string | null }[];
    return (Object.keys(FIELD_KEY) as SnapshotField[])
      .map((field) => ({
        field,
        from: snapshotValue(before, field),
        to: snapshotValue(after, field),
      }))
      .filter((change) => change.from !== change.to);
  }

  const views = (type: "photo" | "voice"): FinanceMediaView[] => {
    const saved: FinanceMediaView[] = (row?.media ?? [])
      .filter((media: FinanceEntryMedia) => media.kind === type)
      .map((media) => ({
        key: media.id,
        kind: media.kind,
        url: urls.get(media.path) ?? null,
        durationMs: media.durationMs,
        draft: false,
      }));
    const local: FinanceMediaView[] = drafts
      .filter((draft) => draft.kind === type)
      .map((draft) => ({
        key: draft.key,
        kind: draft.kind,
        url: draft.url,
        durationMs: draft.durationMs,
        draft: true,
      }));
    return [...saved, ...local];
  };

  function newDraft(file: File, kind: "photo" | "voice", durationMs: number | null): FinanceMediaDraft {
    const url = URL.createObjectURL(file);
    draftUrls.add(url);
    return {
      key: crypto.randomUUID(),
      kind,
      file,
      url,
      durationMs,
      mime: mediaMime(file, kind),
      uploaded: false,
    };
  }

  async function sendDrafts(list: FinanceMediaDraft[]) {
    if (!row) return;
    if (!activeShopId || !activeBranchId) {
      setNotice(t("finance.media.noBranch"));
      return;
    }
    setBusy(true);
    setNotice("");
    const failed: FinanceMediaDraft[] = [];
    for (const draft of list) {
      if (draft.file.size > MAX_MEDIA_BYTES) {
        failed.push(draft);
        continue;
      }
      try {
        await uploadFinanceMedia({
          shopId: activeShopId,
          branchId: activeBranchId,
          entryId: row.id,
          kind: draft.kind,
          file: draft.file,
          durationMs: draft.durationMs,
        });
        URL.revokeObjectURL(draft.url);
        draftUrls.delete(draft.url);
      } catch {
        failed.push(draft);
      }
    }
    setDrafts((current) => [...current.filter((draft) => !list.includes(draft)), ...failed]);
    setBusy(false);
    if (failed.length) setNotice(t("finance.media.uploadFailed", { count: String(failed.length) }));
    retry();
    onChanged();
  }

  function addPhotos(files: File[]) {
    const created = files
      .filter((file) => file.size <= MAX_MEDIA_BYTES)
      .map((file) => newDraft(file, "photo", null));
    if (created.length < files.length) setNotice(t("finance.media.tooLarge"));
    if (!created.length) return;
    setDrafts((current) => [...current, ...created]);
    void sendDrafts(created);
  }

  function addVoice(file: File, durationMs: number) {
    if (file.size > MAX_MEDIA_BYTES) {
      setNotice(t("finance.media.tooLarge"));
      return;
    }
    const draft = newDraft(file, "voice", durationMs);
    setDrafts((current) => [...current, draft]);
    void sendDrafts([draft]);
  }

  function dropDraft(key: string) {
    setDrafts((current) => {
      const found = current.find((draft) => draft.key === key);
      if (found) {
        URL.revokeObjectURL(found.url);
        draftUrls.delete(found.url);
      }
      return current.filter((draft) => draft.key !== key);
    });
  }

  async function removeSaved(media: FinanceEntryMedia) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await removeFinanceMedia(media.id);
      retry();
      onChanged();
    } catch {
      setNotice(t("finance.detail.saveFailed"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!row || savingEditRef.current) return;
    const paid = Number(amount);
    if (!Number.isFinite(paid) || paid <= 0) {
      setEditError(t("finance.amountError"));
      return;
    }
    // Claimed only once the form is known to be valid: a rejected amount must not leave the
    // sheet unable to submit the correction the owner is about to type.
    savingEditRef.current = true;
    setSavingEdit(true);
    setEditError("");
    try {
      await updateFinanceEntry({
        id: row.id,
        kind: row.kind,
        amount: Math.round(paid * 100) / 100,
        category,
        method,
        occurredOn: day,
        counterparty,
        note,
      });
      addToast(t("finance.detail.saved"), "success");
      setEditing(false);
      retry();
      onChanged();
    } catch {
      setEditError(t("finance.detail.saveFailed"));
    } finally {
      savingEditRef.current = false;
      setSavingEdit(false);
    }
  }

  async function removeEntry() {
    if (!row || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteFinanceEntry(row.id);
      addToast(t("finance.detail.deleted"), "success");
      setConfirmDelete(false);
      onChanged();
      onClose();
    } catch {
      setConfirmDelete(false);
      setNotice(t("finance.detail.deleteFailed"));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  const hero = useMemo(() => {
    if (!row) return null;
    const Icon = KIND_ICON[row.kind];
    return (
      <div className="px-5 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className="size-7 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--tone-sunken)" }}
          >
            <Icon size={14} style={{ color: "var(--text-secondary)" }} />
          </span>
          <span className="text-11" style={{ color: "var(--text-secondary)" }}>
            {kindLabel(row.kind)}
          </span>
          {row.deletedAt && (
            <span
              className="text-10 font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "var(--tone-sunken)", color: "var(--error)" }}
              data-testid="finance-entry-deleted-badge"
            >
              {t("finance.detail.deletedBadge")}
            </span>
          )}
        </div>
        <p
          className="text-28 font-bold tabular-nums break-words"
          style={{ color: row.deletedAt ? "var(--text-secondary)" : "var(--brand-dark)" }}
          data-testid="finance-entry-amount"
        >
          {formatCurrency(row.amount)}
        </p>
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>
          {categoryLabel(row.category)} · {shortDate(row.occurredOn)}
        </p>
        {row.deletedAt && (
          <p className="text-11" style={{ color: "var(--error)" }}>
            {t("finance.detail.deletedNote")}
          </p>
        )}
      </div>
    );
  }, [row, language, t]);

  const deletable = Boolean(row && isOwner && !row.deletedAt);

  return (
    <>
      <Sheet
        open={open}
        title={row ? categoryLabel(row.category) : t("finance.detail.title")}
        onClose={onClose}
        closeButton={false}
        maxHeight="90vh"
      >
        {failed ? (
          <div className="px-5 flex flex-col items-start gap-3">
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {t("finance.detail.notFound")}
            </p>
            <button
              type="button"
              onClick={retry}
              className="text-12 font-semibold"
              style={{ color: "var(--brand-dark)" }}
            >
              {t("common.retry")}
            </button>
          </div>
        ) : loading || !row ? (
          <div className="px-5 flex flex-col gap-3">
            <Skeleton w="45%" h="32px" />
            <Skeleton w="70%" h="16px" />
            <Skeleton w="100%" h="64px" />
          </div>
        ) : (
          <div className="flex flex-col gap-5 pb-2">
            {hero}

            {editing ? (
              <div className="px-5 flex flex-col gap-3" data-testid="finance-entry-editor">
                <div className="flex flex-col gap-1.5">
                  <span className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {t("finance.detail.field.amount")}
                  </span>
                  <div className="ds-field">
                    <span className="text-13 font-semibold me-2" style={{ color: "var(--text-secondary)" }}>
                      Rs
                    </span>
                    <input
                      value={amount}
                      onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                      inputMode="decimal"
                      aria-label={t("finance.detail.field.amount")}
                      data-testid="finance-entry-edit-amount"
                      className="flex-1 min-w-0 h-full bg-transparent outline-none text-13 tabular-nums"
                      style={{ color: "var(--text-primary)" }}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {t("finance.detail.field.date")}
                  </span>
                  <DateField
                    value={day}
                    max={pkToday()}
                    onChange={setDay}
                    ariaLabel={t("finance.detail.field.date")}
                    testId="finance-entry-edit-date"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {t("finance.detail.field.category")}
                  </span>
                  <InlineSelect
                    value={category}
                    options={FINANCE_CATEGORIES[row.kind].map((value) => ({
                      value,
                      label: categoryLabel(value),
                    }))}
                    onChange={setCategory}
                    label={t("finance.detail.field.category")}
                    testId="finance-entry-edit-category"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {t("finance.detail.field.method")}
                  </span>
                  <InlineSelect
                    value={method}
                    options={FINANCE_METHODS.map((value) => ({ value, label: methodLabel(value) }))}
                    onChange={(value) => setMethod(value as FinanceMethod)}
                    label={t("finance.detail.field.method")}
                    testId="finance-entry-edit-method"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {t("finance.detail.field.counterparty")}
                  </span>
                  <div className="ds-field">
                    <input
                      value={counterparty}
                      onChange={(event) => setCounterparty(event.target.value)}
                      placeholder={t("finance.counterpartyPlaceholder")}
                      aria-label={t("finance.detail.field.counterparty")}
                      data-testid="finance-entry-edit-counterparty"
                      className="flex-1 min-w-0 h-full bg-transparent outline-none text-13"
                      style={{ color: "var(--text-primary)" }}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {t("finance.detail.field.note")}
                  </span>
                  <div className="ds-field">
                    <input
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      aria-label={t("finance.detail.field.note")}
                      data-testid="finance-entry-edit-note"
                      className="flex-1 min-w-0 h-full bg-transparent outline-none text-13"
                      style={{ color: "var(--text-primary)" }}
                    />
                  </div>
                </div>

                {editError && (
                  <p className="text-11" style={{ color: "var(--error)" }} data-testid="finance-entry-edit-error">
                    {editError}
                  </p>
                )}

              </div>
            ) : (
              <div className="px-5 flex flex-col gap-2.5">
                <DetailLine label={t("finance.detail.field.category")} value={categoryLabel(row.category)} />
                <DetailLine label={t("finance.detail.field.method")} value={methodLabel(row.method)} />
                <DetailLine
                  label={t("finance.detail.field.counterparty")}
                  value={row.counterparty || t("finance.detail.emptyValue")}
                />
                <DetailLine
                  label={t("finance.detail.field.note")}
                  value={row.note || t("finance.detail.emptyValue")}
                />
                <DetailLine
                  label={t("finance.ledger.addedByColumn")}
                  value={row.createdByName ?? t("finance.ledger.addedUnknown")}
                />
                {/* `updated_at` is stamped on the insert too, so it is only proof of a
                    correction when the history actually holds one. Without this, every new row
                    claimed it had been corrected at the moment it was written. */}
                {(() => {
                  const lastCorrection = row.history.find((change) => change.action === "updated");
                  if (!lastCorrection) return null;
                  return (
                    <p className="text-10" style={{ color: "var(--text-tertiary)" }}>
                      {t("finance.detail.updatedOn", { date: moment(lastCorrection.changedAt) })}
                    </p>
                  );
                })()}
              </div>
            )}

            {/* Papers and a spoken explanation. The control is the same one the form uses, so a
                receipt is added the same way whether the money is being typed or corrected. */}
            <div className="px-5">
              <FinanceMediaField
                photos={views("photo")}
                voices={views("voice")}
                busy={busy}
                readOnly={!isOwner || !editing || Boolean(row.deletedAt)}
                onAddPhotos={addPhotos}
                onRemove={(view) => {
                  if (view.draft) {
                    dropDraft(view.key);
                    return;
                  }
                  const media = row.media.find((item) => item.id === view.key);
                  if (media) void removeSaved(media);
                }}
                onRecorded={addVoice}
              />
              {notice && (
                <p className="text-11 mt-2" style={{ color: "var(--error)" }} data-testid="finance-entry-media-error">
                  {notice}
                </p>
              )}
              {/* A file that failed stays in the field above; this sends exactly that file again
                  instead of asking the owner to choose it a second time. */}
              {!busy && drafts.length > 0 && (
                <button
                  type="button"
                  onClick={() => void sendDrafts(drafts)}
                  data-testid="finance-entry-media-retry"
                  className="text-11 font-semibold mt-1"
                  style={{ color: "var(--brand-dark)" }}
                >
                  {t("finance.media.retryUploads")}
                </button>
              )}
              {!isOwner && (
                <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
                  {t("finance.detail.ownerOnly")}
                </p>
              )}
            </div>

            <div className="px-5">
              <p className="text-13 font-bold">{t("finance.detail.history")}</p>
              <div className="flex flex-col gap-3 mt-2">
                {row.history.length === 0 ? (
                  <p className="text-11" style={{ color: "var(--text-tertiary)" }}>
                    {t("finance.detail.noHistory")}
                  </p>
                ) : (
                  row.history.map((change) => (
                    <HistoryRow
                      key={change.id}
                      change={change}
                      actionLabel={t(ACTION_KEY[change.action])}
                      actor={(name) =>
                        t("finance.detail.by", { name: name ?? t("finance.detail.unknownActor") })
                      }
                      moment={moment}
                      changes={changedFields(change.before, change.after)}
                      fieldLabel={(field) => t(FIELD_KEY[field])}
                      empty={t("finance.detail.emptyValue")}
                    />
                  ))
                )}
              </div>
            </div>

            {isOwner && !row.deletedAt && (
              <div className="px-5 flex gap-2 pt-1">
                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      data-testid="finance-entry-edit-cancel"
                      className="flex-1 h-11 rounded-full text-13 font-semibold"
                      style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveEdit()}
                      disabled={savingEdit}
                      data-testid="finance-entry-edit-save"
                      className="flex-1 h-11 rounded-full text-13 font-bold disabled:opacity-45"
                      style={{ background: "var(--text-primary)", color: "var(--background)" }}
                    >
                      {t("finance.detail.save")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      data-testid="finance-entry-edit"
                      className="flex-1 h-11 rounded-full text-13 font-semibold flex items-center justify-center gap-2"
                      style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                    >
                      <Pencil size={14} />
                      {t("finance.detail.edit")}
                    </button>
                    {deletable && (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        data-testid="finance-entry-delete"
                        className="flex-1 h-11 rounded-full text-13 font-semibold flex items-center justify-center gap-2"
                        style={{ background: "var(--tone-sunken)", color: "var(--error)" }}
                      >
                        <Trash2 size={14} />
                        {t("finance.detail.delete")}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        title={t("finance.detail.deleteTitle")}
        message={t("finance.detail.deleteMessage", {
          amount: row ? formatCurrency(row.amount) : "",
          category: row ? categoryLabel(row.category) : "",
        })}
        confirmLabel={t("finance.detail.delete")}
        destructive
        loading={deleting}
        onConfirm={() => void removeEntry()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-11 shrink-0" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span className="text-12 font-semibold text-end min-w-0 break-words">{value}</span>
    </div>
  );
}

function HistoryRow({
  change,
  actionLabel,
  actor,
  moment,
  changes,
  fieldLabel,
  empty,
}: {
  change: FinanceEntryChange;
  actionLabel: string;
  actor: (name: string | null) => string;
  moment: (iso: string) => string;
  changes: { field: SnapshotField; from: string | null; to: string | null }[];
  fieldLabel: (field: SnapshotField) => string;
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-1" data-testid={`finance-entry-history-${change.id}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-12 font-semibold">{actionLabel}</span>
        <span className="text-10 shrink-0" style={{ color: "var(--text-tertiary)" }}>
          {moment(change.changedAt)}
        </span>
      </div>
      <p className="text-10" style={{ color: "var(--text-secondary)" }}>
        {actor(change.changedByName)}
      </p>
      {changes.map((item) => (
        <p key={item.field} className="text-10" style={{ color: "var(--text-tertiary)" }}>
          {fieldLabel(item.field)}: {item.from ?? empty} → {item.to ?? empty}
        </p>
      ))}
    </div>
  );
}
