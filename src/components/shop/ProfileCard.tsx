import { ChevronRight } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import { useT } from "@/lib/i18n";
import { useDir } from "@/lib/dirContext";

export default function ProfileCard({ onOpen, onEdit, editTestId, testId }: {
  onOpen?: () => void; onEdit?: () => void; editTestId?: string; testId?: string;
}) {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const branchName = useShopStore((s) => s.activeBranchName);
  const { isRtl } = useDir();
  const role = user?.membershipRole === "owner" ? t("settings.owner")
    : user?.membershipRole === "admin" ? t("emp.admin") : t("search.employee");
  const initials = user?.name?.split(" ").map((name) => name[0]).join("").slice(0, 2).toUpperCase() ?? "";
  const body = <>
    <div className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center text-16 font-semibold shrink-0"
      style={{ background: "var(--brand)", color: "var(--text-primary)" }}>
      {user?.photoUrl ? <img src={user.photoUrl} alt="" className="w-full h-full object-cover" /> : initials}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 min-w-0"><p className="text-16 font-semibold truncate">{user?.name}</p>
        <span className="text-11 shrink-0" style={{ color: "var(--text-secondary)" }}>{role}</span></div>
      <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{user?.phone}</p>
      <p className="text-12 mt-1 truncate" data-testid="profile-working-branch" style={{ color: "var(--text-secondary)" }}>
        {branchName ? t("shop.switched", { shop: branchName }) : t("audit.noBranch")}
      </p>
    </div>
    {onEdit ? <button type="button" onClick={onEdit} data-testid={editTestId}
      className="h-9 px-3 rounded-full text-12 font-semibold shrink-0 ds-pressable" style={{ background: "var(--tone-sunken)" }}>{t("common.edit")}</button>
      : onOpen ? <ChevronRight size={16} className="shrink-0" style={{ transform: isRtl ? "rotate(180deg)" : undefined }} /> : null}
  </>;
  const className = "mx-4 mt-3.5 rounded-[var(--radius-card)] p-4 flex items-center gap-4 w-[calc(100%-2rem)] text-start";
  return onOpen ? <button type="button" onClick={onOpen} data-testid={testId} className={className} style={{ background: "var(--tone-card)" }}>{body}</button>
    : <div data-testid={testId} className={className} style={{ background: "var(--tone-card)" }}>{body}</div>;
}
