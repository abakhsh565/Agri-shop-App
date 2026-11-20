import { useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Banknote,
  ChevronRight,
  HandCoins,
  ReceiptText,
  ShoppingBag,
  Truck,
  Undo2,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useDir } from "@/lib/dirContext";
import { hasPermission } from "@/lib/tenantContext";

interface HistoryDoor {
  id: string;
  icon: LucideIcon;
  labelKey: I18nKey;
  permission?: Parameters<typeof hasPermission>[0];
}

const DOORS: HistoryDoor[] = [
  { id: "sales", icon: ShoppingBag, labelKey: "history.sales", permission: "sales.view" },
  { id: "invoices", icon: ReceiptText, labelKey: "history.invoices", permission: "sales.view" },
  { id: "purchases", icon: Truck, labelKey: "history.purchases", permission: "purchases.view" },
  { id: "returns", icon: Undo2, labelKey: "history.returns", permission: "sales.view" },
  { id: "customer-payments", icon: HandCoins, labelKey: "history.customerPayments", permission: "payments.view" },
  { id: "supplier-payments", icon: Banknote, labelKey: "history.supplierPayments", permission: "purchases.view" },
  { id: "money", icon: Wallet, labelKey: "history.money", permission: "payments.view" },
  { id: "stock", icon: ArrowLeftRight, labelKey: "history.stock", permission: "products.view" },
];

/**
 * History — the shop's books, one door each.
 *
 * This screen is an index, not a report: it names the eight ledgers and nothing else. The date
 * range belongs to the ledger being read, so it lives on that screen where the transactions are —
 * one choice of days, one list of cards (owner's correction, 2026-11-19).
 */
export default function AdminHistoryPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { isRtl } = useDir();

  const doors = DOORS.filter((door) => !door.permission || hasPermission(door.permission));

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }} data-testid="admin-history-page">
      <StatusBar />
      <NavHeader title={t("history.title")} />

      {/* The standard 16px page gutter: without it the card ran to the bezel, which is the
          spacing the owner flagged on this screen. */}
      <div className="px-4 pt-3 pb-8" data-testid="history-doors">
        <ListCard>
          {doors.map((door) => (
            <ListRow
              key={door.id}
              icon={door.icon}
              title={t(door.labelKey)}
              testId={`history-door-${door.id}`}
              onClick={() => navigate(`${base}/history/${door.id}`)}
              trailing={
                <ChevronRight
                  size={14}
                  className="shrink-0"
                  style={{ color: "var(--text-secondary)", transform: isRtl ? "rotate(180deg)" : undefined }}
                />
              }
            />
          ))}
        </ListCard>
      </div>
    </div>
  );
}
