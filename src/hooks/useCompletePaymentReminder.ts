import { useCallback, useRef } from "react";
import { useT } from "@/lib/i18n";
import { useUIStore } from "@/stores/uiStore";
import {
  deletePaymentReminder,
  savePaymentReminder,
  type PaymentReminder,
} from "@/lib/paymentReminders";

/**
 * Finishing a reminder removes the diary row and offers the owner a short undo.
 *
 * The reminder is a note, not a money record, so deleting it does not touch a payment. The
 * success toast is the only confirmation: the row disappearing at the same time makes the state
 * clear without a second dialog. Undo recreates the same reminder as a fresh upcoming row; if the
 * party has been removed in the meantime, the save fails and says so rather than pretending the
 * reminder is back.
 */
export function useCompletePaymentReminder() {
  const t = useT();
  const { addToast } = useUIStore();
  const inFlight = useRef<Set<string>>(new Set());

  return useCallback(
    async (reminder: PaymentReminder, onChanged: () => void) => {
      if (inFlight.current.has(reminder.id)) return;
      inFlight.current.add(reminder.id);

      try {
        await deletePaymentReminder(reminder.id);
        onChanged();
        addToast(t("paymentBook.doneRemoved"), "success", {
          label: t("common.undo"),
          onClick: () => {
            void savePaymentReminder({
              title: reminder.title,
              kind: reminder.kind,
              customerId: reminder.customerId,
              companyId: reminder.companyId,
              person: reminder.person ?? "",
              amount: reminder.amount,
              dueOn: reminder.dueOn,
              dueTime: reminder.dueTime,
              repeatEvery: reminder.repeatEvery,
              repeatUnit: reminder.repeatUnit,
              notes: reminder.notes,
            })
              .then(() => {
                onChanged();
                addToast(t("paymentBook.doneRestored"), "success");
              })
              .catch(() => addToast(t("paymentBook.doneUndoFailed"), "error"));
          },
        });
      } catch {
        addToast(t("paymentBook.statusFailed"), "error");
      } finally {
        inFlight.current.delete(reminder.id);
      }
    },
    [t, addToast],
  );
}
