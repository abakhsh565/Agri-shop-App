import { useEffect } from "react";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useSalesStore } from "@/stores/salesStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useAuthStore } from "@/stores/authStore";

// Loads every live dataset once when an authenticated shell mounts and wires
// Realtime so any device sees new sales/stock/customers immediately. Pages then
// just read from the stores — they don't each manage their own fetch.
// `companies` is admin-only at the DB layer, so we only load it for admins to
// avoid a guaranteed empty fetch for employees.
export function useBootstrapData() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === "admin" || role === "co_admin";

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    useProductsStore.getState().load();
    unsubs.push(useProductsStore.getState().subscribe());

    useCustomersStore.getState().load();
    unsubs.push(useCustomersStore.getState().subscribe());

    useSalesStore.getState().load();
    unsubs.push(useSalesStore.getState().subscribe());

    useNotificationStore.getState().load();
    unsubs.push(useNotificationStore.getState().subscribe());

    useEmployeesStore.getState().load();
    unsubs.push(useEmployeesStore.getState().subscribe());

    if (isAdmin) {
      useCompaniesStore.getState().load();
      unsubs.push(useCompaniesStore.getState().subscribe());
    }

    return () => unsubs.forEach((fn) => fn());
    // Re-run if the role changes (e.g. after login) so admin-only data loads.
  }, [isAdmin]);
}
