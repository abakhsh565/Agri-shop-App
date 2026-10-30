import { ArrowLeftRight } from "lucide-react";
import BranchKindChip from "@/components/ui/BranchKindChip";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import { useT } from "@/lib/i18n";
import { branchKind } from "@/lib/branchKind";

/**
 * The account, as one card: who this person is and the branch they are working in.
 *
 * THE WIREFRAME (owner's instruction, 2026-10-30). Four things, one line each: the photo, the
 * name with the role beside it, the branch being worked in with its Main/Sub tag, and the control
 * that moves to another branch. The phone number and the shop ID that used to sit under the name
 * are gone — the number is already a fact on the profile screen, and the shop code is written on
 * the invitation card where somebody actually copies it. What is left is what this card is for:
 * "whose account is this, and which shop am I standing in".
 *
 * ONE HEADER SCALE (owner's correction, 2026-10-30). The name and the branch line now sit at the
 * sizes the business record's header uses — 16 semibold for the name, 14 semibold for the line
 * under it — and the branch's kind is drawn by the same `BranchKindChip` the branch screens use,
 * so "Main" is one tag in one place rather than a pill this card invented for itself. The map pin
 * is gone with it: the branch's name is not a location, and the chip already says what it is.
 *
 * The trailing control is the way to ANOTHER branch, not the way deeper into this one: it keeps
 * its own glyph and opens the shop selector, while the card itself opens the profile.
 *
 * THE WHOLE CARD IS THE TARGET (owner's correction, 2026-10-30). Tapping the photo, the empty space
 * or the text all open the profile: a card that only answers on its words makes the picture and the
 * padding look like decoration, and on a phone the thumb lands on whichever part is nearest. The
 * card is one transparent button laid under its own content, with the trailing control raised above
 * it, so the small action stays separate without shrinking the big one.
 */
export default function ProfileCard({ onOpen, onEdit, editTestId, testId }: {
  onOpen?: () => void; onEdit?: () => void; editTestId?: string; testId?: string;
}) {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const branchName = useShopStore((s) => s.activeBranchName);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const branches = useShopStore((s) => s.branches);
  const openSwitcher = useShopStore((s) => s.openSwitcher);
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const kind = branchKind(t, activeBranch?.isMain);
  const isOwner = user?.membershipRole === "owner";
  const role = user?.membershipRole === "owner" ? t("settings.owner")
    : user?.membershipRole === "admin" ? t("emp.admin") : t("search.employee");
  const initials = user?.name?.split(" ").map((name) => name[0]).join("").slice(0, 2).toUpperCase() ?? "";

  const lines = (
    <>
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-16 font-semibold truncate">{user?.name}</span>
        {/* The role, as a filled pill: on this screen it is the fact that decides what every row
            below can do. */}
        <span
          data-testid="profile-role"
          className="text-11 font-bold h-6 px-2 rounded-full flex items-center shrink-0"
          style={isOwner
            ? { background: "var(--brand)", color: "var(--ink-fg)" }
            : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
        >
          {role}
        </span>
      </span>
      <span className="flex items-center gap-1.5 mt-0.5 min-w-0">
        <span
          className="text-14 font-semibold truncate"
          data-testid="profile-working-branch"
          style={{ color: "var(--text-secondary)" }}
        >
          {branchName ?? t("audit.noBranch")}
        </span>
        {kind && (
          <span data-testid="profile-branch-kind" className="shrink-0 flex items-center">
            <BranchKindChip isMain={Boolean(activeBranch?.isMain)} label={kind} />
          </span>
        )}
      </span>
    </>
  );

  return (
    <div
      className="relative mx-4 mt-3.5 rounded-[var(--radius-card)] w-[calc(100%-2rem)]"
      style={{ background: "var(--tone-card)" }}
    >
      {/* The whole surface, laid under the content: photo, words and padding are one target. */}
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          data-testid={testId}
          aria-label={`${t("settings.profileDetail")} — ${user?.name ?? ""}`}
          className="absolute inset-0 rounded-[var(--radius-card)] ds-pressable"
        />
      )}

      <div className="relative flex items-center gap-3.5 p-3.5 pointer-events-none">
        <div
          className="size-[52px] rounded-full overflow-hidden flex items-center justify-center text-17 font-bold shrink-0"
          style={{ background: "var(--brand)", color: "var(--ink-fg)" }}
        >
          {user?.photoUrl ? <img src={user.photoUrl} alt="" className="w-full h-full object-cover" /> : initials}
        </div>

        <div className="flex-1 min-w-0" data-testid={onOpen ? undefined : testId}>{lines}</div>

        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            data-testid={editTestId}
            className="pointer-events-auto h-9 px-3.5 rounded-full text-12 font-semibold shrink-0 ds-pressable"
            style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
          >
            {t("common.edit")}
          </button>
        ) : onOpen ? (
          <button
            type="button"
            onClick={() => openSwitcher()}
            aria-label={t("shop.switch")}
            data-testid="profile-switch-branch"
            className="pointer-events-auto size-10 rounded-full flex items-center justify-center shrink-0 ds-pressable"
            style={{ background: "var(--tone-sunken)" }}
          >
            <ArrowLeftRight size={15} style={{ color: "var(--text-primary)" }} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
