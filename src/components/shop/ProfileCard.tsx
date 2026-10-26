import { useEffect, useState } from "react";
import { ArrowLeftRight, Check, Copy, MapPin } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import { useUIStore } from "@/stores/uiStore";
import { useT } from "@/lib/i18n";
import { myShopJoinCode } from "@/lib/auth";
import { branchKind } from "@/lib/branchKind";
import { copyText } from "@/lib/clipboard";

/**
 * The account, as one card: who this person is, the branch they are working in, and that
 * branch's shop ID.
 *
 * SHOP ID (owner's request, 2026-10-26). The code an employee types on the sign-in screen is a
 * fact about the BRANCH, and this card is already the thing that says which branch you are in —
 * so it belongs here, with a copy control, rather than only on the invitation card that appears
 * once. It is read from `my_shop_join_code()`, which answers for `current_shop_id()`: switching
 * branch re-reads it, so the number on screen is always the branch on screen.
 *
 * The trailing icon is the way to ANOTHER branch, not the way deeper into this one. A chevron
 * means "there is more behind this"; switching branch is a different statement, so it carries
 * its own glyph and opens the shop selector. The card's own text still opens the profile —
 * nothing was taken away, the arrow just stopped saying the wrong thing.
 *
 * WHAT THE CARD SAYS (owner's request, 2026-10-26): name, role, phone, the branch being worked
 * in and its kind (Main or Sub), and the shop ID. The role is a filled pill rather than a
 * whisper beside the name, because on this screen "owner" is the fact that decides what every
 * row below can do.
 */
export default function ProfileCard({ onOpen, onEdit, editTestId, testId }: {
  onOpen?: () => void; onEdit?: () => void; editTestId?: string; testId?: string;
}) {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const branchName = useShopStore((s) => s.activeBranchName);
  const activeShopId = useShopStore((s) => s.activeShopId);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const branches = useShopStore((s) => s.branches);
  const openSwitcher = useShopStore((s) => s.openSwitcher);
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const kind = branchKind(t, activeBranch?.isMain);
  const isOwner = user?.membershipRole === "owner";
  const { addToast } = useUIStore();
  const role = user?.membershipRole === "owner" ? t("settings.owner")
    : user?.membershipRole === "admin" ? t("emp.admin") : t("search.employee");
  const initials = user?.name?.split(" ").map((name) => name[0]).join("").slice(0, 2).toUpperCase() ?? "";

  // The branch's shop ID (its join code). `null` while it is being read — and while there is
  // no branch to read it for — so the line never shows a stale code for a shop just left.
  const [shopCode, setShopCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setShopCode(null);
    setCopied(false);
    void myShopJoinCode().then((code) => { if (alive) setShopCode(code); });
    return () => { alive = false; };
  }, [activeShopId]);

  async function copyShopCode() {
    if (!shopCode) return;
    // Never claim a copy that did not happen: the tick and the toast follow the outcome.
    if (!(await copyText(shopCode))) {
      addToast(t("copy.copyFailed"), "error");
      return;
    }
    setCopied(true);
    addToast(t("invite.copied"), "success");
    window.setTimeout(() => setCopied(false), 2000);
  }

  const lines = (
    <>
      <div className="flex items-center gap-2 min-w-0">
        <p className="text-16 font-semibold truncate">{user?.name}</p>
        {/* The owner tag, as a filled pill: it is the loudest fact about what this card can do. */}
        <span
          data-testid="profile-role"
          className="text-11 font-bold h-6 px-2 rounded-full flex items-center shrink-0"
          style={isOwner
            ? { background: "var(--brand)", color: "#0a0a0a" }
            : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
        >
          {role}
        </span>
      </div>
      <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{user?.phone}</p>
      <p className="flex items-center gap-1.5 mt-1 min-w-0">
        <MapPin size={12} className="shrink-0" style={{ color: "var(--text-tertiary)" }} aria-hidden="true" />
        <span className="text-12 font-semibold truncate" data-testid="profile-working-branch" style={{ color: "var(--text-secondary)" }}>
          {branchName ?? t("audit.noBranch")}
        </span>
        {kind && (
          <span
            data-testid="profile-branch-kind"
            className="text-10 font-bold h-5 px-1.5 rounded-full flex items-center shrink-0"
            style={activeBranch?.isMain
              ? { background: "var(--brand-light)", color: "var(--brand-dark)" }
              : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
          >
            {kind}
          </span>
        )}
      </p>
    </>
  );

  return (
    <div
      className="mx-4 mt-3.5 rounded-[var(--radius-card)] p-4 w-[calc(100%-2rem)]"
      style={{ background: "var(--tone-card)" }}
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center text-16 font-semibold shrink-0"
          style={{ background: "var(--brand)", color: "var(--text-primary)" }}>
          {user?.photoUrl ? <img src={user.photoUrl} alt="" className="w-full h-full object-cover" /> : initials}
        </div>

        {/* The name, the number and the branch are the way into the profile. The shop ID sits
            beneath them and carries its own copy button, so it is a sibling of this button
            rather than a button nested inside one. */}
        <div className="flex-1 min-w-0">
          {onOpen ? (
            <button type="button" onClick={onOpen} data-testid={testId} className="block w-full text-start ds-pressable">
              {lines}
            </button>
          ) : (
            <div data-testid={testId}>{lines}</div>
          )}

          {shopCode && (
            <div className="flex items-center gap-1.5 mt-1.5 min-w-0" data-testid="profile-shop-id">
              <span className="text-12 shrink-0" style={{ color: "var(--text-tertiary)" }}>{t("auth.shopId")}</span>
              <span className="text-12 font-semibold truncate" style={{ color: "var(--text-secondary)", letterSpacing: "0.02em" }}>
                {shopCode}
              </span>
              <button
                type="button"
                onClick={copyShopCode}
                aria-label={t("invite.copyShopId")}
                data-testid="profile-copy-shop-id"
                className="size-7 -me-1 flex items-center justify-center rounded-full shrink-0 active:opacity-60"
                style={{ color: copied ? "var(--brand-dark)" : "var(--text-secondary)" }}
              >
                {copied ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} />}
              </button>
            </div>
          )}
        </div>

        {onEdit ? (
          <button type="button" onClick={onEdit} data-testid={editTestId}
            className="h-9 px-3 rounded-full text-12 font-semibold shrink-0 ds-pressable"
            style={{ background: "var(--tone-sunken)" }}>{t("common.edit")}</button>
        ) : onOpen ? (
          /* Another branch, not more of this one. */
          <button
            type="button"
            onClick={() => openSwitcher()}
            aria-label={t("shop.switch")}
            data-testid="profile-switch-branch"
            className="size-9 rounded-full flex items-center justify-center shrink-0 ds-pressable"
            style={{ background: "var(--tone-sunken)" }}
          >
            <ArrowLeftRight size={15} style={{ color: "var(--text-primary)" }} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
