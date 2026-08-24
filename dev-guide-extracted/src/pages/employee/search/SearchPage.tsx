import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomersStore } from "@/stores/customersStore";
import { useProductsStore } from "@/stores/productsStore";
import { useSalesStore } from "@/stores/salesStore";
import { Search, Clock, X } from "lucide-react";

const QUICK: { label: string; path: string }[] = [
  { label: "Customers", path: "/employee/customers" },
  { label: "Products", path: "/employee/products" },
  { label: "Sales", path: "/employee/sales" },
];

export default function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [recent] = useState(["Rashid Ali", "Wheat Seeds 5kg", "Syngenta Fighter"]);
  const mockCustomers = useCustomersStore((s) => s.customers);
  const mockProducts = useProductsStore((s) => s.products);
  const mockSales = useSalesStore((s) => s.sales);

  const q = query.toLowerCase().trim();

  const results = q
    ? [
        ...mockProducts
          .filter((p) => p.name.toLowerCase().includes(q) || p.company.toLowerCase().includes(q))
          .map((p) => ({ id: p.id, type: "product" as const, title: p.name, subtitle: `Product · ${p.company} · ${p.variants.length} variants`, path: `/employee/products/${p.id}` })),
        ...mockCustomers
          .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q))
          .map((c) => ({ id: c.id, type: "customer" as const, title: c.name, subtitle: `Customer · ${c.phone}`, path: `/employee/customers/${c.id}` })),
        ...mockSales
          .filter((s) => s.customerName.toLowerCase().includes(q) || s.saleNumber.includes(q))
          .map((s) => ({ id: s.id, type: "sale" as const, title: s.customerName + " " + s.saleNumber, subtitle: `Sale · ${s.saleNumber}`, path: `/employee/sales/${s.id}` })),
      ]
    : [];

  return (
    <div className="flex flex-col bg-white w-full min-h-full">
      {/* Search bar */}
      <div className="flex items-center gap-3 px-4 pt-14 pb-4">
        <div className="flex-1 flex items-center gap-2 h-11 bg-white border border-[#e5e5e5] rounded-full px-4">
          <Search size={14} className="text-[#888] shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search anything..."
            className="flex-1 text-sm text-black placeholder:text-[#888] outline-none bg-transparent"
          />
          {query && (
            <button onClick={() => setQuery("")}>
              <X size={14} className="text-[#888]" />
            </button>
          )}
        </div>
        <button
          onClick={() => navigate(-1)}
          className="text-sm font-medium text-black whitespace-nowrap"
        >
          Cancel
        </button>
      </div>

      {/* Quick access chips */}
      {!query && (
        <div className="px-4 mb-4">
          <p className="text-xs font-bold text-[#888] uppercase mb-3">Quick Access</p>
          <div className="flex flex-wrap gap-2">
            {QUICK.map(({ label, path }) => (
              <button
                key={label}
                onClick={() => navigate(path)}
                className="h-8 px-4 rounded-full border border-[#e5e5e5] text-xs font-medium text-black"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {query && results.length > 0 && (
        <div className="px-4">
          <p className="text-xs font-bold text-[#888] uppercase mb-2">Results for '{query}'</p>
          <div className="flex flex-col">
            {results.map((r, i) => (
              <button
                key={r.id + r.type}
                onClick={() => navigate(r.path)}
                className={`flex items-center justify-between py-4 text-left ${i < results.length - 1 ? "border-b border-[#e5e5e5]" : ""}`}
              >
                <div>
                  <p className="text-sm font-bold text-black">{r.title}</p>
                  <p className="text-xs text-[#888]">{r.subtitle}</p>
                </div>
                <span className="text-xs font-normal text-[#888] border border-[#e5e5e5] rounded-full px-2.5 py-0.5 capitalize">
                  {r.type}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {query && results.length === 0 && (
        <div className="flex flex-col items-center gap-2 pt-16 text-center px-6">
          <p className="text-base font-bold text-black">No results for "{query}"</p>
          <p className="text-sm text-[#888]">Try searching by product name, customer name, or phone</p>
        </div>
      )}

      {/* Recent searches */}
      {!query && (
        <div className="px-4">
          <p className="text-xs font-bold text-[#888] uppercase mb-3">Recent Searches</p>
          <div className="flex flex-col">
            {recent.map((r, i) => (
              <button
                key={r}
                onClick={() => setQuery(r)}
                className={`flex items-center gap-3 py-4 text-left ${i < recent.length - 1 ? "border-b border-[#e5e5e5]" : ""}`}
              >
                <Clock size={14} className="text-[#888] shrink-0" />
                <span className="text-sm text-black">{r}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
