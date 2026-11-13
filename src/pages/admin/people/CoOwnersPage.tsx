import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, ChevronRight, Plus } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import Photo from "@/components/ui/Photo";
import NavHeader from "@/components/ui/NavHeader";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { isCurrentUserOwner } from "@/lib/tenantContext";
import { coOwnerEnabled } from "@/lib/experience";
import { useCoOwnersStore, type CoOwnerStatus } from "@/stores/coOwnersStore";

const STATUS_LABEL: Record<CoOwnerStatus, string> = {
  active: "coOwners.statusActive",
  invited: "coOwners.statusInvited",
  suspended: "coOwners.statusSuspended",
  revoked: "coOwners.statusRevoked",
};

const STATUS_TONE: Record<CoOwnerStatus, { bg: string; fg: string }> = {
  active: { bg: "color-mix(in srgb, var(--brand) 18%, transparent)", fg: "var(--brand-dark)" },
  invited: { bg: "var(--tone-sunken)", fg: "var(--text-secondary)" },
  suspended: { bg: "color-mix(in srgb, #f59e0b 16%, transparent)", fg: "#92400e" },
  revoked: { bg: "color-mix(in srgb, #ef4444 12%, transparent)", fg: "#b91c1c" },
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export default function CoOwnersPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const owner = isCurrentUserOwner();
  const enabled = coOwnerEnabled();
  const { grants, loading, ready, load } = useCoOwnersStore();
  const [tab, setTab] = useState<"active" | "archived">("active");

  useEffect(() => {
    if (owner && enabled) void load();
  }, [owner, enabled, load]);

  if (!owner) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("coOwners.title")} backTo={`${base}/settings/hub/people`} />
        <div className="px-4 pt-6" data-testid="co-owners-not-owner">
          <p className="text-16 font-bold">{t("coOwners.notOwner")}</p>
          <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
            {t("coOwners.notOwnerBody")}
          </p>
        </div>
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

  // What the Active tab lists is every grant that still stands — active, invited and suspended
  // alike — so the number on the tab is that list's length, not just the activated ones.
  const liveGrants = grants.filter((g) => g.status !== "revoked");
  const archivedGrants = grants.filter(
    (g) => g.status === "revoked" && g.revocationReason !== "ownership_transferred",
  );
  const archived = archivedGrants.length;
  const visible = tab === "archived" ? archivedGrants : liveGrants;

  return (
    <div
      className="flex flex-col w-full min-h-full pb-10"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="co-owners-page"
    >
      <StatusBar />
      <NavHeader title={t("coOwners.title")} backTo={`${base}/settings/hub/people`} />

      <div className="px-4 pt-1">
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>
          {t("coOwners.subtitle")}
        </p>
      </div>

      {/* One action and one list. This page used to open with three counter tiles and then offer
          four more doors (assign a branch, approvals, transfer ownership); every one of those is
          either a co-owner's own screen or a shortcut to somewhere else in the app, and together
          they buried the list of co-owners this page exists to show. */}
      <div className="px-4 pt-4">
        <button
          type="button"
          onClick={() => navigate(`${base}/settings/hub/people/co-owners/new`)}
          className="w-full h-12 rounded-full flex items-center justify-center gap-2 font-bold text-13 ds-pressable"
          style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
          data-testid="co-owners-add"
        >
          <Plus size={16} />
          {t("coOwners.add")}
        </button>
      </div>

      <div className="px-4 pt-4 flex flex-col gap-2.5">
        <div className="flex gap-1.5" data-testid="co-owners-tabs">
          <button
            type="button"
            onClick={() => setTab("active")}
            className="h-8 px-3 rounded-full text-11 font-semibold"
            style={{
              background: tab === "active" ? "var(--brand)" : "var(--tone-sunken)",
              color: tab === "active" ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {t("coOwners.tabActive")} · {liveGrants.length}
          </button>
          <button
            type="button"
            onClick={() => setTab("archived")}
            className="h-8 px-3 rounded-full text-11 font-semibold flex items-center gap-1.5"
            style={{
              background: tab === "archived" ? "var(--brand)" : "var(--tone-sunken)",
              color: tab === "archived" ? "#0a0a0a" : "var(--text-secondary)",
            }}
            data-testid="co-owners-archived-tab"
          >
            <Archive size={12} />
            {t("coOwners.tabArchived")} · {archived}
          </button>
        </div>

        {loading && !ready && (
          <p className="text-12 py-6 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("common.loading")}
          </p>
        )}

        {ready && visible.length === 0 && (
          <div
            className="rounded-[var(--radius-tile)] p-5"
            style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
            data-testid="co-owners-empty"
          >
            <p className="text-15 font-bold">
              {tab === "archived" ? t("coOwners.emptyArchived") : t("coOwners.empty")}
            </p>
            <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>
              {tab === "archived" ? t("coOwners.emptyArchivedHint") : t("coOwners.emptyHint")}
            </p>
          </div>
        )}

        {visible.map((grant) => {
          const tone = STATUS_TONE[grant.status] ?? STATUS_TONE.invited;
          return (
            <button
              key={grant.id}
              type="button"
              onClick={() => navigate(`${base}/settings/hub/people/co-owners/${grant.id}`)}
              className="w-full text-start rounded-[var(--radius-tile)] p-4 ds-pressable"
              style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
              data-testid={`co-owner-${grant.id}`}
            >
              <div className="flex items-center gap-3">
                <Photo
                  src={grant.photoUrl}
                  className="size-11 rounded-full object-cover shrink-0"
                  fallback={
                    <span
                      className="size-11 rounded-full flex items-center justify-center text-13 font-bold shrink-0"
                      style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                    >
                      {initials(grant.name || grant.phone)}
                    </span>
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-14 font-bold truncate">{grant.name}</span>
                    {/* The body, said on the person: this person is the business's co-owner, not
                        one of its employees. */}
                    <span
                      className="text-9 font-bold px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                    >
                      {t("people.coOwner")}
                    </span>
                    <span
                      className="text-10 font-bold px-2 py-0.5 rounded-full shrink-0"
                      style={{ background: tone.bg, color: tone.fg }}
                    >
                      {t(STATUS_LABEL[grant.status] as Parameters<typeof t>[0])}
                    </span>
                  </span>
                  <span className="block text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }} dir="ltr">
                    {grant.phone}
                  </span>
                  <span className="block text-11 mt-1 truncate" style={{ color: "var(--text-tertiary)" }}>
                    {grant.branches.length > 0
                      ? grant.branches.map((b) => b.name).join(" · ")
                      : t("coOwners.noBranches")}
                  </span>
                </span>
                <ChevronRight size={15} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
