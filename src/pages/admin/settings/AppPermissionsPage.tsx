import { useCallback, useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Camera, Fingerprint, FolderOpen, MapPin, Mic } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import {
  capabilityReport,
  isNative,
  requestCapability,
  type CapabilityId,
  type CapabilityState,
  type CapabilityStatus,
} from "@/lib/appPermissions";

const ICONS: Record<CapabilityId, LucideIcon> = {
  camera: Camera,
  location: MapPin,
  microphone: Mic,
  biometrics: Fingerprint,
  files: FolderOpen,
};

const TITLE_KEYS = {
  camera: "appPerm.camera",
  location: "appPerm.location",
  microphone: "appPerm.microphone",
  biometrics: "appPerm.biometrics",
  files: "appPerm.files",
} as const;

const PURPOSE_KEYS = {
  camera: "appPerm.cameraWhy",
  location: "appPerm.locationWhy",
  microphone: "appPerm.microphoneWhy",
  biometrics: "appPerm.biometricsWhy",
  files: "appPerm.filesWhy",
} as const;

const STATE_KEYS = {
  granted: "appPerm.granted",
  denied: "appPerm.denied",
  prompt: "appPerm.prompt",
  unsupported: "appPerm.unsupported",
  "not-needed": "appPerm.notNeeded",
} as const;

function toneFor(state: CapabilityState): { bg: string; color: string } {
  if (state === "granted") return { bg: "rgba(132,204,22,0.16)", color: "var(--brand-dark)" };
  if (state === "denied") return { bg: "var(--error-bg)", color: "var(--error)" };
  if (state === "prompt") return { bg: "var(--warning-bg)", color: "var(--warning)" };
  return { bg: "var(--surface-2)", color: "var(--text-secondary)" };
}

/**
 * Everything HisabPay can ask the phone for, and the answer Android currently holds.
 *
 * The screen exists because the answers were invisible: a dialog dismissed with "don't ask again"
 * turned the scanner or the map into a button that did nothing, with no way to find out why. Each
 * row states what the app uses the capability for, what the OS has decided, and — only when asking
 * can still work — a button that asks. When the OS will not ask again, the row says where to fix it
 * instead of offering a button that cannot.
 *
 * Coming back from the system settings refreshes the list, so a permission granted outside the app
 * shows here as granted without a restart.
 */
export default function AppPermissionsPage() {
  const t = useT();
  const base = useShellBase();

  const [rows, setRows] = useState<CapabilityStatus[] | null>(null);
  const [busy, setBusy] = useState<CapabilityId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    capabilityReport()
      .then(setRows)
      .catch((e: unknown) => {
        setRows([]);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The user leaves for Android settings and comes back: ask the OS again, do not ask the user.
  useEffect(() => {
    let remove: (() => void) | undefined;
    App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) refresh();
    }).then((listener) => {
      remove = () => {
        void listener.remove();
      };
    });
    return () => remove?.();
  }, [refresh]);

  async function ask(id: CapabilityId) {
    setBusy(id);
    setError(null);
    try {
      await requestCapability(id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function trailing(row: CapabilityStatus) {
    const tone = toneFor(row.state);
    const pill = (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-10 font-bold whitespace-nowrap"
        style={{ background: tone.bg, color: tone.color }}
      >
        {t(STATE_KEYS[row.state])}
      </span>
    );

    // Granted, or nothing to grant: no button, because there is nothing left to ask.
    if (row.state === "granted" || row.state === "not-needed" || row.state === "unsupported") return pill;

    // The OS will not show its dialog again; only Android's own settings can change this.
    if (row.blocked) {
      return (
        <div className="flex flex-col items-end gap-1">
          {pill}
          <span className="text-9" style={{ color: "var(--text-tertiary)" }}>{t("appPerm.blockedShort")}</span>
        </div>
      );
    }

    return (
      <button
        onClick={() => ask(row.id)}
        disabled={busy === row.id}
        className="h-8 px-3 rounded-full text-11 font-semibold whitespace-nowrap ds-pressable"
        style={{ border: "1px solid var(--border)", color: "var(--brand-dark)", background: "transparent" }}
      >
        {busy === row.id ? t("appPerm.asking") : t("appPerm.allow")}
      </button>
    );
  }

  return (
    <div className="flex flex-col bg-background w-full min-h-full">
      <StatusBar />
      <NavHeader title={t("appPerm.title")} backTo={`${base}/settings/security`} />

      <div className="px-4 pt-1 pb-8">
        <p className="text-13" style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {t("appPerm.subtitle")}
        </p>

        <div className="mt-4">
          <ListCard>
            {(rows ?? []).map((row) => {
              const Icon = ICONS[row.id];
              return (
                <ListRow
                  key={row.id}
                  icon={Icon}
                  title={t(TITLE_KEYS[row.id])}
                  meta={t(PURPOSE_KEYS[row.id])}
                  trailing={trailing(row)}
                  testId={`app-permission-${row.id}`}
                />
              );
            })}
          </ListCard>
        </div>

        {rows === null && (
          <p className="mt-4 text-12" style={{ color: "var(--text-tertiary)" }}>{t("appPerm.checking")}</p>
        )}

        {rows?.some((r) => r.blocked) && (
          <div
            className="mt-4 rounded-[var(--radius-card)] p-3.5"
            style={{ background: "var(--surface-2)" }}
          >
            <p className="text-12 font-semibold" style={{ color: "var(--text-primary)" }}>{t("appPerm.blockedTitle")}</p>
            <p className="text-11 mt-1" style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {t("appPerm.blockedBody")}
            </p>
          </div>
        )}

        {!isNative() && (
          <p className="mt-4 text-11" style={{ color: "var(--text-tertiary)", lineHeight: 1.5 }}>
            {t("appPerm.webHint")}
          </p>
        )}

        {error && (
          <p className="mt-3 text-12" style={{ color: "var(--error)" }} role="alert">{error}</p>
        )}
      </div>
    </div>
  );
}
