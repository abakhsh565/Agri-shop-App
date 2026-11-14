import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock3, ShieldCheck, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useT } from "@/lib/i18n";
import { coOwnerErrorCode } from "@/lib/experience";
import { isCurrentUserOwner } from "@/lib/tenantContext";

interface Approval {
  id: string;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  actionCode: string;
  payload: Record<string, unknown>;
  requesterName: string;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  decisionNote: string | null;
  executionResult: Record<string, unknown> | null;
}

const ACTIONS = [
  { code: "sale.void", label: "coOwner.actionVoidSale" },
  { code: "customer.credit_limit", label: "coOwner.actionCreditLimit" },
  { code: "customer.archive", label: "coOwner.actionArchiveCustomer" },
] as const;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function CoOwnerApprovalsPage() {
  const t = useT();
  const owner = isCurrentUserOwner();
  const [rows, setRows] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState<string>("sale.void");
  const [saleId, setSaleId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("get_co_owner_approvals", { p_status: null });
    if (rpcError) {
      setError(coOwnerErrorCode(rpcError));
      setRows([]);
    } else {
      setRows(Array.isArray(data) ? (data as Approval[]) : []);
      setError("");
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function request() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      let payload: Record<string, unknown> = {};
      let entityId = "";
      let entityType = "";
      if (action === "sale.void") {
        if (!saleId.trim()) throw new Error("SALE_ID_REQUIRED");
        payload = { saleId: saleId.trim(), reason: reason.trim() };
        entityId = saleId.trim();
        entityType = "sale";
      } else if (action === "customer.credit_limit") {
        if (!customerId.trim() || !creditLimit.trim()) throw new Error("CUSTOMER_AND_LIMIT_REQUIRED");
        payload = { customerId: customerId.trim(), creditLimit: Number(creditLimit) };
        entityId = customerId.trim();
        entityType = "customer";
      } else {
        if (!customerId.trim()) throw new Error("CUSTOMER_ID_REQUIRED");
        payload = { customerId: customerId.trim() };
        entityId = customerId.trim();
        entityType = "customer";
      }
      const { error: rpcError } = await supabase.rpc("request_co_owner_approval", {
        p_action_code: action,
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_payload: payload,
      });
      if (rpcError) throw new Error(rpcError.message);
      setSaleId("");
      setCustomerId("");
      setCreditLimit("");
      setReason("");
      await load();
    } catch (e) {
      setError(coOwnerErrorCode(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function decide(id: string, approve: boolean) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabase.rpc("decide_co_owner_approval", {
        p_request_id: id,
        p_approve: approve,
        p_note: approve ? null : t("coOwner.rejectNote"),
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

  const pending = rows.filter((row) => row.status === "pending");

  return (
    <div className="px-4 pt-3 pb-5" data-testid="co-owner-approvals">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-18 font-bold">{t("coOwner.approvalsTitle")}</h1>
          <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {owner ? t("coOwners.waiting") : t("coOwners.authorityHint")}
          </p>
        </div>
        <span className="size-9 rounded-full flex items-center justify-center" style={{ background: "var(--tone-sunken)" }}>
          <ShieldCheck size={16} style={{ color: "var(--brand-dark)" }} />
        </span>
      </div>

      {!owner && (
        <div
          className="rounded-[var(--radius-tile)] p-3.5 mt-3"
          style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
        >
          <p className="text-11 font-bold">{t("coOwner.requestApproval")}</p>
          <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {t("coOwners.authorityHint")}
          </p>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-full h-10 rounded-full px-3 mt-2 text-11 outline-none"
            style={{ background: "var(--field-bg)", border: "1px solid var(--border-control)", color: "var(--text-primary)" }}
          >
            {ACTIONS.map((item) => <option key={item.code} value={item.code}>{t(item.label)}</option>)}
          </select>
          {action === "sale.void" ? (
            <input
              value={saleId}
              onChange={(e) => setSaleId(e.target.value)}
              placeholder={t("coOwner.saleId")}
              dir="ltr"
              className="w-full h-10 rounded-full px-3 mt-1.5 text-11 outline-none"
              style={{ background: "var(--field-bg)", border: "1px solid var(--border-control)", color: "var(--text-primary)" }}
            />
          ) : (
            <>
              <input
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder={t("coOwner.customerId")}
                dir="ltr"
                className="w-full h-10 rounded-full px-3 mt-1.5 text-11 outline-none"
                style={{ background: "var(--field-bg)", border: "1px solid var(--border-control)", color: "var(--text-primary)" }}
              />
              {action === "customer.credit_limit" && (
                <input
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  placeholder={t("coOwner.newCreditLimit")}
                  inputMode="decimal"
                  dir="ltr"
                  className="w-full h-10 rounded-full px-3 mt-1.5 text-11 outline-none"
                  style={{ background: "var(--field-bg)", border: "1px solid var(--border-control)", color: "var(--text-primary)" }}
                />
              )}
            </>
          )}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("coOwner.reason")}
            className="w-full h-10 rounded-full px-3 mt-1.5 text-11 outline-none"
            style={{ background: "var(--field-bg)", border: "1px solid var(--border-control)", color: "var(--text-primary)" }}
          />
          <button
            type="button"
            onClick={request}
            disabled={busy}
            className="w-full h-10 rounded-full mt-2 text-11 font-bold disabled:opacity-50"
            style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
            data-testid="co-owner-request-approval"
          >
            {t("coOwner.requestApproval")}
          </button>
        </div>
      )}

      {error && <p className="text-11 mt-3" style={{ color: "var(--error)" }} data-testid="co-owner-approval-error">{error}</p>}

      {owner && pending.length > 0 && (
        <p className="text-10 font-bold mt-4" style={{ color: "var(--text-secondary)" }}>
          {t("coOwners.waiting")} · {pending.length}
        </p>
      )}

      <div className="flex flex-col gap-2 mt-2">
        {loading ? (
          <p className="text-12 py-8 text-center" style={{ color: "var(--text-secondary)" }}>{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="text-12 py-8 text-center" style={{ color: "var(--text-secondary)" }}>{t("coOwner.noApprovals")}</p>
        ) : rows.map((row) => (
          <div
            key={row.id}
            className="rounded-[var(--radius-tile)] p-3.5"
            style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
            data-testid={`co-owner-approval-${row.id}`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-12 font-bold truncate">{row.actionCode}</p>
              <span
                className="text-9 font-bold px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1"
                style={{
                  background: row.status === "pending" ? "color-mix(in srgb, #f59e0b 15%, transparent)" : "var(--tone-sunken)",
                  color: row.status === "pending" ? "#92400e" : "var(--text-secondary)",
                }}
              >
                {row.status === "pending" ? <Clock3 size={9} /> : <Check size={9} />}
                {t((`coOwner.${row.status === "approved" ? "executed" : row.status}`) as Parameters<typeof t>[0])}
              </span>
            </div>
            <p className="text-10 mt-1" style={{ color: "var(--text-secondary)" }}>
              {row.requesterName} · {formatDate(row.createdAt)}
            </p>
            <p className="text-10 mt-1 break-all" dir="ltr" style={{ color: "var(--text-tertiary)" }}>
              {JSON.stringify(row.payload)}
            </p>
            {row.decisionNote && <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>{row.decisionNote}</p>}
            {owner && row.status === "pending" && (
              <div className="flex gap-2 mt-2.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(row.id, true)}
                  className="flex-1 h-9 rounded-full text-10 font-bold disabled:opacity-50 flex items-center justify-center gap-1"
                  style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
                  data-testid={`approve-${row.id}`}
                >
                  <Check size={11} />
                  {t("coOwner.approve")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide(row.id, false)}
                  className="flex-1 h-9 rounded-full text-10 font-bold disabled:opacity-50 flex items-center justify-center gap-1"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                >
                  <X size={11} />
                  {t("coOwner.reject")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
