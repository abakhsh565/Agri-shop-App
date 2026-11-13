import { useEffect, useRef, useState } from "react";
import { Crown, ShieldCheck } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { supabase } from "@/lib/supabase";
import { useT } from "@/lib/i18n";
import { coOwnerErrorCode } from "@/lib/experience";
import { useShellBase } from "@/lib/useShellBase";

interface MyTransfer {
  id: string;
  status: "pending_recipient" | "pending_final";
  expiresAt: string;
  currentOwnerName: string;
  currentOwnerPhone: string;
  businessName: string;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function CoOwnerOwnershipTransferPage() {
  const t = useT();
  const base = useShellBase();
  const [transfer, setTransfer] = useState<MyTransfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("get_my_ownership_transfer");
      if (rpcError) throw new Error(rpcError.message);
      setTransfer((data as MyTransfer | null) ?? null);
    } catch (e) {
      setError(coOwnerErrorCode(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function respond(accept: boolean) {
    if (!transfer || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = accept
        ? await supabase.rpc("accept_ownership_transfer", { p_transfer_id: transfer.id })
        : await supabase.rpc("reject_ownership_transfer", {
            p_transfer_id: transfer.id,
            p_reason: "Declined by recipient",
          });
      if (rpcError) throw new Error(rpcError.message);
      if (accept) {
        setNotice(t("coOwner.transferAcceptedNotice"));
        await load();
      } else {
        setTransfer(null);
        setNotice(t("coOwner.transferRejectedNotice"));
      }
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

  return (
    <div
      className="flex flex-col w-full min-h-full pb-10"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="co-owner-ownership-transfer"
    >
      <StatusBar />
      <NavHeader title={t("coOwner.ownershipTransfer")} backTo={`${base}/more`} />

      <div className="px-4 pt-1 flex flex-col gap-3">
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>
          {t("coOwner.transferReview")}
        </p>

        {loading ? (
          <p className="text-12 py-8 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("common.loading")}
          </p>
        ) : !transfer ? (
          <div className="rounded-[var(--radius-tile)] p-4" style={card} data-testid="transfer-none">
            <p className="text-14 font-bold">{t("coOwner.transferNone")}</p>
            <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
              {t("coOwner.transferNoneHint")}
            </p>
            {notice && <p className="text-11 mt-3" style={{ color: "var(--brand-dark)" }}>{notice}</p>}
          </div>
        ) : (
          <>
            <div className="rounded-[var(--radius-tile)] p-4" style={card}>
              <div className="flex items-center gap-2">
                <Crown size={18} style={{ color: "var(--brand-dark)" }} />
                <p className="text-15 font-bold">{t("coOwner.transferTitle")}</p>
              </div>
              <div className="mt-3 flex flex-col gap-2 text-12">
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--text-secondary)" }}>{t("coOwner.transferBusiness")}</span>
                  <span className="font-semibold text-end">{transfer.businessName}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--text-secondary)" }}>{t("coOwner.transferCurrentOwner")}</span>
                  <span className="font-semibold text-end">{transfer.currentOwnerName}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span style={{ color: "var(--text-secondary)" }}>{t("coOwner.transferExpires")}</span>
                  <span className="font-semibold text-end">{formatDate(transfer.expiresAt)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-[var(--radius-tile)] p-4" style={card}>
              <p className="text-12 font-bold">{t("coOwner.transferConsequences")}</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-11" style={{ color: "var(--text-secondary)" }}>
                <li>• {t("coOwner.transferConsequenceOne")}</li>
                <li>• {t("coOwner.transferConsequenceTwo")}</li>
                <li>• {t("coOwner.transferConsequenceThree")}</li>
              </ul>
            </div>

            {transfer.status === "pending_final" ? (
              <div className="rounded-[var(--radius-tile)] p-4" style={card} data-testid="transfer-waiting-owner">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={17} style={{ color: "var(--brand-dark)" }} />
                  <p className="text-13 font-bold">{t("coOwner.transferWaitingOwner")}</p>
                </div>
                <p className="text-11 mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("coOwner.transferWaitingOwnerBody")}
                </p>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => respond(false)}
                  disabled={busy}
                  className="flex-1 h-12 rounded-full text-13 font-semibold disabled:opacity-50"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                  data-testid="transfer-reject"
                >
                  {t("coOwner.transferReject")}
                </button>
                <button
                  type="button"
                  onClick={() => respond(true)}
                  disabled={busy}
                  className="flex-[1.4] h-12 rounded-full text-13 font-bold disabled:opacity-50"
                  style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
                  data-testid="transfer-accept"
                >
                  {busy ? t("coOwners.saving") : t("coOwner.transferAccept")}
                </button>
              </div>
            )}
            {notice && <p className="text-11" style={{ color: "var(--brand-dark)" }}>{notice}</p>}
          </>
        )}

        {error && (
          <p className="text-12" style={{ color: "var(--error)" }} role="alert" data-testid="transfer-recipient-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
