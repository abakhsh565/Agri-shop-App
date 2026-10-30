import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Plus, Ruler } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCatalogueStore } from "@/stores/catalogueStore";
import { hasPermission } from "@/lib/tenantContext";
import { unitLabel } from "@/lib/catalogue";
import type { ShopUnit } from "@/types";

/**
 * The units this shop sells in, and how each is written.
 *
 * The reference's list is two columns: "Kilogram (kg)" and ".000". That is exactly what the row
 * shows here — the unit's own name and symbol, and the decimals a quantity in it is written
 * with — because those are the two facts a shopkeeper checks when a bill shows a strange number.
 *
 * THE FAMILY IS IN THE SECOND LINE. "Bori" printed alone does not say whether it holds pieces or
 * kilos, and that difference is what the arithmetic underneath uses. The meta line says Weight,
 * Volume or Count, so a unit can be created honestly rather than guessed at from its name.
 */
export default function UnitsPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const units = useCatalogueStore((s) => s.units);
  const ready = useCatalogueStore((s) => s.ready);
  const [query, setQuery] = useState("");

  const canEdit = hasPermission("products.edit");
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!needle) return units;
    return units.filter((u) =>
      `${u.name} ${u.symbol} ${familyWord(u)}`.toLowerCase().includes(needle),
    );
    // `familyWord` only reads translated copy and `t` is stable for a language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, needle]);

  function familyWord(unit: ShopUnit): string {
    if (unit.baseUnit === "kg") return t("units.weight");
    if (unit.baseUnit === "liter") return t("units.volume");
    return t("units.count");
  }

  /** ".000" is how the reference states three decimals, and how a shopkeeper reads precision. */
  function precisionMark(unit: ShopUnit): string {
    // A bare "1" read as a count beside "3 items" elsewhere on the app; a whole unit says so.
    return unit.precision === 0 ? t("units.wholeNumber") : `.${"0".repeat(unit.precision)}`;
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="units-page"
    >
      <StatusBar />
      <NavHeader
        title={t("units.title")}
        backTo={`${base}/inventory/catalogue`}
        right={
          canEdit ? (
            <button
              type="button"
              onClick={() => navigate(`${base}/inventory/units/new`)}
              aria-label={t("units.add")}
              data-testid="units-add"
              className="size-9 rounded-full flex items-center justify-center active:opacity-70"
              style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
            >
              <Plus size={18} />
            </button>
          ) : undefined
        }
      />

      <div className="px-4 pt-1 pb-3">
        <SearchBar
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder={t("units.searchHint")}
          aria-label={t("units.searchHint")}
          data-testid="units-search"
        />
      </div>

      {ready && units.length === 0 ? (
        <EmptyState
          icon={Ruler}
          title={t("units.emptyTitle")}
          subtitle={t("units.emptyBody")}
          action={
            canEdit
              ? { label: t("units.add"), onClick: () => navigate(`${base}/inventory/units/new`) }
              : undefined
          }
        />
      ) : (
        <div className="pb-6">
          {/* Straight on the page, as the reference's Units list is: name and precision, one
              hairline each, no card. */}
          <ListCard variant="plain">
            {visible.map((unit) => (
              <ListRow
                key={unit.id}
                testId={`unit-row-${unit.id}`}
                title={unitLabel(unit)}
                meta={familyWord(unit)}
                value={precisionMark(unit)}
                trailing={
                  <ChevronRight
                    size={16}
                    style={{ color: "var(--text-secondary)" }}
                    className="shrink-0"
                  />
                }
                onClick={canEdit ? () => navigate(`${base}/inventory/units/${unit.id}`) : undefined}
              />
            ))}
          </ListCard>

          {ready && visible.length === 0 && (
            <p className="pt-6 text-center text-13" style={{ color: "var(--text-secondary)" }}>
              {t("units.noMatch", { query: query.trim() })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
