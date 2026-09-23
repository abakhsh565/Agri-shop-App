import { useState, useMemo } from "react";
import { useCustomersStore } from "@/stores/customersStore";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { calculatePaymentStatus } from "@/lib/reminderEngine";
import { Search, Check, X, AlertTriangle, ArrowUpDown } from "lucide-react";

interface CustomerSelectorProps {
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  filterFn?: (customer: any) => boolean;
  maxSelections?: number;
}
function getAvatarColor(name: string): string {
  const colors = ["#4d7c0f","#2563eb","#7c3aed","#db2777","#ea580c","#0891b2","#4f46e5","#16a34a","#9333ea","#dc2626"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
function getInitials(name: string): string { return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2); }
function getPriorityScore(c: any): number {
  if (c.outstandingBalance <= 0) return 0;
  const s = calculatePaymentStatus(c, new Date());
  let r = s === "high_risk" ? 100 : s === "delayed" ? 60 : s === "on_time" ? 30 : s === "no_due_date" ? 10 : 0;
  r += Math.min(c.outstandingBalance / 1000, 50);
  if (c.dueDate) { const d = Math.floor((Date.now() - new Date(c.dueDate).getTime()) / 86400000); if (d > 0) r += Math.min(d, 40); }
  return r;
}
function getRiskTag(score: number, t: (key: string) => string): { label: string; color: string; bg: string } | null {
  if (score >= 100) return { label: t("inline.high_risk"), color: "#dc2626", bg: "#fee2e2" };
  if (score >= 60) return { label: t("inline.delayed"), color: "#d97706", bg: "#fef3c7" };
  if (score >= 30) return { label: t("inline.on_time"), color: "#16a34a", bg: "#d9f99d" };
  return null;
}
export default function CustomerSelector({ selectedIds, onChange, filterFn, maxSelections = 100 }: CustomerSelectorProps) {
  const customers = useCustomersStore((s) => s.customers);
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const [search, setSearch] = useState("");
  const [sortByPriority, setSortByPriority] = useState(true);
  const filteredCustomers = useMemo(() => {
    let list = customers.filter(c => !c.isArchived);
    if (filterFn) list = list.filter(filterFn);
    if (search.trim()) { const q = search.toLowerCase(); list = list.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q)); }
    if (sortByPriority) { list = [...list].sort((a, b) => getPriorityScore(b) - getPriorityScore(a)); }
    else { list = [...list].sort((a, b) => a.name.localeCompare(b.name)); }
    return list;
  }, [customers, search, filterFn, sortByPriority]);
  function toggle(id: string) { const next = new Set(selectedIds); if (next.has(id)) next.delete(id); else if (next.size < maxSelections) next.add(id); onChange(next); }
  function selectAll() { onChange(new Set(filteredCustomers.map(c => c.id))); }
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-secondary)" }} />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t("inline.search_customers")}
          className="w-full h-10 rounded-[var(--radius-tile)] pl-10 pr-10 text-13 outline-none"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--border-control)" }} />
        {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X size={14} style={{ color: "var(--text-secondary)" }} /></button>}
      </div>
      <div className="flex items-center justify-between px-1">
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>
          {selectedIds.size} {t("inline.selected")}{filteredCustomers.length > 0 ? ` / ${filteredCustomers.length}` : ""}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={() => setSortByPriority(v => !v)} className="flex items-center gap-1 text-11 font-semibold"
            style={{ color: sortByPriority ? "var(--brand-dark, #65a30d)" : "var(--text-secondary)" }}>
            <ArrowUpDown size={12} /> {t("inline.priority")}
          </button>
          <button onClick={selectAll} className="text-11 font-semibold" style={{ color: "var(--brand-dark, #65a30d)" }}>
            {t("inline.select_all")}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
        {filteredCustomers.length === 0 ? (
          <p className="text-13 text-center py-4" style={{ color: "var(--text-secondary)" }}>
            {t("inline.no_customers_found")}
          </p>
        ) : (
          filteredCustomers.map(c => {
            const isSelected = selectedIds.has(c.id);
            const score = getPriorityScore(c);
            const riskTag = getRiskTag(score, t);
            return (
              <button key={c.id} onClick={() => toggle(c.id)}
                className="flex items-center gap-3 p-3 rounded-[var(--radius-tile)] text-start transition-colors"
                style={{ background: isSelected ? "var(--brand-light, #d9f99d)" : "transparent", border: isSelected ? "1px solid var(--brand-dark, #65a30d)" : "1px solid transparent" }}>
                {c.imageUrl ? (<img src={c.imageUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />) : (<div className="w-9 h-9 rounded-full flex items-center justify-center text-11 font-bold shrink-0" style={{ background: getAvatarColor(c.name), color: "#fff" }}>{getInitials(c.name)}</div>)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-13 font-semibold truncate" style={{ color: "var(--text-primary)" }}>{c.name}</p>
                    {riskTag && <span className="text-9 font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: riskTag.bg, color: riskTag.color }}>{riskTag.label}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-11" style={{ color: "var(--text-secondary)" }}>
                    {c.outstandingBalance > 0 && <span style={{ color: "#ef4444" }}>{formatCurrency(c.outstandingBalance)}</span>}
                    {c.dueDate && <span>{t("inline.due")}: {c.dueDate}</span>}
                    {score >= 60 && <AlertTriangle size={10} style={{ color: "#d97706" }} />}
                  </div>
                </div>
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: isSelected ? "var(--brand-dark, #65a30d)" : "var(--surface-2)", border: isSelected ? "none" : "1px solid var(--divider)" }}>
                  {isSelected && <Check size={12} color="#fff" />}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
