import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CalendarClock,
  Clock,
  Lock,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  Smartphone,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import LogoTile from "@/components/ui/LogoTile";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Sheet from "@/components/ui/Sheet";
import QrCode from "@/components/ui/QrCode";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/formatters";
import { whatsappShareUrl } from "@/lib/appInvite";
import { copyText } from "@/lib/clipboard";
import { useFarmerMessagesStore } from "@/stores/farmerMessagesStore";

/**
 * The person behind the conversation, shaped like a phone's contact page.
 *
 * WHY THIS ORDER. A contact page answers four questions in the order a person asks them: who is
 * this (portrait, name, number), how do I reach him (three round actions — call, WhatsApp, chat),
 * what is open between us (a sideways strip of asks, open work first), and the rest of the record
 * (village, farm pin, app connection, updates, last message). The old screen answered them in a
 * different order on every visit because the two buttons, the open asks and the details all looked
 * equally important.
 *
 * WHY THE ASKS ARE A STRIP, NOT A LIST. The reference board's media row is a strip of equal cards
 * you scan without reading — which is exactly what an ask is: an amount or a purpose, and whether
 * it is still waiting. It also keeps the promise the page already made: the profile is a shortcut
 * to the decision, not a second place to make it. Tapping a card opens the chat with that ask's
 * sheet already up (`?ask=`); the owner answers where the conversation lives.
 *
 * WHAT IT STILL DOES NOT CARRY. Lifetime totals and a full closed-request history. Both belong to
 * the chat that recorded them, and on this page they only push the actions below the fold.
 */
export default function FarmerProfilePage() {
  const t = useT();
  const base = useShellBase();
  const { farmerId = "" } = useParams();
  const navigate = useNavigate();
  /**
   * The screen this profile was opened from — the thread when it came from the conversation, the
   * list otherwise. Stated instead of retraced: `historyBack` stepped back into the thread and
   * from there into the list and back again, which is the loop the owner reported.
   */
  const backTo = useReturnTo(`${base}/messages`) ?? `${base}/messages`;

  const thread = useFarmerMessagesStore((s) => s.thread);
  const loading = useFarmerMessagesStore((s) => s.threadLoading);
  const loadThread = useFarmerMessagesStore((s) => s.loadThread);
  const issueFarmerToken = useFarmerMessagesStore((s) => s.issueFarmerToken);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  // Same reason as the shop code: a state read cannot stop a double tap in one task, and issuing
  // twice would rotate the farmer's only credential out from under the QR already on screen.
  const inviteCache = useRef("");

  useEffect(() => {
    if (!farmerId) return;
    // Opening a profile is not opening the conversation: his unread count stays until he is read.
    void loadThread(farmerId, { markRead: false }).catch(() => undefined);
  }, [farmerId, loadThread]);

  const current = thread && thread.farmer.id === farmerId ? thread : null;

  if (loading && !current) {
    return (
      <Shell title={t("messages.profile")} backTo={`${base}/messages`}>
        <div className="px-4 flex flex-col gap-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Shell>
    );
  }

  if (!current) {
    return (
      <Shell title={t("messages.profile")} backTo={`${base}/messages`}>
        <EmptyState
          icon={MessageSquare}
          title={t("messages.threadMissing")}
          action={{ label: t("common.back"), onClick: () => navigate(`${base}/messages`) }}
        />
      </Shell>
    );
  }

  const { farmer } = current;
  const lastMessage = current.messages[current.messages.length - 1] ?? null;
  const openCredit = current.requests.filter(
    (r) => r.status === "submitted" || r.status === "offer_sent",
  );
  const openVisits = current.visits.filter(
    (v) => v.status !== "completed" && v.status !== "cancelled",
  );
  const openCount = openCredit.length + openVisits.length;

  // Open work first, then the most recent closed records — the same rule the conversation list
  // uses, so a farmer's strip and his row in Messages cannot disagree about what needs a hand.
  const openCards: AskCard[] = [
    ...openCredit.map((request) => ({
      key: `credit-${request.id}`,
      kind: "credit" as const,
      id: request.id,
      at: request.created_at,
      label: t("messages.creditRequest"),
      text: formatCurrency(request.offer_total ?? request.requested_amount ?? 0),
      status: t(`messages.status_${request.status}`),
      open: true,
    })),
    ...openVisits.map((visit) => ({
      key: `visit-${visit.id}`,
      kind: "visit" as const,
      id: visit.id,
      at: visit.created_at,
      label: t("messages.visitRequest"),
      text: visit.purpose,
      status: t(`messages.status_${visit.status}`),
      open: true,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const closedCards: AskCard[] = [
    ...current.requests
      .filter((r) => r.status !== "submitted" && r.status !== "offer_sent")
      .map((request) => ({
        key: `credit-${request.id}`,
        kind: "credit" as const,
        id: request.id,
        at: request.created_at,
        label: t("messages.creditRequest"),
        text: formatCurrency(request.offer_total ?? request.requested_amount ?? 0),
        status: t(`messages.status_${request.status}`),
        open: false,
      })),
    ...current.visits
      .filter((v) => v.status === "completed" || v.status === "cancelled")
      .map((visit) => ({
        key: `visit-${visit.id}`,
        kind: "visit" as const,
        id: visit.id,
        at: visit.created_at,
        label: t("messages.visitRequest"),
        text: visit.purpose,
        status: t(`messages.status_${visit.status}`),
        open: false,
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const askCards = [...openCards, ...closedCards].slice(0, 6);

  function openAsk(kind: "credit" | "visit", id: string) {
    navigate(`${base}/messages/${farmerId}?ask=${kind}:${id}`);
  }

  /**
   * The owner's half of the second door: a credential for this one farmer, shown once.
   *
   * The token is minted when the sheet is opened, not when it is sent, because the plaintext
   * exists only in this response. Leaving it in state until the page is left means an accidental
   * close does not destroy the only copy the farmer could have scanned.
   */
  async function openInvite() {
    setInviteOpen(true);
    if (inviteCache.current) return;
    setInviteBusy(true);
    setInviteError("");
    try {
      const token = await issueFarmerToken(farmerId);
      inviteCache.current = token;
      setInviteToken(token);
      // `app_ready` is derived from a live token, so the badge has to be re-read.
      await loadThread(farmerId, { markRead: false });
    } catch {
      setInviteError(t("messages.issueFailed"));
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInvite() {
    if (!inviteToken) return;
    if (await copyText(inviteToken)) {
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2000);
    }
  }

  return (
          <Shell title={t("messages.profile")} backTo={backTo}>
      <div className="px-4 pb-3">
        <div className="ds-card flex flex-col items-center text-center gap-1 p-4">
          <LogoTile name={farmer.name} size={88} />
          <p className="text-22 font-bold mt-2" style={{ color: "var(--text-primary)" }}>
            {farmer.name}
          </p>
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>
            {[farmer.phone, farmer.village].filter(Boolean).join(" · ")}
          </p>
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-full text-11 font-medium mt-1"
            style={
              farmer.app_ready
                ? { background: "var(--brand-light)", color: "var(--brand-dark)" }
                : { background: "var(--muted)", color: "var(--text-secondary)" }
            }
          >
            {farmer.app_ready ? t("messages.appReady") : t("messages.whatsappOnly")}
          </span>
          <span className="text-11" style={{ color: "var(--text-tertiary)" }}>
            {t("messages.profileSince", { date: formatDate(farmer.since) })}
          </span>

          {/* The reference board's three round actions. The label under each one is the whole
              legend: no owner has to learn what an icon means. */}
          <div className="grid grid-cols-3 gap-1 w-full mt-3">
            <ProfileAction
              icon={Phone}
              label={t("messages.profileCall")}
              onClick={() => {
                window.location.href = `tel:${farmer.phone}`;
              }}
              testId="profile-call"
            />
            <ProfileAction
              icon={MessageCircle}
              label={t("messages.profileWhatsapp")}
              onClick={() => window.open(whatsappShareUrl(farmer.phone, ""), "_blank", "noopener")}
              testId="profile-whatsapp"
            />
            <ProfileAction
              icon={MessageSquare}
              label={t("messages.profileMessage")}
              onClick={() => navigate(`${base}/messages/${farmerId}`)}
              testId="profile-message"
            />
          </div>
        </div>
      </div>

      <div className="px-4 pb-3">
        <Button
          variant="outline"
          fullWidth
          onClick={() => void openInvite()}
          testId="profile-invite-app"
        >
          <span className="inline-flex items-center gap-2">
            <Smartphone size={16} strokeWidth={1.5} />
            {farmer.app_ready ? t("messages.newAppCode") : t("messages.inviteToApp")}
          </span>
        </Button>
      </div>

      <div className="pb-3">
        <div className="px-4 flex items-center justify-between mb-2">
          <p className="text-13 font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("messages.profileRequests")}
          </p>
          {openCount > 0 && (
            <span className="text-11" style={{ color: "var(--text-secondary)" }}>
              {openCount === 1
                ? t("messages.rowWaitingOne")
                : t("messages.rowWaitingMany", { count: openCount })}
            </span>
          )}
        </div>

        {askCards.length > 0 ? (
          <div
            className="flex gap-2 overflow-x-auto px-4 pb-1"
            style={{ scrollSnapType: "x mandatory" }}
            data-testid="profile-ask-strip"
          >
            {askCards.map((card) => (
              <button
                key={card.key}
                type="button"
                onClick={() => openAsk(card.kind, card.id)}
                className="ds-card p-3 flex flex-col gap-1.5 text-start shrink-0"
                style={{ width: 152, height: 112, scrollSnapAlign: "start" }}
                data-testid={`profile-ask-${card.key}`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: card.open ? "var(--brand-tint)" : "var(--muted)",
                      color: card.open ? "var(--brand-dark)" : "var(--text-secondary)",
                    }}
                  >
                    {card.kind === "credit" ? (
                      <Wallet size={13} strokeWidth={1.5} />
                    ) : (
                      <CalendarClock size={13} strokeWidth={1.5} />
                    )}
                  </span>
                  <span
                    className="text-10 font-semibold truncate"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {card.label}
                  </span>
                </span>
                <span
                  className="text-15 font-semibold line-clamp-2 break-words"
                  style={{ color: "var(--text-primary)" }}
                >
                  {card.text}
                </span>
                <span
                  className="text-10 mt-auto"
                  style={{ color: card.open ? "var(--brand-dark)" : "var(--text-tertiary)" }}
                >
                  {card.status}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="px-4">
            <div className="ds-card p-4">
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                {t("messages.requestsEmpty")}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pb-4">
        <ListCard section={t("messages.profileContact")}>
          {farmer.village && <ListRow icon={MapPin} title={farmer.village} meta={t("messages.village")} />}
          {farmer.latitude != null && farmer.longitude != null && (
            <ListRow
              icon={MapPin}
              onClick={() =>
                window.open(
                  `https://maps.google.com/?q=${farmer.latitude},${farmer.longitude}`,
                  "_blank",
                  "noopener",
                )
              }
              title={t("messages.profileFarm")}
              value={t("messages.profileOpenMap")}
            />
          )}
          <ListRow
            icon={Smartphone}
            title={t("messages.appReady")}
            value={farmer.app_ready ? t("messages.profileAppOn") : t("messages.profileAppOff")}
          />
          <ListRow
            icon={MessageCircle}
            title={t("messages.profileWhatsappOptIn")}
            value={farmer.whatsapp_opted_in ? t("common.yes") : t("common.no")}
          />
          <ListRow
            icon={Clock}
            title={t("messages.profileLastMessage")}
            value={lastMessage ? formatDateTime(lastMessage.created_at) : t("messages.profileNoActivity")}
          />
        </ListCard>
      </div>

      <p
        className="text-10 px-6 pb-8 text-center inline-flex items-center justify-center gap-1 w-full"
        style={{ color: "var(--text-tertiary)" }}
      >
        <Lock size={11} strokeWidth={1.5} />
        {t("messages.profilePrivacy")}
      </p>

      <Sheet
        open={inviteOpen}
        title={t("messages.appCodeTitle")}
        onClose={() => setInviteOpen(false)}
      >
        <div className="px-4 pb-6 flex flex-col items-center gap-3 text-center">
          {inviteBusy ? (
            <Skeleton className="h-[200px] w-[200px]" />
          ) : inviteError ? (
            <p className="text-13" style={{ color: "var(--error)" }}>
              {inviteError}
            </p>
          ) : inviteToken ? (
            <>
              <p className="text-13" style={{ color: "var(--text-secondary)" }}>
                {t("messages.inviteToAppHint", { name: farmer.name })}
              </p>
              <QrCode
                value={`agrishop://farmer?token=${inviteToken}`}
                size={200}
                label={t("messages.appCodeTitle")}
              />
              <p
                className="text-10 w-full break-all"
                style={{ color: "var(--text-tertiary)" }}
              >
                {inviteToken}
              </p>
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("messages.appCodeScan")}
              </p>
              <p className="text-11" style={{ color: "var(--text-primary)" }}>
                {t("messages.appCodeWarn")}
              </p>
              <div className="flex gap-2 w-full pt-1">
                <Button
                  variant="outline"
                  fullWidth
                  onClick={() => void copyInvite()}
                  testId="profile-copy-app-code"
                >
                  {codeCopied ? t("messages.copied") : t("messages.copyCode")}
                </Button>
                <Button
                  fullWidth
                  onClick={() =>
                    window.open(
                      whatsappShareUrl(
                        farmer.phone,
                        `${t("messages.appInviteMessage", { name: farmer.name })}\nagrishop://farmer?token=${inviteToken}`,
                      ),
                      "_blank",
                      "noopener",
                    )
                  }
                  testId="profile-send-app-code"
                >
                  {t("messages.shareOnWhatsapp")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </Sheet>
    </Shell>
  );
}

/** One round action with its name underneath, as the contact page on the reference board. */
function ProfileAction({
  icon: Icon,
  label,
  onClick,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 min-w-0"
      data-testid={testId}
    >
      <span
        className="flex size-12 items-center justify-center rounded-full"
        style={{ background: "var(--brand-tint)", color: "var(--brand-dark)" }}
      >
        <Icon size={19} strokeWidth={1.5} />
      </span>
      <span
        className="text-11 truncate max-w-full"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </span>
    </button>
  );
}

/** One card in the asks strip. `open` decides the emphasis, never the shape. */
interface AskCard {
  key: string;
  kind: "credit" | "visit";
  id: string;
  at: string;
  label: string;
  text: string;
  status: string;
  open: boolean;
}

function Shell({
  title,
  backTo,
  historyBack,
  children,
}: {
  title: string;
  backTo: string;
  historyBack?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={title} backTo={backTo} historyBack={historyBack} />
      {children}
    </div>
  );
}
