import type { Sale } from "@/types";

export interface SalesSection {
  label: string;
  sales: Sale[];
}

/**
 * Group sales into date-based sections: Today, Yesterday, This Week, This Month, Earlier.
 * Sales within each section are sorted newest-first.
 */
export function groupSalesByDateSections(sales: Sale[], now: Date): SalesSection[] {
  const todayStr = now.toISOString().split("T")[0];

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const groups: Record<string, Sale[]> = {
    "Today": [],
    "Yesterday": [],
    "This Week": [],
    "This Month": [],
    "Earlier": [],
  };

  for (const sale of sales) {
    const d = sale.createdAt.split("T")[0];
    const saleDate = new Date(d + "T12:00:00");

    if (d === todayStr) {
      groups["Today"].push(sale);
    } else if (d === yesterdayStr) {
      groups["Yesterday"].push(sale);
    } else if (saleDate >= weekStart) {
      groups["This Week"].push(sale);
    } else if (saleDate >= monthStart) {
      groups["This Month"].push(sale);
    } else {
      groups["Earlier"].push(sale);
    }
  }

  const sections: SalesSection[] = [];
  for (const [label, sectionSales] of Object.entries(groups)) {
    if (sectionSales.length > 0) {
      // Sort newest-first within each section
      sectionSales.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      sections.push({ label, sales: sectionSales });
    }
  }

  return sections;
}
