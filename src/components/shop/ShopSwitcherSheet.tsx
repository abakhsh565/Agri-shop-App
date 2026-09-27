import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import { useT } from "@/lib/i18n";
import { useShopStore, type ShopSummary } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";

/**
 * The shop selector — the whole user-facing surface of "which shop am I working in".
 *
 * It is deliberately one sheet with two steps rather than a section of the app: the shops the
 * account belongs to, with the current one marked, and one field to add another. Nothing here
 * is a setting: the list is not editable, a shop cannot be renamed or deleted, because the
 * screen's only job is to answer "where am I" and to move.
 *
 * The list is read from the server every time the sheet opens, and which shop is active is
 * decided by the database too; this component never filters the list and never guesses the
 * current row. Either of those would eventually disagree with what every query returns, and a
 * selector that names one shop while the app reads another is worse than no selector.
 *
 * Rows are the app's list grammar (`ListCard` + `ListRow`), so a shop is picked the same way a
 * customer or a supplier is, and both languages and both directions come along for free.
 */
export default function ShopSwitcherSheet() {
  const t = useT();
  const { addToast } = useUIStore();

  const open = useShopStore((s) => s.switcherOpen);
  const close = useShopStore((s) => s.closeSwitcher);
  const shops = useShopStore((s) => s.shops);
  const activeShopId = useShopStore((s) => s.activeShopId);
  const loading = useShopStore((s) => s.loading);
  const loadError = useShopStore((s) => s.error);
  const switching = useShopStore((s) => s.switching);
  const creating = useShopStore((s) => s.creating);
  const load = useShopStore((s) => s.load);
  const switchTo = useShopStore((s) => s.switchTo);
  const create = useShopStore((s) => s.create);

  // Creating a shop is an owner/admin action at the database layer. The screen asks the same
  // question so an employee is not handed a button the server would refuse.
  const canCreate = useAuthStore((s) =>
    s.user?.membershipRole === "owner" ||
    s.user?.membershipRole === "admin" ||
    // An account with no membership yet still carries its shop-role: the server lets an admin
    // provision their first shop, and the switcher must not hide the only way to do it.
    s.user?.role === "admin" ||
    s.user?.role === "co_admin",
  );

  const [name, setName] = useState("");
  // Which row is mid-switch, so the spinner sits on the shop being opened rather than on the
  // one being left.
  const [pendingShopId, setPendingShopId] = useState<string | null>(null);

  // Fresh from the server on every open: a shop may have been created or joined on another
  // device since this one last looked.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // A half-typed name belongs to one attempt, not to the sheet.
  useEffect(() => {
    if (!open) {
      setName("");
      setPendingShopId(null);
    }
  }, [open]);

  const busy = switching || creating;

  async function handleSwitch(shop: ShopSummary) {
    if (busy || shop.id === activeShopId) return;
    setPendingShopId(shop.id);
    const result = await switchTo(shop.id);
    setPendingShopId(null);
    if (!result.ok) {
      addToast(
        t(result.code === "pending_sync" ? "shop.pendingSync" : "shop.switchFailed"),
        result.code === "pending_sync" ? "warning" : "error",
      );
      return;
    }
    // Closed rather than left open on the list: the screen behind it is already showing the
    // shop just opened, and the confirmation names it.
    close();
    addToast(t("shop.switched", { shop: useShopStore.getState().activeShopName ?? "" }), "success");
  }

  async function handleCreate() {
    if (busy) return;
    const result = await create(name);
    if (!result.ok) {
      const message =
        result.code === "denied" ? t("shop.ownerOnly")
          : result.code === "name_required" ? t("shop.nameRequired")
            : t("shop.createFailed");
      addToast(message, "error");
      return;
    }
    close();
    addToast(t("shop.created"), "success");
  }

  return (
    <Sheet open={open} title={t("shop.myShops")} onClose={close}>
      <div className="px-4 pt-1">
        {loading && shops.length === 0 && (
          <div className="flex items-center justify-center py-8" data-testid="shop-list-loading">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-secondary)" }} />
          </div>
        )}

        {/* Nothing to show, and the read FAILED: offer the read again rather than an empty
            picker. */}
        {!loading && shops.length === 0 && loadError === "load_failed" && (
          <div className="flex flex-col items-center gap-3 py-8" data-testid="shop-list-failed">
            <p className="ds-meta">{t("shop.loadFailed")}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t("common.tryAgain")}
            </Button>
          </div>
        )}

        {/* Nothing to show, and the server answered: this account is in no shop. Reporting a
            failed load here was false — nothing failed — and it sent an owner hunting for a
            connection problem instead of creating the shop sitting right below this line. */}
        {!loading && shops.length === 0 && loadError !== "load_failed" && (
          <div className="flex flex-col items-center gap-3 py-8" data-testid="shop-list-empty">
            <p className="ds-meta text-center">{t(canCreate ? "shop.noneOwned" : "shop.noneMember")}</p>
          </div>
        )}

        {shops.length > 0 && (
          <ListCard>
            {shops.map((shop) => {
              const isCurrent = shop.id === activeShopId;
              // A membership the database does not consider active cannot be worked in:
              // offering it as a destination would switch the header and nothing else. It is
              // shown, marked, and not selectable — the row names the shop it belongs to.
              const usable = shop.membershipStatus === "active";
              return (
                <ListRow
                  key={shop.id}
                  title={shop.name}
                  meta={usable ? undefined : t("shop.notActive")}
                  testId={`shop-option-${shop.id}`}
                  emphasis
                  selected={isCurrent}
                  disabled={busy || !usable}
                  onClick={isCurrent || !usable ? undefined : () => void handleSwitch(shop)}
                  trailing={
                    pendingShopId === shop.id ? (
                      <Loader2
                        size={18}
                        className="animate-spin shrink-0"
                        style={{ color: "var(--brand-dark)" }}
                      />
                    ) : isCurrent ? (
                      <span className="flex items-center gap-1.5 shrink-0">
                        <span className="text-11 font-bold" style={{ color: "var(--brand-dark)" }}>
                          {t("shop.current")}
                        </span>
                        <Check size={18} style={{ color: "var(--brand-dark)" }} />
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </ListCard>
        )}

        {canCreate && (
          <div className="pt-4" data-testid="shop-create">
            <p className="ds-section-label px-4 mb-2">{t("shop.create")}</p>
            <div>
              <div className="ds-field">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
                  placeholder={t("shop.namePlaceholder")}
                  maxLength={60}
                  disabled={busy}
                  data-testid="shop-name-input"
                  aria-label={t("shop.nameLabel")}
                  className="h-full flex-1 bg-transparent outline-none ds-body text-start"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>
              <Button
                fullWidth
                className="mt-3"
                disabled={name.trim().length === 0}
                loading={creating}
                onClick={() => void handleCreate()}
              >
                {creating ? t("shop.creating") : t("shop.createCta")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
