import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Clipboard, KeyRound, ShieldCheck } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import { getMyIdentity, rotateMyRecoveryKey } from "@/lib/auth";
import type { AgriIdentity } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { experienceOf } from "@/lib/experience";
import { useT } from "@/lib/i18n";

/**
 * The permanent identity, shown in one place.
 *
 * The Agri ID can be copied and shared; it identifies a person but cannot open their account.
 * The recovery key CAN, so it is shown only at the moment it is generated and its value is
 * never sent back by the server again. It is a separate credential from the PIN.
 */
export default function IdentityPage() {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const base = experienceOf(user) === "employee" ? "/employee" : "/admin";
  const [identity, setIdentity] = useState<AgriIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"id" | "key" | null>(null);
  const [error, setError] = useState("");
  const generatingRef = useRef(false);

  useEffect(() => {
    if (!user) { navigate("/login", { replace: true }); return; }
    let alive = true;
    void getMyIdentity().then((row) => {
      if (!alive) return;
      setIdentity(row);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [user, navigate]);

  async function copy(value: string, which: "id" | "key") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard can be blocked. The value stays selectable on screen.
    }
  }

  async function generate() {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setError("");
    setNewKey("");
    setSaved(false);
    try {
      const result = await rotateMyRecoveryKey();
      if (result.status === "error") { setError(t("identity.rotateFailed")); return; }
      setNewKey(result.key);
      setIdentity((current) => current
        ? { ...current, hasRecoveryKey: true, recoveryKeyCreatedAt: new Date().toISOString() }
        : current);
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  async function finish() {
    if (!saved) return;
    setNewKey("");
    setSaved(false);
    navigate(`${base}/settings`, { replace: true });
  }

  return (
    <div className="flex flex-col w-full min-h-[100dvh]" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
      <StatusBar />
      <NavHeader title={t("identity.title")} backTo={`${base}/settings`} />
      <div className="flex flex-col flex-1 gap-4 p-4 overflow-y-auto">
        <div className="flex items-start gap-3">
          <span className="size-11 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
                style={{ background: "var(--brand-light)" }}>
            <ShieldCheck size={20} style={{ color: "var(--brand-dark)" }} />
          </span>
          <div>
            <p className="text-18 font-bold">{t("identity.subtitle")}</p>
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("identity.agriIdHint")}</p>
          </div>
        </div>

        {loading && <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("identity.loading")}</p>}
        {!loading && !identity && (
          <div className="flex flex-col gap-2">
            <p className="text-13" style={{ color: "var(--error)" }}>{t("identity.loadFailed")}</p>
            <Button onClick={() => window.location.reload()}>{t("common.tryAgain")}</Button>
          </div>
        )}

        {identity && (
          <>
            <div className="rounded-[var(--radius-card)] p-4 flex flex-col gap-2"
                 style={{ background: "var(--surface-1)", border: "1px solid var(--divider)" }}>
              <p className="text-11 font-semibold tracking-wide" style={{ color: "var(--text-secondary)" }}>
                {t("identity.agriId")}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-22 font-bold tabular-nums flex-1" data-testid="identity-agri-id">
                  {identity.agriId}
                </p>
                <button
                  type="button"
                  onClick={() => void copy(identity.agriId, "id")}
                  className="size-9 rounded-full flex items-center justify-center"
                  style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                  aria-label={t("identity.copy")}
                >
                  {copied === "id" ? <Check size={16} /> : <Clipboard size={16} />}
                </button>
              </div>
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                {t("identity.agriIdValueHint")}
              </p>
              <p className="text-12 pt-1" style={{ color: "var(--text-secondary)" }}>
                {t("identity.phone")}: {identity.phone}
              </p>
            </div>

            <div className="rounded-[var(--radius-card)] p-4 flex flex-col gap-3"
                 style={{ background: "var(--surface-1)", border: "1px solid var(--divider)" }}>
              <div className="flex items-center gap-2">
                <KeyRound size={17} style={{ color: "var(--brand-dark)" }} />
                <p className="text-15 font-bold">{t("identity.recovery")}</p>
              </div>
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>
                {identity.hasRecoveryKey ? t("identity.recoveryReady") : t("identity.recoveryMissing")}
              </p>
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("identity.recoveryBody")}</p>

              {!newKey && (
                <Button onClick={generate} loading={generating} variant={identity.hasRecoveryKey ? "outline" : "primary"}>
                  {identity.hasRecoveryKey ? t("identity.replace") : t("identity.generate")}
                </Button>
              )}

              {error && <p className="text-12" style={{ color: "var(--error)" }}>{error}</p>}

              {newKey && (
                <div className="flex flex-col gap-3">
                  <div className="rounded-[var(--radius-tile)] p-3"
                       style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}>
                    <p className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                      {t("identity.newKeyTitle")}
                    </p>
                    <p className="text-17 font-bold tracking-wider mt-1 break-all tabular-nums" data-testid="identity-recovery-key">
                      {newKey}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => void copy(newKey, "key")} className="flex-1">
                      {copied === "key" ? t("identity.copied") : t("identity.copyKey")}
                    </Button>
                  </div>
                  <p className="text-12" style={{ color: "var(--error)" }}>{t("identity.keyWarning")}</p>
                  <label className="flex items-start gap-2 text-12" style={{ color: "var(--text-secondary)" }}>
                    <input
                      type="checkbox"
                      checked={saved}
                      onChange={(e) => setSaved(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>{t("identity.saved")}</span>
                  </label>
                  <Button onClick={finish} disabled={!saved}>{t("identity.finish")}</Button>
                </div>
              )}
            </div>

            <p className="text-12" style={{ color: "var(--text-tertiary)" }}>{t("identity.cantRecover")}</p>
          </>
        )}
      </div>
    </div>
  );
}
