import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";

/**
 * The moment between the PIN and the shop.
 *
 * Before this, the shell mounted immediately and every screen painted its own empty state while
 * four independent reads raced in behind it: the home figure said Rs. 0, then the real one; the
 * product list said "no products", then filled. On a cold connection that looked like five to ten
 * seconds of a wrong app (owner, 2026-11-19).
 *
 * Now the shell waits for the three shelves that every screen reads — stock, customers, sales —
 * before showing a screen at all, so the first thing drawn is the real book. Two escape hatches
 * keep that from becoming a wall: anything already cached paints instantly (a returning user never
 * sees this), and a bounded wait releases the shell even if a read never answers, because a slow
 * network must not become a dead app.
 */
const MAX_WAIT_MS = 2500;

export default function BootGate({ children }: { children: ReactNode }) {
  const t = useT();
  const productsReady = useProductsStore((s) => s.ready);
  const customersReady = useCustomersStore((s) => s.ready);
  const salesReady = useSalesStore((s) => s.ready);
  const knownRows =
    useProductsStore((s) => s.products.length) +
    useCustomersStore((s) => s.customers.length) +
    useSalesStore((s) => s.sales.length);

  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setExpired(true), MAX_WAIT_MS);
    return () => window.clearTimeout(id);
  }, []);

  const settled = productsReady && customersReady && salesReady;
  // Cached rows are a real answer: show them at once and let the revalidation land behind the
  // screen the shopkeeper is already reading.
  if (settled || expired || knownRows > 0) return <>{children}</>;

  return (
    <div
      className="flex flex-col flex-1 items-center justify-center gap-4 px-8"
      data-testid="boot-gate"
      role="status"
      aria-live="polite"
    >
      <span
        className="size-8 rounded-full border-2 animate-spin"
        style={{ borderColor: "var(--divider)", borderTopColor: "var(--brand)" }}
        aria-hidden="true"
      />
      <p className="text-13 font-medium" style={{ color: "var(--text-secondary)" }}>
        {t("common.loading")}
      </p>
    </div>
  );
}
