import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useProductsStore } from "@/stores/productsStore";
import { rpcAdjustStock } from "@/lib/db";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import type { AdjustmentType } from "@/types";

const TYPES: { key: AdjustmentType; label: string; hint: string }[] = [
  { key: "add", label: "Add", hint: "Received / found extra stock" },
  { key: "remove", label: "Remove", hint: "Damaged, expired, or lost" },
  { key: "set", label: "Set to", hint: "Physical count correction" },
];

const REASONS: Record<AdjustmentType, string[]> = {
  add: ["New stock received", "Found extra stock", "Return to inventory"],
  remove: ["Damaged stock", "Expired stock", "Lost / theft", "Sample given"],
  set: ["Physical count correction", "Opening balance"],
};

export default function InventoryAdjustPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const products = useProductsStore((s) => s.products);
  const product = products.find((p) => p.id === productId);
  const [, force] = useState(0);
  const [variantId, setVariantId] = useState(product?.variants[0]?.id ?? "");
  const [type, setType] = useState<AdjustmentType>("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!product) return (
    <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
      <StatusBar />
      <NavHeader title="Adjust Stock" backTo="/admin/inventory" />
      <div className="flex flex-col items-center py-20 gap-2">
        <p className="text-3xl">🔍</p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Product not found</p>
      </div>
    </div>
  );

  const variant = product.variants.find((v) => v.id === variantId);
  const amt = Number(amount) || 0;
  const before = variant?.stockQty ?? 0;
  const after = type === "add" ? before + amt : type === "remove" ? before - amt : amt;
  const change = after - before;

  async function handleSave() {
    setError("");
    if (!product || !variant) { setError("Select a unit / variant."); return; }
    if (amt <= 0 && type !== "set") { setError("Enter an amount greater than zero."); return; }
    if (type === "set" && amount === "") { setError("Enter the counted quantity."); return; }
    // Inventory can never go negative (Non-Negotiable Rules).
    if (after < 0) { setError("Adjustment would make stock negative. Remove at most " + before + "."); return; }
    if (change === 0) { setError("This does not change the stock level."); return; }

    setLoading(true);
    try {
      const res = await rpcAdjustStock({
        variantId: variant.id,
        productId: product.id,
        productName: product.name,
        adjustmentType: type,
        qty: amt,
        reason: reason.trim() || undefined,
      });

      addToast(`${product.name} · ${variant.name} → ${res.qtyAfter} units`, "success");
      navigate("/admin/inventory", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not adjust stock.");
    } finally {
      setLoading(false);
    }
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--divider)",
    color: "var(--text-primary)",
  } as const;
  const labelCls = "text-[11px] font-bold uppercase mb-2 tracking-wider";

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader title="Adjust Stock" backLabel="Inventory" backTo="/admin/inventory" />

        <div className="flex flex-col gap-5 p-4">
          <div>
            <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{product.name}</p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{product.company}</p>
          </div>

          {/* Variant */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Unit / Variant</p>
            <div className="flex flex-col gap-2">
              {product.variants.map((v) => {
                const selected = v.id === variantId;
                return (
                  <button
                    key={v.id}
                    onClick={() => { setVariantId(v.id); force((n) => n + 1); }}
                    className="flex items-center justify-between p-3.5 rounded-[14px] text-left transition-colors"
                    style={{ background: "var(--surface)", border: `1.5px solid ${selected ? "var(--brand)" : "var(--divider)"}` }}
                  >
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{v.name}</p>
                      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{v.stockQty} in stock</p>
                    </div>
                    <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                      style={{ borderColor: selected ? "var(--brand)" : "var(--text-secondary)" }}>
                      {selected && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--brand)" }} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Adjustment type */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Adjustment</p>
            <div className="flex gap-2">
              {TYPES.map((tp) => (
                <button key={tp.key} onClick={() => { setType(tp.key); setReason(""); }}
                  className="flex-1 h-11 rounded-full text-sm font-semibold transition-colors"
                  style={{
                    background: type === tp.key ? "var(--brand)" : "var(--surface-2)",
                    color: type === tp.key ? "#0a0a0a" : "var(--text-secondary)",
                    border: type === tp.key ? "none" : "1px solid var(--divider)",
                  }}>
                  {tp.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: "var(--text-secondary)" }}>
              {TYPES.find((t) => t.key === type)?.hint}
            </p>
          </div>

          {/* Amount */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>
              {type === "set" ? "Counted quantity" : "Quantity"}
            </p>
            <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0" className="w-full h-12 rounded-[24px] px-4 text-sm outline-none" style={fieldStyle} />
          </div>

          {/* Reason */}
          <div>
            <p className={labelCls} style={{ color: "var(--text-secondary)" }}>Reason</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {REASONS[type].map((r) => (
                <button key={r} onClick={() => setReason(r)}
                  className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
                  style={{
                    background: reason === r ? "var(--brand)" : "var(--surface-2)",
                    color: reason === r ? "#0a0a0a" : "var(--text-secondary)",
                    border: reason === r ? "none" : "1px solid var(--divider)",
                  }}>
                  {r}
                </button>
              ))}
            </div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Add a note (optional)"
              className="w-full h-11 rounded-[24px] px-4 text-sm outline-none" style={fieldStyle} />
          </div>

          {/* Preview */}
          <div className="rounded-[14px] p-4 flex items-center justify-between" style={{ background: "var(--surface-2)" }}>
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>New stock level</span>
            <span className="text-base font-bold" style={{ color: after < 0 ? "var(--error)" : "var(--text-primary)" }}>
              {before} → {after} units
            </span>
          </div>

          {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
        </div>
      </div>

      <div className="p-4 pb-6">
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {loading ? "Saving…" : "Save Adjustment"}
        </button>
      </div>
    </div>
  );
}
