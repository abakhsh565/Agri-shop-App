import { useNavigate } from "react-router-dom";
import { Store } from "lucide-react";
import Button from "@/components/ui/Button";
import { useT } from "@/lib/i18n";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";

/**
 * "This account has no shop" — the state that used to look like a brand-new, empty shop.
 *
 * An account can sign in without being a member of any shop the database will accept: an
 * account whose access was revoked, an invited employee whose membership never became active,
 * or a profile that exists with nothing behind it. Every read and write requires an ACTIVE
 * membership, so the honest rendering is not a dashboard of zeroes with working-looking buttons
 * — that reads as "your shop is new" and every tap fails. It says what is true and what to do
 * next, in the role's own terms: an owner can provision a shop (the server allows it and the
 * switcher holds the only create form), an employee's access comes from their owner.
 *
 * It is rendered by the shells in place of the page, not as a route: a route would have to be
 * navigated to and could be navigated away from, and the answer would still be the same on
 * every screen behind it.
 */
export function useNoActiveShop(): boolean {
  const loading = useShopStore((s) => s.loading);
  const loaded = useShopStore((s) => s.loaded);
  const ownerId = useShopStore((s) => s.ownerId);
  const hasActive = useShopStore((s) => s.shops.some((s) => s.membershipStatus === "active"));
  const userId = useAuthStore((s) => s.user?.id);
  // The answer must belong to the account standing here. `loaded` outlives a sign-out, so
  // without this check the next person to sign in would see the previous account's answer for
  // as long as their own read took.
  return !!userId && loaded && ownerId === userId && !loading && !hasActive;
}

export default function ShopAccessNotice() {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const openSwitcher = useShopStore((s) => s.openSwitcher);

  // Who can create the shop is decided by the server (create_shop_for_me requires owner/admin);
  // the screen asks the same question so an employee is not offered a button that would be
  // refused.
  const canCreate =
    user?.membershipRole === "owner" ||
    user?.membershipRole === "admin" ||
    user?.role === "admin";

  return (
    <div className="flex flex-col flex-1 items-center justify-center gap-6 px-8 text-center" data-testid="no-shop-notice">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ background: "var(--muted)" }}
      >
        <Store size={26} style={{ color: "var(--text-secondary)" }} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xl font-bold text-foreground">{t("auth.noShopTitle")}</p>
        <p className="text-sm text-caption">{t("auth.noShopBody")}</p>
        <p className="text-sm text-caption">
          {t(canCreate ? "auth.noShopOwnerNext" : "auth.noShopEmployeeNext")}
        </p>
      </div>
      <div className="flex flex-col gap-3 w-full">
        {canCreate ? (
          <>
            {/* The name field and the create call live in one place (the shop switcher), so this
                opens that sheet rather than mounting a second copy of the form. */}
            <Button fullWidth size="lg" onClick={() => openSwitcher()}>
              {t("shop.createCta")}
            </Button>
            <Button
              fullWidth
              size="lg"
              variant="ghost"
              onClick={() => { logout(); navigate("/login"); }}
            >
              {t("settings.signOut")}
            </Button>
          </>
        ) : (
          <Button
            fullWidth
            size="lg"
            onClick={() => { logout(); navigate("/login"); }}
          >
            {t("settings.signOut")}
          </Button>
        )}
      </div>
    </div>
  );
}
