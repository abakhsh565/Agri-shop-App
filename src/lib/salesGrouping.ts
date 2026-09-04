import type { Sale } from "@/types";
import { pkDate, pkDateFromISO, pkToday, pkYesterday, pkWeekStart, pkMonthStart } from "@/lib/pkDate";

export interface SalesSection {
  label: string;
  sales: Sale[];
}

/**
 * Group sales into date-based sections: Today, Yesterday, This Week, This Month, Earlier.
 * Sales within each section are sorted newest-first.
 */
export function groupSalesByDateSections(sales: Sale[], now: Date): SalesSection[] {
  const todayStr = pkDate(now);
  const yesterdayStr = pkYesterday();
  const weekStartStr = pkWeekStart();
  const monthStartStr = pkMonthStart();

  const groups: Record<string, Sale[]> = {
    "Today": [],
    "Yesterday": [],
    "This Week": [],
    "This Month": [],
    "Earlier": [],
  };

  for (const sale of sales) {
    const d = pkDateFromISO(sale.createdAt);

    if (d === todayStr) {
      groups["Today"].push(sale);
    } else if (d === yesterdayStr) {
      groups["Yesterday"].push(sale);
    } else if (d >= weekStartStr) {
      groups["This Week"].push(sale);
    } else if (d >= monthStartStr) {
      groups["This Month"].push(sale);
    } else {
      groups["Earlier"].push(sale);
    }
  }

  const sections: SalesSection[] = [];
  for (const [label, sectionSales] of Object.entries(groups)) {
    if (sectionSales.length > 0) {
      // Preserve parent sort order — do not re-sort within sections
      sections.push({ label, sales: sectionSales });
    }
  }

  return sections;
}
