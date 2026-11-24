import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronRight,
  Clock,
  ImagePlus,
  Mic,
  X,
  MapPin,
  Phone,
  Send,
  UserRound,
  Wallet,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Sheet from "@/components/ui/Sheet";
import SelectSheet from "@/components/ui/SelectSheet";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import LogoTile from "@/components/ui/LogoTile";
import { useT, tNow, type TranslateFn } from "@/lib/i18n";
import { useChatViewport } from "@/hooks/useChatViewport";
import { useShellBase } from "@/lib/useShellBase";
import { formatCurrency, formatDate, formatDateTime, formatTime } from "@/lib/formatters";
import { whatsappShareUrl } from "@/lib/appInvite";
import { PhotoMessage, VoiceNote } from "@/components/chat/MessageMedia";
import { formatDuration, startVoiceRecording, type Recording } from "@/lib/chatMedia";
import {
  useFarmerMessagesStore,
  type AssignableOfficer,
  type CreditRequest,
  type FarmerMessage,
  type VisitRequest,
} from "@/stores/farmerMessagesStore";

/**
 * One farmer's conversation, built the way a messenger is built.
 *
 * WHY THE REQUESTS LIVE IN THE CHAT. A credit ask and a visit ask are things that happened in
 * this relationship, so they sit in the timeline where they happened — between the message that
 * said "3 bori urea chahiye" and the reply that answered it. The old screen put chats and asks on
 * two tabs, which meant the owner had to remember which tab held the thing he was thinking about.
 * There is one stream now, and an ask is simply a different kind of bubble.
 *
 * ONE TAP TO ANSWER. Tapping a request bubble opens one sheet holding the whole decision: the
 * ask, the terms, and one primary button. There is no stepper and no second screen. The sheet is
 * also where an assigned visit is moved forward, so the officer's field work never becomes a
 * form.
 *
 * ONE SEND BUTTON. Type, tap send. The app sends in the farmer app when he has it and records a
 * WhatsApp send when he does not, with one quiet line under the field saying which will happen.
 * The owner never has to choose a channel before writing.
 */
type Entry =
  | { kind: "message"; at: string; message: FarmerMessage }
  | { kind: "credit"; at: string; request: CreditRequest }
  | { kind: "visit"; at: string; visit: VisitRequest };

type AskRef = { kind: "credit" | "visit"; id: string };

export default function FarmerThreadPage() {
  const t = useT();
  const base = useShellBase();
  const { farmerId = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const askParam = params.get("ask");

  const thread = useFarmerMessagesStore((s) => s.thread);
  const loading = useFarmerMessagesStore((s) => s.threadLoading);
  const loadThread = useFarmerMessagesStore((s) => s.loadThread);
  const send = useFarmerMessagesStore((s) => s.send);
  const media = useFarmerMessagesStore((s) => s.media);
  const sendVoice = useFarmerMessagesStore((s) => s.sendVoice);
  const sendImage = useFarmerMessagesStore((s) => s.sendImage);
  const reviseOffer = useFarmerMessagesStore((s) => s.reviseOffer);
  const closeRequest = useFarmerMessagesStore((s) => s.closeRequest);
  const scheduleVisit = useFarmerMessagesStore((s) => s.scheduleVisit);
  const advanceVisit = useFarmerMessagesStore((s) => s.advanceVisit);
  const listOfficers = useFarmerMessagesStore((s) => s.listOfficers);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Voice: the recorder is held while it runs, so the elapsed timer and the buttons share one truth.
  const [recording, setRecording] = useState<Recording | null>(null);
  const [recordMs, setRecordMs] = useState(0);
  // A stopped recording waits here so it can be heard before it is sent — a voice note cannot be
  // unsent, and a pocket recording is the usual way a wrong one gets sent.
  const [preview, setPreview] = useState<{ blob: Blob; mimeType: string; durationMs: number; url: string } | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const imageInput = useRef<HTMLInputElement | null>(null);

  const [openAsk, setOpenAsk] = useState<AskRef | null>(null);
  const [offerTotal, setOfferTotal] = useState("");
  const [offerDue, setOfferDue] = useState("");
  const [offerNote, setOfferNote] = useState("");
  const [visitAt, setVisitAt] = useState("");
  const [visitNote, setVisitNote] = useState("");
  const [officerId, setOfficerId] = useState("");
  const [officers, setOfficers] = useState<AssignableOfficer[]>([]);
  const [officerPickerOpen, setOfficerPickerOpen] = useState(false);
  const [editingVisit, setEditingVisit] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);

  // The chat owns the visible viewport: the header and the composer stay put while the transcript
  // scrolls, and the whole shell follows the keyboard instead of the document scrolling under it.
  useChatViewport();

  const current = thread && thread.farmer.id === farmerId ? thread : null;

  useEffect(() => {
    if (!farmerId) return;
    void loadThread(farmerId).catch(() => setError(tNow("messages.loadFailed")));
    // `t` is deliberately absent: useT returns a new function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmerId, loadThread]);

  // A link from a profile row or an older notification lands on the chat with the ask named.
  useEffect(() => {
    if (!askParam) return;
    const [kind, id] = askParam.split(":");
    if (!id) return;
    setOpenAsk({ kind: kind === "visit" ? "visit" : "credit", id });
  }, [askParam]);

  // Fill the sheet's fields from the record it is showing. This is also what makes the deep link
  // above complete: the chat is loaded once and the sheet reads the record it names.
  useEffect(() => {
    if (!openAsk || !current) return;
    if (openAsk.kind === "credit") {
      const request = current.requests.find((r) => r.id === openAsk.id);
      if (!request) return;
      setOfferTotal(String(request.offer_total ?? request.requested_amount ?? ""));
      setOfferDue(request.offer_due_on ?? "");
      setOfferNote(request.offer_note ?? "");
    } else {
      const visit = current.visits.find((v) => v.id === openAsk.id);
      if (!visit) return;
      setOfficerId(visit.assigned_to ?? "");
      setVisitAt(visit.scheduled_for ? visit.scheduled_for.slice(0, 16) : "");
      setVisitNote(visit.owner_note ?? "");
    }
    setEditingVisit(false);
    // Keyed on the farmer's id, not the thread object: a live refresh replaces that object every
    // few seconds, and re-running this would wipe whatever the owner had typed into the sheet.
  }, [openAsk, current?.farmer.id]);

  useEffect(() => {
    if (openAsk?.kind !== "visit" || officers.length > 0) return;
    void listOfficers()
      .then(setOfficers)
      .catch(() => setOfficers([]));
  }, [openAsk, officers.length, listOfficers]);

  // A conversation is live. While this screen is open and visible, re-read the thread so a farmer
  // answering from his app arrives without the owner pulling to refresh — the other half of
  // "seamless" is that the shop does not have to ask. Twelve seconds keeps polling cheap on a
  // rural connection, and the same call advances the read watermark, so an open chat never
  // accumulates unread.
  useEffect(() => {
    if (!farmerId) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadThread(farmerId).catch(() => undefined);
    }, 12000);
    return () => window.clearInterval(id);
  }, [farmerId, loadThread]);

  const entries = useMemo<Entry[]>(() => {
    if (!current) return [];
    return [
      ...current.messages.map((message) => ({ kind: "message" as const, at: message.created_at, message })),
      ...current.requests.map((request) => ({ kind: "credit" as const, at: request.created_at, request })),
      ...current.visits.map((visit) => ({ kind: "visit" as const, at: visit.created_at, visit })),
    ].sort((a, b) => a.at.localeCompare(b.at));
  }, [current]);

  const groups = useMemo(() => {
    const out: Array<{ key: string; items: Entry[] }> = [];
    for (const entry of entries) {
      const key = dayKey(entry.at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(entry);
      else out.push({ key, items: [entry] });
    }
    return out;
  }, [entries]);

  // Jump to the newest entry when the conversation opens. After that, follow new entries only
  // while the owner is already at the bottom — reading back must never be yanked away.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [farmerId, current?.farmer.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const openCredit = openAsk?.kind === "credit" ? current?.requests.find((r) => r.id === openAsk.id) ?? null : null;
  const openVisit = openAsk?.kind === "visit" ? current?.visits.find((v) => v.id === openAsk.id) ?? null : null;

  function closeAsk() {
    setOpenAsk(null);
    setEditingVisit(false);
    if (askParam) setParams({}, { replace: true });
  }

  useEffect(() => {
    if (!recording) return;
    setRecordMs(Date.now() - recording.startedAt);
    const id = window.setInterval(() => setRecordMs(Date.now() - recording.startedAt), 200);
    return () => window.clearInterval(id);
  }, [recording]);

  async function toggleRecording() {
    if (recording) {
      const active = recording;
      setRecording(null);
      try {
        const captured = await active.stop();
        if (preview) URL.revokeObjectURL(preview.url);
        setPreview({ ...captured, url: URL.createObjectURL(captured.blob) });
      } catch {
        setError(t("messages.actionFailed"));
      } finally {
        setRecordMs(0);
      }
      return;
    }
    try {
      if (preview) {
        URL.revokeObjectURL(preview.url);
        setPreview(null);
      }
      setRecording(await startVoiceRecording());
      setRecordMs(0);
    } catch {
      setError(t("messages.voiceDenied"));
    }
  }

  function cancelRecording() {
    recording?.cancel();
    setRecording(null);
    setRecordMs(0);
  }

  function discardPreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  async function sendPreview() {
    if (!preview || mediaBusy) return;
    setMediaBusy(true);
    try {
      await sendVoice(farmerId, preview.blob, preview.mimeType, preview.durationMs);
      URL.revokeObjectURL(preview.url);
      setPreview(null);
      atBottomRef.current = true;
      await loadThread(farmerId, { markRead: false });
    } catch {
      setError(t("messages.actionFailed"));
    } finally {
      setMediaBusy(false);
    }
  }

  async function pickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setMediaBusy(true);
    try {
      await sendImage(farmerId, file);
      atBottomRef.current = true;
      await loadThread(farmerId, { markRead: false });
    } catch {
      setError(t("messages.actionFailed"));
    } finally {
      setMediaBusy(false);
    }
  }

  async function submitMessage() {
    const text = draft.trim();
    if (!text || busy || !current) return;
    setBusy(true);
    setError("");
    try {
      if (current.farmer.app_ready) {
        await send(farmerId, text, "app");
      } else {
        // Opened synchronously, before the await: a window opened afterwards is popup-blocked.
        window.open(whatsappShareUrl(current.farmer.phone, text), "_blank", "noopener");
        await send(farmerId, text, "whatsapp");
      }
      setDraft("");
      atBottomRef.current = true;
      await loadThread(farmerId);
    } catch {
      setError(t("messages.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitOffer() {
    if (!openCredit) return;
    const total = Number(offerTotal);
    if (!Number.isFinite(total) || total <= 0) {
      setError(t("messages.validTotal"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await reviseOffer({
        requestId: openCredit.id,
        lines: [
          {
            name: offerNote.trim() || t("messages.creditRequest"),
            qty: 1,
            unit: "",
            price: total,
          },
        ],
        total,
        dueOn: offerDue || null,
        note: offerNote || null,
      });
      await loadThread(farmerId);
      closeAsk();
    } catch {
      setError(t("messages.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function closeCredit() {
    if (!openCredit) return;
    setBusy(true);
    setError("");
    try {
      await closeRequest(openCredit.id);
      await loadThread(farmerId);
      closeAsk();
    } catch {
      setError(t("messages.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitVisit() {
    if (!openVisit) return;
    if (!officerId || !visitAt) {
      setError(t("messages.officerAndTimeRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await scheduleVisit({
        visitId: openVisit.id,
        employeeId: officerId,
        scheduledFor: new Date(visitAt).toISOString(),
        note: visitNote || null,
      });
      await loadThread(farmerId);
      closeAsk();
    } catch {
      setError(t("messages.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function moveVisit(status: "in_progress" | "completed" | "cancelled") {
    if (!openVisit) return;
    setBusy(true);
    setError("");
    try {
      await advanceVisit(openVisit.id, status, null);
      await loadThread(farmerId);
      closeAsk();
    } catch {
      setError(t("messages.actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !current) {
    return (
      <div
        className="flex w-full flex-col overflow-hidden"
        style={{ height: "var(--chat-viewport-height, 100dvh)", background: "var(--background)" }}
      >
        <StatusBar />
        <div className="h-14" />
        <div className="px-3 flex flex-col gap-2">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-10 w-1/2 ms-auto" />
          <Skeleton className="h-24 w-3/4" />
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div
        className="flex w-full flex-col overflow-hidden"
        style={{ height: "var(--chat-viewport-height, 100dvh)", background: "var(--background)" }}
      >
        <StatusBar />
        <EmptyState
          icon={Wallet}
          title={t("messages.threadMissing")}
          action={{ label: t("common.back"), onClick: () => navigate(`${base}/messages`) }}
        />
      </div>
    );
  }

  const farmer = current.farmer;

  // The one ask still waiting on the shop, surfaced above the composer so answering never
  // depends on scrolling back through the conversation to find it.
  const pendingCredit = current.requests
    .filter((r) => r.status === "submitted")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const pendingVisit = current.visits
    .filter((v) => v.status === "requested")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  const pendingAsk =
    pendingCredit && pendingVisit
      ? pendingCredit.created_at > pendingVisit.created_at
        ? { kind: "credit" as const, credit: pendingCredit }
        : { kind: "visit" as const, visit: pendingVisit }
      : pendingCredit
        ? { kind: "credit" as const, credit: pendingCredit }
        : pendingVisit
          ? { kind: "visit" as const, visit: pendingVisit }
          : null;

  return (
    <div
      className="flex w-full flex-col overflow-hidden"
      style={{ height: "var(--chat-viewport-height, 100dvh)", background: "var(--background)" }}
    >
      <StatusBar />

      {/* WhatsApp's header: back, the person, and the one secondary action a shop needs — call. */}
      <div className="flex items-center gap-1 px-2 h-14 shrink-0">
        <button
          type="button"
          onClick={() => navigate(`${base}/messages`)}
          aria-label={t("common.back")}
          className="flex size-11 shrink-0 items-center justify-center"
          style={{ color: "var(--text-primary)" }}
          data-testid="nav-back"
        >
          <ArrowLeft size={18} />
        </button>
        <button
          type="button"
          onClick={() => navigate(`${base}/messages/${farmerId}/profile`)}
          aria-label={t("messages.openProfileAria", { name: farmer.name })}
          className="flex items-center gap-2.5 min-w-0 flex-1 text-start"
          data-testid="farmer-open-profile"
        >
          <LogoTile name={farmer.name} size={38} />
          <span className="min-w-0 flex flex-col">
            <span className="text-16 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {farmer.name}
            </span>
            <span className="text-11 truncate" style={{ color: "var(--text-secondary)" }}>
              {[farmer.village, farmer.phone].filter(Boolean).join(" · ")}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.href = `tel:${farmer.phone}`;
          }}
          aria-label={t("messages.profileCall")}
          className="flex size-11 shrink-0 items-center justify-center"
          style={{ color: "var(--text-secondary)" }}
          data-testid="farmer-call"
        >
          <Phone size={18} strokeWidth={1.5} />
        </button>
      </div>

      {/* The conversation. The quiet dotted ground is the messenger convention; the bubbles are
          the app's own tones, so it belongs to this product rather than imitating another. */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain flex flex-col gap-1 px-3 py-3"
        aria-live="polite"
        data-testid="farmer-chat-scroll"
        style={{
          backgroundColor: "var(--tone-sunken)",
          backgroundImage: "radial-gradient(circle at 1px 1px, var(--divider) 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      >
        {entries.length === 0 && (
          <p className="text-12 text-center py-10" style={{ color: "var(--text-secondary)" }}>
            {t("messages.noMessages")}
          </p>
        )}

        {groups.map((group) => (
          <div key={group.key} className="flex flex-col gap-1.5">
            <span
              className="self-center my-2 px-3 py-1 rounded-full text-10 font-medium"
              style={{ background: "var(--tone-card)", color: "var(--text-secondary)" }}
            >
              {dayLabel(group.items[0].at, t)}
            </span>
            {group.items.map((entry) => {
              if (entry.kind === "message")
                return (
                  <MessageBubble
                    key={entry.message.id}
                    message={entry.message}
                    file={media[entry.message.id]}
                  />
                );
              if (entry.kind === "credit") {
                return (
                  <CreditCard
                    key={entry.request.id}
                    request={entry.request}
                    onOpen={() => setOpenAsk({ kind: "credit", id: entry.request.id })}
                  />
                );
              }
              return (
                <VisitCard
                  key={entry.visit.id}
                  visit={entry.visit}
                  onOpen={() => setOpenAsk({ kind: "visit", id: entry.visit.id })}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Composer. One field, one send. The caption says where the message will go. */}
      <div
        className="shrink-0 px-3 pt-2"
        style={{
          background: "var(--background)",
          borderTop: "1px solid var(--hairline)",
          paddingBottom: "calc(12px + var(--safe-bottom))",
        }}
      >
        {pendingAsk && (
          <button
            type="button"
            onClick={() =>
              setOpenAsk({
                kind: pendingAsk.kind,
                id: pendingAsk.kind === "credit" ? pendingAsk.credit.id : pendingAsk.visit.id,
              })
            }
            className="w-full mb-2 flex items-center gap-2 rounded-[14px] px-3 py-2 text-start"
            style={{ background: "var(--warning-bg)", border: "1px solid var(--warning-border)" }}
            data-testid="pending-ask"
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full"
              style={{ background: "var(--tone-card)", color: "var(--brand-dark)" }}
            >
              {pendingAsk.kind === "credit" ? (
                <Wallet size={15} strokeWidth={1.5} />
              ) : (
                <CalendarClock size={15} strokeWidth={1.5} />
              )}
            </span>
            <span className="min-w-0 flex-1 text-12 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {pendingAsk.kind === "credit"
                ? `${t("messages.creditRequest")} · ${formatCurrency(
                    pendingAsk.credit.offer_total ?? pendingAsk.credit.requested_amount ?? 0,
                  )}`
                : `${t("messages.visitRequest")} · ${pendingAsk.visit.purpose}`}
            </span>
            <span
              className="inline-flex shrink-0 items-center gap-0.5 text-11 font-semibold"
              style={{ color: "var(--brand-dark)" }}
            >
              {t("messages.answer")}
              <ChevronRight size={13} strokeWidth={1.5} />
            </span>
          </button>
        )}
        {error && (
          <p className="text-11 pb-1" style={{ color: "var(--error)" }}>
            {error}
          </p>
        )}
        {preview ? (
          <div className="flex items-center gap-2" data-testid="voice-preview">
            <button
              type="button"
              onClick={discardPreview}
              aria-label={t("messages.voiceCancel")}
              className="flex size-11 shrink-0 items-center justify-center rounded-full"
              style={{ background: "var(--tone-card)", color: "var(--text-secondary)" }}
              data-testid="voice-discard"
            >
              <X size={18} strokeWidth={2} />
            </button>
            <audio
              controls
              src={preview.url}
              aria-label={t("messages.voicePlay")}
              className="h-9 flex-1"
              data-testid="voice-preview-player"
            />
            <button
              type="button"
              onClick={() => void sendPreview()}
              disabled={mediaBusy}
              aria-label={t("messages.voiceSend")}
              className="flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
              style={{ background: "var(--brand)", color: "var(--brand-fg)" }}
              data-testid="voice-preview-send"
            >
              <Send size={18} strokeWidth={2} />
            </button>
          </div>
        ) : recording ? (
          <div className="flex items-center gap-2" data-testid="voice-recording">
            <button
              type="button"
              onClick={cancelRecording}
              aria-label={t("messages.voiceCancel")}
              className="flex size-11 shrink-0 items-center justify-center rounded-full"
              style={{ background: "var(--tone-card)", color: "var(--text-secondary)" }}
            >
              <X size={18} strokeWidth={2} />
            </button>
            <span
              className="flex h-11 flex-1 items-center gap-2 px-4 text-14"
              style={{ background: "var(--field-bg)", borderRadius: "var(--radius-field)", color: "var(--text-primary)" }}
            >
              <span className="size-2 rounded-full" style={{ background: "var(--error)" }} aria-hidden="true" />
              {t("messages.voiceRecording", { time: formatDuration(recordMs) })}
            </span>
            <button
              type="button"
              onClick={() => void toggleRecording()}
              disabled={mediaBusy}
              aria-label={t("messages.voiceSend")}
              className="flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
              style={{ background: "var(--brand)", color: "var(--brand-fg)" }}
              data-testid="voice-send"
            >
              <Send size={18} strokeWidth={2} />
            </button>
          </div>
        ) : (
        <div className="flex items-center gap-2">
          <input
            ref={imageInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => void pickImage(event)}
            data-testid="farmer-image-input"
          />
          <button
            type="button"
            onClick={() => imageInput.current?.click()}
            disabled={mediaBusy}
            aria-label={t("messages.photoSend")}
            className="flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
            style={{ background: "var(--tone-card)", color: "var(--text-secondary)" }}
            data-testid="farmer-image"
          >
            <ImagePlus size={18} strokeWidth={1.8} />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitMessage();
              }
            }}
            placeholder={t("messages.chatPlaceholder")}
            aria-label={t("messages.chatPlaceholder")}
            className="h-11 flex-1 px-4 text-14 outline-none"
            style={{
              background: "var(--field-bg)",
              border: "1px solid var(--field-border)",
              borderRadius: "var(--radius-field)",
              color: "var(--text-primary)",
            }}
            data-testid="farmer-message-input"
          />
          <button
            type="button"
            onClick={() => void submitMessage()}
            disabled={!draft.trim() || busy}
            aria-label={t("messages.send")}
            className="flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
            style={{ background: "var(--brand)", color: "var(--brand-fg)" }}
            data-testid="farmer-send"
          >
            <Send size={18} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => void toggleRecording()}
            disabled={mediaBusy}
            aria-label={t("messages.voiceRecord")}
            className="flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
            style={{ background: "var(--brand-tint)", color: "var(--brand-dark)" }}
            data-testid="farmer-mic"
          >
            <Mic size={18} strokeWidth={1.8} />
          </button>
        </div>
        )}
        <p className="text-10 mt-1.5 text-center" style={{ color: "var(--text-tertiary)" }}>
          {farmer.app_ready ? t("messages.sendHintApp") : t("messages.sendHintWhatsapp")}
        </p>
      </div>

      <Sheet
        open={Boolean(openAsk)}
        title={openVisit ? t("messages.visitRequest") : t("messages.creditRequest")}
        onClose={closeAsk}
      >
        {openCredit && (
          <div className="px-4 pb-6 flex flex-col gap-3">
            <div className="rounded-[var(--radius-card)] p-4 flex flex-col gap-1" style={{ background: "var(--tone-sunken)" }}>
              <span className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                {t("messages.farmerAsked")}
              </span>
              <span className="text-22 font-semibold tabular-nums">
                {formatCurrency(openCredit.requested_amount ?? 0)}
              </span>
              {openCredit.requested_note && <span className="text-12">{openCredit.requested_note}</span>}
              <span className="text-10" style={{ color: "var(--text-tertiary)" }}>
                {formatDateTime(openCredit.created_at)}
              </span>
              {openCredit.offer_total != null && (
                <span className="text-12 mt-1" style={{ color: "var(--brand-dark)" }}>
                  {t("messages.yourOffer")}: {formatCurrency(openCredit.offer_total)}
                </span>
              )}
            </div>

            {openCredit.status === "submitted" || openCredit.status === "offer_sent" ? (
              <>
                <Input
                  label={t("messages.total")}
                  value={offerTotal}
                  onChange={(e) => setOfferTotal(e.target.value)}
                  inputMode="numeric"
                />
                <Input
                  label={t("messages.dueOn")}
                  type="date"
                  value={offerDue}
                  onChange={(e) => setOfferDue(e.target.value)}
                />
                <Input
                  label={t("messages.note")}
                  value={offerNote}
                  onChange={(e) => setOfferNote(e.target.value)}
                />
                <Button fullWidth loading={busy} onClick={() => void submitOffer()} testId="request-send-offer">
                  {openCredit.offer_total == null ? t("messages.sendOffer") : t("messages.changeTerms")}
                </Button>
                <Button variant="ghost" fullWidth disabled={busy} onClick={() => void closeCredit()}>
                  {t("messages.closeRequest")}
                </Button>
              </>
            ) : (
              <p className="text-13" style={{ color: "var(--text-secondary)" }}>
                {t("messages.creditDone")}
              </p>
            )}
          </div>
        )}

        {openVisit && (
          <div className="px-4 pb-6 flex flex-col gap-3">
            <div className="rounded-[var(--radius-card)] p-4 flex flex-col gap-1" style={{ background: "var(--tone-sunken)" }}>
              <span className="text-14 font-semibold">{openVisit.purpose}</span>
              {openVisit.preferred_window && (
                <span className="inline-flex items-center gap-1.5 text-12" style={{ color: "var(--text-secondary)" }}>
                  <Clock size={13} strokeWidth={1.5} />
                  {openVisit.preferred_window}
                </span>
              )}
              <span className="text-10" style={{ color: "var(--text-tertiary)" }}>
                {formatDateTime(openVisit.created_at)}
              </span>
            </div>

            {visitNeedsAssignment(openVisit, editingVisit) ? (
              <>
                <button
                  type="button"
                  onClick={() => setOfficerPickerOpen(true)}
                  className="ds-field text-start px-4 h-12 text-13"
                  style={{
                    background: "var(--field-bg)",
                    border: "1px solid var(--field-border)",
                    borderRadius: "var(--radius-field)",
                    color: officerId ? "var(--text-primary)" : "var(--text-tertiary)",
                  }}
                  data-testid="request-pick-officer"
                >
                  {officers.find((o) => o.user_id === officerId)?.name ?? t("messages.pickOfficer")}
                </button>
                <Input
                  label={t("messages.visitTime")}
                  type="datetime-local"
                  value={visitAt}
                  onChange={(e) => setVisitAt(e.target.value)}
                />
                <Input label={t("messages.note")} value={visitNote} onChange={(e) => setVisitNote(e.target.value)} />
                <Button fullWidth loading={busy} onClick={() => void submitVisit()} testId="request-schedule-visit">
                  {t("messages.scheduleVisit")}
                </Button>
                {openVisit.status === "scheduled" && (
                  <Button variant="ghost" fullWidth disabled={busy} onClick={() => setEditingVisit(false)}>
                    {t("common.cancel")}
                  </Button>
                )}
              </>
            ) : (
              <>
                <div className="rounded-[var(--radius-card)] p-4 flex flex-col gap-2" style={{ background: "var(--tone-card)" }}>
                  <span className="inline-flex items-center gap-1.5 text-13">
                    <UserRound size={14} strokeWidth={1.5} />
                    {openVisit.assigned_name ?? t("messages.notAssigned")}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-13">
                    <CalendarClock size={14} strokeWidth={1.5} />
                    {openVisit.scheduled_for ? formatDateTime(openVisit.scheduled_for) : t("messages.notScheduled")}
                  </span>
                  {openVisit.owner_note && <span className="text-12">{openVisit.owner_note}</span>}
                </div>

                {openVisit.status === "scheduled" && (
                  <>
                    <Button fullWidth loading={busy} onClick={() => void moveVisit("in_progress")} testId="request-visit-onway">
                      {t("messages.markOnWay")}
                    </Button>
                    <Button variant="outline" fullWidth disabled={busy} onClick={() => setEditingVisit(true)}>
                      {t("messages.changeAssignment")}
                    </Button>
                  </>
                )}
                {openVisit.status === "in_progress" && (
                  <Button fullWidth loading={busy} onClick={() => void moveVisit("completed")} testId="request-visit-done">
                    {t("messages.markVisited")}
                  </Button>
                )}
                {(openVisit.status === "completed" || openVisit.status === "cancelled") && (
                  <p className="text-13" style={{ color: "var(--text-secondary)" }}>
                    {t("messages.visitDone")}
                  </p>
                )}
                {openVisit.status !== "completed" && openVisit.status !== "cancelled" && (
                  <Button variant="ghost" fullWidth disabled={busy} onClick={() => void moveVisit("cancelled")}>
                    {t("messages.cancelVisit")}
                  </Button>
                )}
              </>
            )}

            {openVisit.timeline.length > 0 && (
              <div className="flex flex-col gap-2 pt-2" style={{ borderTop: "1px solid var(--hairline)" }}>
                <span className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                  {t("messages.timeline")}
                </span>
                {openVisit.timeline.map((event, i) => (
                  <div key={`${event.created_at}-${i}`} className="flex items-start gap-2">
                    <span
                      className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "var(--muted)", color: "var(--text-secondary)" }}
                    >
                      <Check size={10} strokeWidth={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-12">
                        {t(`messages.actor_${event.actor}`)} · {t(`messages.statusKey_${event.status}`)}
                      </span>
                      {event.note && <span className="block text-11">{event.note}</span>}
                      <span className="block text-10" style={{ color: "var(--text-tertiary)" }}>
                        {formatDateTime(event.created_at)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-10 inline-flex items-center gap-1" style={{ color: "var(--text-tertiary)" }}>
              <MapPin size={11} strokeWidth={1.5} />
              {t("messages.officerGetsAddress")}
            </p>
          </div>
        )}

        <SelectSheet
          open={officerPickerOpen}
          title={t("messages.pickOfficer")}
          options={officers.map((o) => ({ value: o.user_id, label: o.name, sub: o.role }))}
          selected={officerId}
          searchable
          emptyLabel={t("messages.noOfficers")}
          onSelect={(value) => {
            setOfficerId(value);
            setOfficerPickerOpen(false);
          }}
          onClose={() => setOfficerPickerOpen(false)}
        />
      </Sheet>
    </div>
  );
}

/** A message bubble. Mine on the inline-end, his on the start; ticks only where they mean something. */
function MessageBubble({
  message,
  file,
}: {
  message: FarmerMessage;
  file?: { kind: "voice" | "image"; duration_ms: number | null };
}) {
  const t = useT();
  const mine = message.direction === "owner";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`} data-testid={`message-${message.id}`}>
      <div
        className="max-w-[82%] px-3 py-2"
        style={{
          background: mine ? "var(--brand-tint)" : "var(--tone-card)",
          color: "var(--text-primary)",
          borderRadius: 16,
          borderStartStartRadius: mine ? 16 : 4,
          borderStartEndRadius: mine ? 4 : 16,
        }}
      >
        {file?.kind === "voice" ? (
          <VoiceNote messageId={message.id} durationMs={file.duration_ms} mine={mine} />
        ) : file?.kind === "image" ? (
          <PhotoMessage messageId={message.id} mine={mine} />
        ) : null}
        {message.body.trim() ? (
          <p className="text-14 whitespace-pre-wrap break-words">{message.body}</p>
        ) : null}
        <span className="mt-1 flex items-center justify-end gap-1 text-10" style={{ color: "var(--text-tertiary)" }}>
          {mine && message.channel === "whatsapp" && <span>{t("messages.viaWhatsapp")}</span>}
          <span>{formatTime(message.created_at)}</span>
          {mine &&
            (message.delivered_to_app_at ? (
              <CheckCheck size={12} style={{ color: "var(--brand-dark)" }} />
            ) : (
              <Check size={12} />
            ))}
        </span>
      </div>
    </div>
  );
}

/** A credit ask as a bubble: what he asked, what the shop offered, and where it stands. */
function CreditCard({ request, onOpen }: { request: CreditRequest; onOpen: () => void }) {
  const t = useT();
  const amount = request.offer_total ?? request.requested_amount ?? 0;
  const open = request.status === "submitted";
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onOpen}
        className="w-full p-3 flex flex-col gap-2 text-start"
        style={{ background: "var(--tone-card)", borderRadius: 16, color: "var(--text-primary)" }}
        data-testid={`chat-credit-${request.id}`}
      >
        <span className="flex items-center gap-2">
          <span
            className="flex size-7 items-center justify-center rounded-full"
            style={{ background: "var(--brand-tint)", color: "var(--brand-dark)" }}
          >
            <Wallet size={14} strokeWidth={1.5} />
          </span>
          <span className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
            {t("messages.creditRequest")}
          </span>
          <StatusPill status={request.status} />
        </span>
        <span className="text-20 font-semibold tabular-nums">{formatCurrency(amount)}</span>
        {request.requested_note && <span className="text-12">{request.requested_note}</span>}
        {request.offer_total != null && request.requested_amount != null && (
          <span className="text-11" style={{ color: "var(--text-secondary)" }}>
            {t("messages.farmerAsked")} {formatCurrency(request.requested_amount)}
          </span>
        )}
        {open && (
          <span
            className="flex items-center justify-between pt-2 text-11 font-semibold"
            style={{ borderTop: "1px solid var(--hairline)", color: "var(--brand-dark)" }}
          >
            {t("messages.answer")}
            <ChevronRight size={14} style={{ color: "var(--text-tertiary)" }} />
          </span>
        )}
      </button>
    </div>
  );
}

/** A visit ask as a bubble: why he wants an officer, and who is going. */
function VisitCard({ visit, onOpen }: { visit: VisitRequest; onOpen: () => void }) {
  const t = useT();
  const open = visit.status === "requested";
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={onOpen}
        className="w-full p-3 flex flex-col gap-2 text-start"
        style={{ background: "var(--tone-card)", borderRadius: 16, color: "var(--text-primary)" }}
        data-testid={`chat-visit-${visit.id}`}
      >
        <span className="flex items-center gap-2">
          <span
            className="flex size-7 items-center justify-center rounded-full"
            style={{ background: "var(--brand-tint)", color: "var(--brand-dark)" }}
          >
            <CalendarClock size={14} strokeWidth={1.5} />
          </span>
          <span className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
            {t("messages.visitRequest")}
          </span>
          <StatusPill status={visit.status} />
        </span>
        <span className="text-15 font-semibold">{visit.purpose}</span>
        {visit.preferred_window && (
          <span className="inline-flex items-center gap-1.5 text-12" style={{ color: "var(--text-secondary)" }}>
            <Clock size={12} strokeWidth={1.5} />
            {visit.preferred_window}
          </span>
        )}
        {(visit.assigned_name || visit.scheduled_for) && (
          <span className="inline-flex items-center gap-1.5 text-11" style={{ color: "var(--text-secondary)" }}>
            <UserRound size={12} strokeWidth={1.5} />
            {[visit.assigned_name, visit.scheduled_for ? formatDateTime(visit.scheduled_for) : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        {open && (
          <span
            className="flex items-center justify-between pt-2 text-11 font-semibold"
            style={{ borderTop: "1px solid var(--hairline)", color: "var(--brand-dark)" }}
          >
            {t("messages.answer")}
            <ChevronRight size={14} style={{ color: "var(--text-tertiary)" }} />
          </span>
        )}
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const t = useT();
  const style: CSSProperties =
    status === "accepted" || status === "completed"
      ? { background: "var(--brand-light)", color: "var(--brand-dark)" }
      : status === "declined" || status === "cancelled"
        ? { background: "var(--muted)", color: "var(--text-secondary)" }
        : { background: "var(--warning-bg)", color: "var(--text-primary)" };
  return (
    <span className="ms-auto shrink-0 px-2 py-0.5 rounded-full text-10 font-medium whitespace-nowrap" style={style}>
      {t(`messages.status_${status}`)}
    </span>
  );
}

function visitNeedsAssignment(visit: VisitRequest, editing: boolean): boolean {
  return visit.status === "requested" || (visit.status === "scheduled" && editing);
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string, t: TranslateFn): string {
  const date = new Date(iso);
  const now = new Date();
  if (dayKey(iso) === dayKey(now.toISOString())) return t("messages.dateToday");
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t("messages.dateYesterday");
  return formatDate(iso);
}
