import { useEffect, useMemo, useRef, useState } from "react";
import { Crown, ShieldAlert, ShieldCheck } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { supabase } from "@/lib/supabase";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { isCurrentUserOwner } from "@/lib/tenantContext";
import { coOwnerEnabled, coOwnerErrorCode } from "@/lib/experience";
import { useCoOwnersStore } from "@/stores/coOwnersStore";

type TransferStatus =
  | "pending_recipient"
  | "pending_final"
  | "completed"
  | "rejected"
  | "cancelled"
  | "expired"
  | "failed";

interface OwnerTransfer {
  id: string;
  status: TransferStatus;
  recipientName: string;
  recipientPhone: string;
  businessName: string;
  expiresAt: string;
  initiatedAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "").slice(-10);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function OwnerOwnershipTransferPage() {
  const t = useT();
  const base = useShellBase();
  const owner = isCurrentUserOwner();
  const enabled = coOwnerEnabled();
  const { grants, load: loadGrants } = useCoOwnersStore();

  const [transfer, setTransfer] = useState<OwnerTransfer | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const activeCoOwners = useMemo(
    () => grants.filter((grant) => grant.status === "active"),
    [grants],
  );

  const match = useMemo(() => {
    const wanted = normalizePhone(phone);
    if (wanted.length < 10) return null;
    return activeCoOwners.find((grant) => normalizePhone(grant.phone) === wanted) ?? null;
  }, [activeCoOwners, phone]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [{ data, error: rpcError }] = await Promise.all([
        supabase.rpc("get_owner_ownership_transfer"),
        loadGrants(),
      ]);
      if (rpcError) throw new Error(rpcError.message);
      setTransfer((data as OwnerTransfer | null) ?? null);
    } catch (e) {
      setError(coOwnerErrorCode(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (owner && enabled) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, enabled]);

  const pending =
    transfer?.status === "pending_recipient" || transfer?.status === "pending_final";
  const completed = transfer?.status === "completed";

  async function startTransfer() {
    if (busyRef.current) return;
    if (!name.trim() || !phone.trim()) {
      setError(t("coOwners.transferRecipientRequired"));
      return;
    }
    if (!match) {
      setError(t("coOwners.transferNoMatch"));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("initiate_ownership_transfer", {
        payload: {
          requestId: crypto.randomUUID(),
          recipientUserId: match.userId,
          phone: phone.trim(),
        },
      });
      if (rpcError) throw new Error(rpcError.message);
      await load();
    } catch (e) {
      setError(coOwnerErrorCode(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function cancelTransfer() {
    if (!transfer || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("cancel_ownership_transfer", {
        p_transfer_id: transfer.id,
        p_reason: "Cancelled by owner",
      });
      if (rpcError) throw new Error(rpcError.message);
      setConfirmCancel(false);
      await load();
    } catch (e) {
      setError(coOwnerErrorCode(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function confirmTransfer() {
    if (!transfer || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("confirm_ownership_transfer", {
        p_transfer_id: transfer.id,
      });
      if (rpcError) throw new Error(rpcError.message);
      // The RPC has just handed ownership to the recipient, so this session is no longer the
      // original owner. Re-reading `get_owner_ownership_transfer` would be refused precisely
      // because the transfer succeeded; keep the completed result in local state instead.
      setTransfer((current) =>
        current ? { ...current, status: "completed", completedAt: new Date().toISOString() } : current,
      );
    } catch (e) {
      setError(coOwnerErrorCode(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const card = {
    background: "var(--tone-card)",
    border: "1px solid var(--border-control)",
  } as const;
  const field = {
    background: "var(--field-bg)",
    border: "1px solid var(--border-control)",
    color: "var(--text-primary)",
  } as const;

  if (!owner) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("coOwners.transferTitle")} backTo={`${base}/settings/hub/people/co-owners`} />
        <p className="px-4 pt-6 text-13" style={{ color: "var(--text-secondary)" }}>
          {t("coOwners.notOwner")}
        </p>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("coOwners.title")} backTo={`${base}/settings/hub/people`} />
        <p className="px-4 pt-6 text-13" style={{ color: "var(--text-secondary)" }}>
          {t("coOwners.featureOff")}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full min-h-full pb-10"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="owner-ownership-transfer"
    >
      <StatusBar />
      <NavHeader
        title={t("coOwners.transferTitle")}
        backTo={`${base}/settings/hub/people/co-owners`}
      />

      <div className="px-4 pt-1 flex flex-col gap-3">
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>
          {t("coOwners.transferSubtitle")}
        </p>

        {loading ? (
          <p className="text-12 py-8 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("common.loading")}
          </p>
        ) : completed && transfer ? (
          <div className="rounded-[var(--radius-tile)] p-4" style={card} data-testid="transfer-completed">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} style={{ color: "var(--brand-dark)" }} />
              <p className="text-15 font-bold">{t("coOwners.transferCompleteTitle")}</p>
            </div>
            <p className="text-12 mt-2" style={{ color: "var(--text-secondary)" }}>
              {t("coOwners.transferCompleteBody").replace("{name}", transfer.recipientName)}
            </p>
            <p className="text-11 mt-2" style={{ color: "var(--text-tertiary)" }}>
              {t("coOwners.transferCompletedAt")}: {formatDate(transfer.completedAt)}
            </p>
          </div>
        ) : pending && transfer ? (
          <div className="rounded-[var(--radius-tile)] p-4" style={card} data-testid="transfer-pending">
            <div className="flex items-center gap-2">
              <Crown size={18} style={{ color: "var(--brand-dark)" }} />
              <p className="text-15 font-bold">
                {transfer.status === "pending_final"
                  ? t("coOwners.transferAcceptedTitle")
                  : t("coOwners.transferWaitingTitle")}
              </p>
            </div>
            <p className="text-12 mt-2" style={{ color: "var(--text-secondary)" }}>
              {transfer.status === "pending_final"
                ? t("coOwners.transferAcceptedBody")
                : t("coOwners.transferWaitingBody").replace("{name}", transfer.recipientName)}
            </p>
            <div className="mt-3 rounded-[var(--radius-input)] p-3" style={{ background: "var(--tone-sunken)" }}>
              <p className="text-13 font-bold">{transfer.recipientName}</p>
              <p className="text-11 mt-0.5" dir="ltr" style={{ color: "var(--text-secondary)" }}>
                {transfer.recipientPhone}
              </p>
              <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
                {t("coOwners.transferExpires")}: {formatDate(transfer.expiresAt)}
              </p>
            </div>

            {transfer.status === "pending_final" && (
              <button
                type="button"
                onClick={confirmTransfer}
                disabled={busy}
                className="mt-3 w-full h-11 rounded-full text-13 font-bold disabled:opacity-50"
                style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
                data-testid="transfer-confirm"
              >
                {busy ? t("coOwners.saving") : t("coOwners.transferConfirm")}
              </button>
            )}

            {!confirmCancel ? (
              <button
                type="button"
                onClick={() => setConfirmCancel(true)}
                className="mt-2 w-full h-10 rounded-full text-12 font-semibold"
                style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
              >
                {t("coOwners.transferCancel")}
              </button>
            ) : (
              <div className="mt-2 flex flex-col gap-1.5">
                <p className="text-11" style={{ color: "#b91c1c" }}>{t("coOwners.transferCancelConfirm")}</p>
                <button
                  type="button"
                  onClick={cancelTransfer}
                  disabled={busy}
                  className="h-10 rounded-full text-12 font-bold disabled:opacity-50"
                  style={{ background: "#b91c1c", color: "white" }}
                >
                  {t("coOwners.transferCancel")}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {transfer && (
              <div className="rounded-[var(--radius-tile)] p-3" style={card}>
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                  {t("coOwners.transferLastStatus")}: {transfer.status}
                </p>
              </div>
            )}

            <div className="rounded-[var(--radius-tile)] p-4 flex flex-col gap-3" style={card}>
              <p className="text-13 font-bold">{t("coOwners.transferRecipient")}</p>
              <label className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                {t("coOwners.name")}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5 w-full h-12 rounded-[var(--radius-input)] px-3 text-14 outline-none"
                  style={field}
                  dir="auto"
                  data-testid="transfer-recipient-name"
                />
              </label>
              <label className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                {t("coOwners.phone")}
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1.5 w-full h-12 rounded-[var(--radius-input)] px-3 text-14 outline-none"
                  style={field}
                  inputMode="tel"
                  dir="ltr"
                  placeholder="03xx xxxxxxx"
                  data-testid="transfer-recipient-phone"
                />
              </label>
              <p className="text-11" style={{ color: "var(--text-tertiary)" }}>
                {t("coOwners.transferRecipientHint")}
              </p>

              {match ? (
                <div className="rounded-[var(--radius-input)] p-3" style={{ background: "var(--tone-sunken)" }}>
                  <p className="text-12 font-bold">{t("coOwners.transferMatch")}</p>
                  <p className="text-13 mt-1">{match.name}</p>
                  <p className="text-11 mt-0.5" dir="ltr" style={{ color: "var(--text-secondary)" }}>{match.phone}</p>
                </div>
              ) : phone.trim().length >= 10 ? (
                <p className="text-11" style={{ color: "#b91c1c" }} data-testid="transfer-no-match">
                  {t("coOwners.transferNoMatch")}
                </p>
              ) : null}

              {activeCoOwners.length === 0 && (
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                  {t("coOwners.transferNoEligible")}
                </p>
              )}
            </div>

            <div className="rounded-[var(--radius-tile)] p-4" style={card}>
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} style={{ color: "#92400e" }} />
                <p className="text-12 font-bold">{t("coOwners.transferReviewTitle")}</p>
              </div>
              <ul className="mt-2 flex flex-col gap-1.5 text-11" style={{ color: "var(--text-secondary)" }}>
                <li>• {t("coOwners.transferConsequenceOwner")}</li>
                <li>• {t("coOwners.transferConsequenceHistory")}</li>
                <li>• {t("coOwners.transferConsequenceAcceptance")}</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={startTransfer}
              disabled={busy || !match}
              className="w-full h-12 rounded-full text-13 font-bold disabled:opacity-50"
              style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
              data-testid="transfer-start"
            >
              {busy ? t("coOwners.saving") : t("coOwners.transferSend")}
            </button>
          </>
        )}

        {error && (
          <p className="text-12" style={{ color: "var(--error)" }} role="alert" data-testid="transfer-error">
            {error === "REAUTH_REQUIRED" ? t("coOwners.transferReauth") : error}
          </p>
        )}
      </div>
    </div>
  );
}
