import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronRight } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import SearchBar from "@/components/ui/SearchBar";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCustomersStore } from "@/stores/customersStore";
import { formatCurrency } from "@/lib/formatters";

/**
 * Record Payment — the people who owe, then the supplier book.
 *
 * THE SHAPE IS THE OWNER'S REFERENCE (2026-11-16): a search field, then one row per customer
 * carrying the name, the phone and the balance, and a chevron into the payment form. It used to
 * ask "which side is the money on?" first, which made the common case — a customer paying off
 * udhaar — a two-step question whose answer the shopkeeper already knew.
 *
 * ONLY THE PEOPLE WITH SOMETHING TO PAY are listed. A row's amount is the same
 * `outstandingBalance` the customer's own screen reads, so the form that follows reduces exactly
 * the figure this row showed. The phone is there because two shops can share a name, and the
 * number is what an owner recognises at the counter.
 *
 * THE SUPPLIER SIDE IS NOT LOST. Paying a supplier is the other direction on a different
 * ledger, so it keeps its own row at the bottom rather than a customer row that spends money.
 */
interface RecordPaymentTargetSheetProps {
  open: boolean;
  onClose: () => void;
  /** Opens the customers book — the only way in when nobody owes anything. */
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
  const base = useShellBase();
  const navigate = useNavigate();
  const customers = useCustomersStore((s) => s.customers);
  const ready = useCustomersStore((s) => s.ready);
  const load = useCustomersStore((s) => s.load);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open && !ready) void load();
  }, [open, ready, load]);

  // Each opening starts from an empty search: a stale filter would hide the person the owner
  // opened the sheet for, with no visible reason why the list looks short.
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const owing = useMemo(
    () =>
      customers
        .filter((customer) => customer.outstandingBalance > 0)
        .sort((a, b) => b.outstandingBalance - a.outstandingBalance),
    [customers],
  );

  const needle = search.trim().toLowerCase();
  const rows = needle
    ? owing.filter(
        (customer) =>
          customer.name.toLowerCase().includes(needle) ||
          (customer.phone ?? "").toLowerCase().includes(needle),
      )
    : owing;

  return (
    <Sheet
      open={open}
      title={t("recordPayment.targetTitle")}
      onClose={onClose}
      maxHeight="78vh"
    >
      <div className="px-4 pb-4" data-testid="record-payment-target-sheet">
        <SearchBar
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("customers.search")}
          aria-label={t("customers.search")}
          onClear={() => setSearch("")}
          data-testid="record-payment-search"
        />

        <div className="pt-3">
          {!ready ? (
            <SkeletonList rows={3} />
          ) : rows.length === 0 ? (
            <p
              className="px-1 py-6 text-center text-12"
              style={{ color: "var(--text-secondary)" }}
              data-testid="record-payment-empty"
            >
              {needle ? t("recordPayment.noMatch") : t("recordPayment.noneOwed")}
            </p>
          ) : (
            <ListCard>
              {rows.map((customer) => (
                <ListRow
                  key={customer.id}
                  testId={`record-payment-customer-${customer.id}`}
                  title={customer.name}
                  meta={customer.phone}
                  onClick={() => {
                    onClose();
                    navigate(`${base}/customers/${customer.id}/record-payment`);
                  }}
                  trailing={
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-13 font-bold tabular-nums">
                        {formatCurrency(customer.outstandingBalance)}
                      </span>
                      <ChevronRight size={15} style={{ color: "var(--text-tertiary)" }} />
                    </span>
                  }
                />
              ))}
            </ListCard>
          )}
        </div>

        {/* The other direction, on its own ledger. */}
        <div className="pt-3">
          <ListCard>
            <ListRow
              icon={Building2}
              title={t("recordPayment.targetSuppliers")}
              description={t("recordPayment.targetSuppliersHint")}
              onClick={onSuppliers}
              testId="record-payment-target-suppliers"
            />
            {ready && owing.length === 0 && (
              <ListRow
                title={t("recordPayment.allCustomers")}
                onClick={onCustomers}
                testId="record-payment-all-customers"
              />
            )}
          </ListCard>
        </div>
      </div>
    </Sheet>
  );
}
