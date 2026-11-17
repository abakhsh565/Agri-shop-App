import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Photo from "@/components/ui/Photo";
import EmptyState from "@/components/ui/EmptyState";
import { useCartStore } from "@/stores/cartStore";
import { useShellBase } from "@/lib/useShellBase";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/formatters";
import { UserRound, ShoppingBasket, X, Plus, ChevronRight } from "lucide-react";

/**
 * The sales that are open right now.
 *
 * The cart icon opens this instead of a single basket when more than one sale is in progress: a
 * counter serving Ahmad (five items) and Faraz (seven items) and a walk-in does not have one cart,
 * and guessing which one the icon meant was the bug the owner described (2026-11-17). Each card
 * answers the three questions a shopkeeper needs to tell them apart — who, how much, how long ago.
 */
export default function CartDraftsPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const drafts = useCartStore((s) => s.drafts);
  const switchDraft = useCartStore((s) => s.switchDraft);
  const removeDraft = useCartStore((s) => s.removeDraft);

  const open = (id: string) => {
    switchDraft(id);
    navigate(`${base}/sale/cart`);
  };

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={t("sale.openSales")} />

      {drafts.length === 0 ? (
        <div className="flex-1 flex flex-col justify-center">
          <EmptyState
            icon={ShoppingBasket}
            title={t("sale.noOpenSales")}
            subtitle={t("sale.noOpenSalesHint")}
            action={{
              label: t("dashboard.newSale"),
              onClick: () => navigate(`${base}/sale`),
            }}
          />
        </div>
      ) : (
        <>
          <div className="px-4 pt-1 pb-2">
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {t("sale.openSalesHint")}
            </p>
          </div>

          <div className="px-4 flex flex-col gap-2.5">
            {drafts.map((draft) => {
              const total = Math.max(
                0,
                draft.items.reduce((sum, i) => sum + i.lineTotal, 0) - draft.discount,
              );
              const units = draft.items.reduce((sum, i) => sum + i.qty, 0);
              return (
                <div
                  key={draft.id}
                  className="rounded-[var(--radius-card)] p-4 flex items-center gap-3"
                  style={{ background: "var(--tone-card)", border: "1px solid var(--divider)" }}
                  data-testid={`draft-${draft.id}`}
                >
                  <button
                    type="button"
                    onClick={() => open(draft.id)}
                    className="flex-1 min-w-0 flex items-center gap-3 text-start ds-pressable"
                  >
                    <div
                      className="size-11 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-sm font-bold"
                      style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
                    >
                      {draft.customer ? (
                        <Photo
                          src={draft.customer.imageUrl}
                          alt={draft.customer.name}
                          className="w-full h-full object-cover"
                          fallback={draft.customer.name.charAt(0).toUpperCase()}
                        />
                      ) : (
                        <UserRound size={18} style={{ color: "var(--text-secondary)" }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
                        {draft.customer?.name ?? t("sale.walkIn")}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {t("sale.draftSummary", {
                          items: String(draft.items.length),
                          units: String(units),
                        })}
                        {" · "}
                        {new Date(draft.startedAt).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <p className="text-sm font-bold tabular-nums shrink-0" style={{ color: "var(--text-primary)" }}>
                      {formatCurrency(total)}
                    </p>
                    <ChevronRight size={18} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDraft(draft.id)}
                    aria-label={t("sale.discardSale")}
                    className="size-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                  >
                    <X size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="flex-1 min-h-6" />
      <div className="p-4 pb-6">
        <button
          type="button"
          onClick={() => navigate(`${base}/sale`)}
          className="w-full h-12 rounded-full flex items-center justify-center gap-2 text-sm font-bold ds-pressable"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          <Plus size={17} />
          {t("dashboard.newSale")}
        </button>
      </div>
    </div>
  );
}
