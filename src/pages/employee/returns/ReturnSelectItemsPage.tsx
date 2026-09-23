import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import QuantityCounter from "@/components/ui/QuantityCounter";
import { useSalesStore } from "@/stores/salesStore";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";

export default function ReturnSelectItemsPage() {
  const { saleId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const sales = useSalesStore((s) => s.sales);
  const sale = sales.find((s) => s.id === saleId);

  // Track already-returned quantities per sale_item_id
  const [returnedQtyMap, setReturnedQtyMap] = useState<Record<string, number>>({});
  const [loadingReturned, setLoadingReturned] = useState(true);

  // Fetch already-returned quantities for this sale
  useEffect(() => {
    if (!sale) return;
    async function fetchReturned() {
      try {
        const saleItemIds = sale!.items.map((i) => i.id);
        if (saleItemIds.length === 0) { setLoadingReturned(false); return; }

        const { data: returnItems } = await supabase
          .from("return_items")
          .select("sale_item_id, qty, returns!inner(sale_id)")
          .in("sale_item_id", saleItemIds);

        if (returnItems) {
          const map: Record<string, number> = {};
          for (const ri of returnItems) {
            const rid = ri as any;
            if (rid.returns?.sale_id === saleId) {
              map[rid.sale_item_id] = (map[rid.sale_item_id] ?? 0) + rid.qty;
            }
          }
          setReturnedQtyMap(map);
        }
      } catch {
        // If returns table doesn't exist yet, treat all as 0 returned
      } finally {
        setLoadingReturned(false);
      }
    }
    fetchReturned();
  }, [sale, saleId]);

  const [returnQtys, setReturnQtys] = useState<Record<string, number>>(
    () => Object.fromEntries(sale?.items.map((i) => [i.id, 0]) ?? [])
  );

  if (!sale) return null;

  function setQty(itemId: string, qty: number) {
    setReturnQtys((prev) => ({ ...prev, [itemId]: qty }));
  }

  function getMaxQty(itemId: string): number {
    const item = sale!.items.find((i) => i.id === itemId);
    if (!item) return 0;
    const alreadyReturned = returnedQtyMap[itemId] ?? 0;
    return Math.max(0, item.qty - alreadyReturned);
  }

  function getAlreadyReturned(itemId: string): number {
    return returnedQtyMap[itemId] ?? 0;
  }

  const returnTotal = sale.items.reduce((sum, item) => {
    return sum + (returnQtys[item.id] || 0) * item.unitPrice;
  }, 0);

  const hasItems = Object.values(returnQtys).some((q) => q > 0);

  function handleNext() {
    const returnItems = sale!.items
      .filter((item) => (returnQtys[item.id] || 0) > 0)
      .map((item) => ({
        saleItemId: item.id,
        productName: item.productName,
        variantName: item.variantName,
        qtyToReturn: returnQtys[item.id],
        unitPrice: item.unitPrice,
        refundAmount: returnQtys[item.id] * item.unitPrice,
      }));
    navigate(`/employee/sales/${saleId}/return/confirm`, {
      state: { returnItems, returnTotal, sale },
    });
  }

  if (loadingReturned) {
    return (
      <div className="flex flex-col w-full min-h-full items-center justify-center" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("returns.title")} />
        <div className="w-full pt-4">
          <SkeletonList rows={4} tile={false} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader title={t("returns.title")} />

        {/* Sale info */}
        <div className="mx-4 mt-3 rounded-[var(--radius-card)] p-4" style={{ background: "var(--tone-card)" }}>
          <div className="flex justify-between">
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {t("inline.sale_x")} {sale.saleNumber}
              </p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{sale.customerName}</p>
            </div>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{formatDate(sale.createdAt)}</p>
          </div>
        </div>

        <div className="px-4 pt-4">
          <p className="text-13 font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("inline.select_items_quantity_to_return_x")}
          </p>

          <ListCard>
            {sale.items.map((item) => {
              const maxQty = getMaxQty(item.id);
              const alreadyReturned = getAlreadyReturned(item.id);
              const isFullyReturned = maxQty === 0;

              return (
                <ListRow key={item.id}>
                  <div className="flex justify-between mb-1">
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                      {item.productName} {item.variantName}
                    </p>
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                      {formatCurrency(item.lineTotal)}
                    </p>
                  </div>
                  <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
                    {item.qty} {t("inline.purchased_x")} · {formatCurrency(item.unitPrice)} {t("inline.each_x")}
                  </p>

                  {isFullyReturned ? (
                    <div className="flex items-center gap-2 mt-2">
                      <span
                        className="text-xs font-semibold px-3 py-1 rounded-full"
                        style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
                      >
                        {t("returns.fullyReturned")}
                      </span>
                    </div>
                  ) : (
                    <>
                      {alreadyReturned > 0 && (
                        <p className="text-11 mb-2" style={{ color: "#d97706" }}>
                          {alreadyReturned} previously returned · {maxQty} remaining
                        </p>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          {t("inline.qty_to_return")}
                        </span>
                        <QuantityCounter
                          qty={returnQtys[item.id] || 0}
                          onChange={(q) => setQty(item.id, q)}
                          max={maxQty}
                          deleteOnOne={false}
                          size="sm"
                        />
                      </div>
                    </>
                  )}
                </ListRow>
              );
            })}
          </ListCard>
        </div>

        {/* Return total */}
        <div
          className="mx-4 mt-4 rounded-[var(--radius-card)] p-4 flex justify-between"
          style={{ border: "1px solid var(--divider)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            {t("inline.return_total_x")}
          </span>
          <span className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            {formatCurrency(returnTotal)}
          </span>
        </div>
      </div>

      <div className="p-4">
        <Button fullWidth size="lg" onClick={handleNext} disabled={!hasItems}>
          Next
        </Button>
      </div>
    </div>
  );
}
