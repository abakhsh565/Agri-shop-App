import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { useCartStore } from "@/stores/cartStore";
import { useCustomersStore } from "@/stores/customersStore";
import { formatCurrency } from "@/lib/formatters";
import { useShellBase } from "@/lib/useShellBase";
import { useT } from "@/lib/i18n";
import { withReturn } from "@/lib/dependencyGraph";
import type { Customer } from "@/types";
import { Plus } from "lucide-react"

export default function SelectCustomerPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { setCustomer } = useCartStore();
  const customers = useCustomersStore((s) => s.customers);
  const [search, setSearch] = useState("");
  const [searchParams] = useSearchParams();

  const filtered = customers.filter(
    (c) =>
      !c.isArchived &&
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search))
  );

  function select(c: Customer) {
    setCustomer(c);
    // If coming from cart, go back to cart; otherwise go to products
    const state = window.history.state?.usr;
    if (state?.fromCart) {
      navigate(`${base}/sale/cart`, { replace: true });
    } else {
      navigate(`${base}/sale/products`);
    }
  }

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
      </div>

      <div className="px-4">
        <p className="text-xs font-bold text-foreground uppercase mb-2">{t("sale.recentCustomers")}</p>
      </div>

      <div className="flex flex-col">
        {filtered.map((c, i) => (
          <button
            key={c.id}
            onClick={() => select(c)}
            className={`flex items-center gap-3 px-4 py-4 text-start ${
              i < filtered.length - 1 ? "border-b border-border" : ""
            }`}
          >
            {/* Customer image or initial placeholder */}
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 bg-muted text-foreground overflow-hidden">
              {c.imageUrl ? (
                <img src={c.imageUrl} alt={c.name} className="w-full h-full object-cover" />
              ) : (
                c.name.charAt(0).toUpperCase()
              )}
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

        <button
          onClick={() => navigate(withReturn(`${base}/customers/new`, `${base}/sale`))}
          className="flex items-center gap-2 px-4 py-4 mx-4 mt-2 bg-muted rounded-[var(--radius-tile)]"
        >
          <Plus size={16} className="text-foreground" />
          <span className="text-sm font-medium text-foreground">{t("sale.addNewCustomer")}</span>
        </button>
      </div>
    </div>
  );
}
