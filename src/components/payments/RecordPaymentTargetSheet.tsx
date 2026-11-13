import { Building2, Wallet } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";

/**
 * "Which side is the money on?" — the one question Home's Record Payment has to ask.
 *
 * ONE BUTTON, TWO LEDGERS. Recording a customer's udhaar payment and paying a supplier are not
 * the same screen with a different name: they read different balances (what a customer owes vs
 * what the shop owes), they are gated by different grants, and they call different functions.
 * The button used to assume the customer side, so a shopkeeper who wanted to pay a supplier had
 * no way in from Home and had to know to go through Purchases first.
 *
 * WHAT THE ROWS SAY. Each option names the side AND the direction of the money, because
 * "customer" and "supplier" alone leave the reader to work out whether this screen takes money
 * or spends it. Tapping a row is the answer, so the sheet closes on it and there is no cross to
 * dismiss (the scrim, Escape and Android back still do).
 *
 * WHERE EACH ROW GOES. Both destinations are the book that already lists only the people with
 * something outstanding, so the balance on the form that follows is the balance being reduced —
 * never a customer with nothing due, and never a supplier the shop does not owe.
 */
interface RecordPaymentTargetSheetProps {
  open: boolean;
  onClose: () => void;
  /** Opens the customers who still owe money, each with its Record Payment action. */
  onCustomers: () => void;
  /** Opens the suppliers the shop still owes, each with its Record Payment action. */
  onSuppliers: () => void;
}

export default function RecordPaymentTargetSheet({
  open,
  onClose,
  onCustomers,
  onSuppliers,
}: RecordPaymentTargetSheetProps) {
  const t = useT();

  return (
    <Sheet
      open={open}
      title={t("recordPayment.targetTitle")}
      onClose={onClose}
      closeButton={false}
      maxHeight="60vh"
    >
      <div className="px-4 pb-2" data-testid="record-payment-target-sheet">
        <p className="text-13 px-1 pb-2" style={{ color: "var(--text-secondary)" }}>
          {t("recordPayment.targetHint")}
        </p>
        <ListCard>
          <ListRow
            icon={Wallet}
            title={t("recordPayment.targetCustomers")}
            description={t("recordPayment.targetCustomersHint")}
            onClick={onCustomers}
            testId="record-payment-target-customers"
          />
          <ListRow
            icon={Building2}
            title={t("recordPayment.targetSuppliers")}
            description={t("recordPayment.targetSuppliersHint")}
            onClick={onSuppliers}
            testId="record-payment-target-suppliers"
          />
        </ListCard>
      </div>
    </Sheet>
  );
}
