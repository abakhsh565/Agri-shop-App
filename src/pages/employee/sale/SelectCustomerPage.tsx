import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Photo from "@/components/ui/Photo";
import SearchBar from "@/components/ui/SearchBar";
import { useCartStore } from "@/stores/cartStore";
import { useCustomersStore } from "@/stores/customersStore";
import { formatCurrency } from "@/lib/formatters";
import { useShellBase } from "@/lib/useShellBase";
import { useT } from "@/lib/i18n";
import { withReturn } from "@/lib/dependencyGraph";
import type { Customer } from "@/types";
import { Plus, UserRound } from "lucide-react"
import { SkeletonList } from "@/components/ui/Skeleton";

export default function SelectCustomerPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { setCustomer, startSale } = useCartStore();
  const customers = useCustomersStore((s) => s.customers);
  const ready = useCustomersStore((s) => s.ready);
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();

  const filtered = customers.filter(
    (c) =>
      !c.isArchived &&
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search))
  );

  function continueWith(customer: Customer | null) {
    // Changing the customer of the sale already on screen is an edit, not a new sale; arriving
    // fresh from "New sale" starts a draft of its own, so an earlier customer's goods stay
    // exactly where they were (owner, 2026-11-17).
    const state = window.history.state?.usr;
    if (state?.fromCart) {
      setCustomer(customer);
      navigate(`${base}/sale/cart`, { replace: true });
    } else {
      startSale(customer);
      navigate(`${base}/sale/products`);
    }
  }

  const select = (c: Customer) => continueWith(c);

  // Coming back from creating a customer mid-sale: the new record is already chosen,
  // so the flow continues to the products step instead of asking for the same
  // decision the user just made. Guarded by an effect-free read + a ref so a re-render
  // cannot select twice.
  const preselectedId = searchParams.get("customerId");
  const pickedRef = useRef(false);
  useEffect(() => {
    if (!preselectedId || pickedRef.current) return;
    const c = customers.find((x) => x.id === preselectedId);
    if (!c) return;
    pickedRef.current = true;
    select(c);
    // `select` is stable for this purpose: it only reads the cart setter and history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedId, customers]);

  return (
    <div className="flex flex-col bg-background w-full">
      <StatusBar />
      <NavHeader title={t("sale.newSale")} />
      <div className="px-4 pt-2 pb-3">
        <SearchBar
          placeholder={t("sale.searchCustomer")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {/* Directly under the search it belongs to (owner, 2026-11-17): a customer who is not on
            this phone is found by adding them, and the row that does it sat at the bottom of a
            list that can be forty names long. Dark plate, brand text — the same pair the
            reconciliation sheet uses for its one affirmative action. */}
        <button
          type="button"
          onClick={() => navigate(withReturn(`${base}/customers/new`, `${base}/sale`))}
          className="w-full h-11 mt-2 rounded-[var(--radius-tile)] flex items-center justify-center gap-2 ds-pressable"
          style={{ background: "#2c2c2a", color: "var(--brand)" }}
          data-testid="sale-add-customer"
        >
          <Plus size={16} />
          <span className="text-sm font-semibold">{t("sale.addNewCustomer")}</span>
        </button>
      </div>

      {/* Walk-in sits above the list, not after it: it is the one choice that needs no search,
          and a customer who is not on this phone should not require scrolling past forty names. */}
      <div className="px-4 pt-1">
        <button
          onClick={() => continueWith(null)}
          className="w-full flex items-center gap-3 p-3.5 rounded-[var(--radius-tile)] text-start ds-pressable"
          style={{ background: "var(--surface-2)" }}
          data-testid="sale-walk-in"
        >
          <div
            className="size-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--surface-3, var(--muted))" }}
          >
            <UserRound size={18} style={{ color: "var(--text-secondary)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">{t("sale.walkIn")}</p>
            <p className="text-xs text-caption">{t("sale.walkInHint")}</p>
          </div>
        </button>
      </div>

      <div className="px-4 pt-4">
        <p className="ds-section-label text-foreground mb-2">{t("sale.recentCustomers")}</p>
      </div>

      <div className="flex flex-col">
        {!ready && <SkeletonList rows={6} />}
        {ready && filtered.map((c, i) => (
          <button
            key={c.id}
            onClick={() => select(c)}
            className={`flex items-center gap-3 px-4 py-4 text-start ${
              i < filtered.length - 1 ? "border-b border-border" : ""
            }`}
          >
            {/* Customer image or initial placeholder */}
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 bg-muted text-foreground overflow-hidden">
              <Photo
                src={c.imageUrl}
                alt={c.name}
                className="w-full h-full object-cover"
                fallback={c.name.charAt(0).toUpperCase()}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{c.name}</p>
              <p className="text-xs text-caption">{c.phone}</p>
            </div>
            <div className="text-end">
              {c.outstandingBalance > 0 ? (
                <p className="text-xs font-medium text-foreground">{formatCurrency(c.outstandingBalance)} {t("sale.due")}</p>
              ) : (
                <p className="text-xs text-caption">{t("sale.noOutstandingBalance")}</p>
              )}
            </div>
          </button>
        ))}

      </div>
    </div>
  );
}
