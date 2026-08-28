import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { useCartStore } from "@/stores/cartStore";
import { useCustomersStore } from "@/stores/customersStore";
import { formatCurrency } from "@/lib/formatters";
import { useShellBase } from "@/lib/useShellBase";
import type { Customer } from "@/types";
import { Plus } from "lucide-react";

export default function SelectCustomerPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const { setCustomer } = useCartStore();
  const customers = useCustomersStore((s) => s.customers);
  const [search, setSearch] = useState("");

  const filtered = customers.filter(
    (c) =>
      !c.isArchived &&
      (c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search))
  );

  function select(c: Customer) {
    setCustomer(c);
    navigate(`${base}/sale/products`);
  }

  return (
    <div className="flex flex-col bg-white w-full">
      <StatusBar />
      <NavHeader title="New Sale" />
      <div className="px-4 pt-2 pb-3">
        <SearchBar
          placeholder="Search customer by name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="px-4">
        <p className="text-xs font-bold text-black uppercase mb-2">Recent Customers</p>
      </div>

      <div className="flex flex-col">
        {filtered.map((c, i) => (
          <button
            key={c.id}
            onClick={() => select(c)}
            className={`flex items-center gap-3 px-4 py-4 text-left ${
              i < filtered.length - 1 ? "border-b border-[#e5e5e5]" : ""
            }`}
          >
            {/* Customer image or initial placeholder */}
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 bg-[#f5f5f5] text-black overflow-hidden">
              {c.imageUrl ? (
                <img src={c.imageUrl} alt={c.name} className="w-full h-full object-cover" />
              ) : (
                c.name.charAt(0).toUpperCase()
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-black truncate">{c.name}</p>
              <p className="text-xs text-[#888]">{c.phone}</p>
            </div>
            <div className="text-right">
              {c.outstandingBalance > 0 ? (
                <p className="text-xs font-medium text-black">{formatCurrency(c.outstandingBalance)} due</p>
              ) : (
                <p className="text-xs text-[#888]">No outstanding balance</p>
              )}
            </div>
          </button>
        ))}

        <button
          onClick={() => navigate(`${base}/customers/new`)}
          className="flex items-center gap-2 px-4 py-4 mx-4 mt-2 bg-[#f5f5f5] rounded-xl"
        >
          <Plus size={16} className="text-black" />
          <span className="text-sm font-medium text-black">Add New Customer</span>
        </button>
      </div>
    </div>
  );
}
