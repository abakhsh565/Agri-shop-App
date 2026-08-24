import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { CategoryChip } from "@/components/ui/Badge";
import { useCartStore } from "@/stores/cartStore";
import { useProductsStore } from "@/stores/productsStore";
import { useShellBase } from "@/lib/useShellBase";
import { ChevronRight } from "lucide-react";
import type { ProductCategory } from "@/types";

const FILTERS: { key: "all" | ProductCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "spray", label: "Sprays" },
  { key: "seed", label: "Seeds" },
  { key: "fertilizer", label: "Fertilizer" },
];

const CATEGORY_LABEL: Record<string, string> = {
  spray: "Sprays",
  seed: "Seeds",
  fertilizer: "Fertilizer",
  other: "Other",
};

export default function BrowseProductsPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const { customer } = useCartStore();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | ProductCategory>("all");
  const products = useProductsStore((s) => s.products);

  const filtered = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.company.toLowerCase().includes(search.toLowerCase());
    const matchCat = category === "all" || p.category === category;
    return matchSearch && matchCat;
  });

  return (
    <div className="flex flex-col bg-white w-full">
      <StatusBar />
      <NavHeader title="Select Products" backTo={`${base}/sale`} />

      {customer && (
        <div className="bg-[#f5f5f5] px-4 py-2">
          <p className="text-xs text-black">Customer: <span className="font-medium">{customer.name}</span></p>
        </div>
      )}

      <div className="px-4 pt-3 pb-2">
        <SearchBar
          placeholder="Search products"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCategory(f.key)}
            className={`shrink-0 h-8 px-4 rounded-full text-xs font-medium transition-colors ${
              category === f.key ? "bg-black text-white" : "bg-[#f5f5f5] text-black"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col">
        {filtered.map((p, i) => (
          <button
            key={p.id}
            onClick={() => navigate(`${base}/sale/products/${p.id}`)}
            className={`flex items-center justify-between px-4 py-4 text-left ${
              i < filtered.length - 1 ? "border-b border-[#e5e5e5]" : ""
            }`}
          >
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-black">{p.name}</p>
              <p className="text-xs text-[#888]">{p.company}</p>
              <CategoryChip label={CATEGORY_LABEL[p.category] || p.category} />
            </div>
            <ChevronRight size={18} className="text-black shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
