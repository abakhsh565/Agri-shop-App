import { ChevronRight } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import OwnerSuiteSections from "@/components/shop/OwnerSuiteSections";
import { useT } from "@/lib/i18n";
import { useDir } from "@/lib/dirContext";
import { useShopStore } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";

/**
 * The owner suite menu, as a plain screen at `/admin/more`.
 *
 * It no longer has a tab. The bar's fifth slot is Messages, and the rows themselves ship on the
 * account screen — so this page is kept for what only it answers: the shop this account is
 * working in, and every suite row in one place for anyone who follows a link or a bookmark
 * straight to it. The rows are rendered by `shop/OwnerSuiteSections`, the same component the
 * account screen renders, so there is one list and not two.
 */
export default function MoreMenuPage() {
  const t = useT();
  // A chevron points along the reading direction, so in RTL the "onward" direction is
  // left. Mirrored by rotation, which is the pattern this app already uses elsewhere
  // (GroupDetailPage) rather than a second convention.
  const { isRtl } = useDir();
  const activeShopName = useShopStore((s) => s.activeShopName);
  const openSwitcher = useShopStore((s) => s.openSwitcher);
  const membershipRole = useAuthStore((s) => s.user?.membershipRole);

  // What this account is in THIS shop — the same three words Settings uses. It used to be a
  // constant ("Owner access") printed for everyone who opened this screen.
  const roleLabel =
    membershipRole === "owner" ? t("settings.owner")
    : membershipRole === "admin" ? t("emp.admin")
    : t("search.employee");

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />

      {/* Top card — the shop this account is working in.
          The overline used to be the constant "Main Shop", a name that belonged to no shop on
          this device; the loudest line now carries the real name, read from the server. The
          whole card opens the shop selector, because "which shop am I in" and "switch shop"
          are one question — and it is the first thing on the screen furthest from accidentally
          leaving it.

          The three lines keep the hierarchy the card had (12 overline / 18 title / 12 below), so
          the shop name is the loudest thing on the screen while the group titles below it
          still read as headings. */}
      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={() => openSwitcher()}
          data-testid="shop-card"
          className="w-full text-start rounded-[var(--radius-card)] p-4 ds-pressable"
          style={{ background: "var(--brand)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-12 font-bold" style={{ color: "rgba(0,0,0,0.6)" }}>
              {t("shop.yourShop")}
            </p>
            <p
              className="flex items-center gap-1 text-11 font-bold shrink-0"
              style={{ color: "rgba(0,0,0,0.6)" }}
            >
              {t("shop.switch")}
              <ChevronRight
                size={13}
                style={{ transform: isRtl ? "rotate(180deg)" : undefined }}
              />
            </p>
          </div>
          <p className="text-18 font-bold mt-0.5 truncate" style={{ color: "#0a0a0a" }}>
            {activeShopName ?? t("shop.yourShop")}
          </p>
          <p className="text-12 mt-1 truncate" style={{ color: "rgba(0,0,0,0.55)" }}>
            {roleLabel}
          </p>
        </button>
      </div>

      {/* Branches used to be a block at the top of this screen. They live on the account screen
          now, with the profile card that answers the same "which shop am I in" question, and they
          are one implementation (`shop/BranchesSection`) rather than a copy that could drift. */}

      <OwnerSuiteSections />

      <div className="pb-4" />
    </div>
  );
}
