import { useNavigate } from "react-router-dom";
import { Check, ChevronRight } from "lucide-react";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Skeleton from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useSetupStatus } from "@/lib/setupStatus";

/**
 * Business setup status, on an existing surface.
 *
 * Persistent visibility of what is complete and what is missing — not a one-time wizard.
 * Every row is either done, or offers the action that finishes it in one tap, reusing the
 * same dependency graph copy the in-flow empty states use, so a missing supplier reads the
 * same words wherever the owner meets it.
 *
 * The markup deliberately copies this page's own section idiom rather than the newer
 * `ds-section-title` primitive: on Settings every section is a `px-4 pt-5` block with an
 * uppercase `text-xs` semibold secondary label above a `ListCard`. A block that introduced
 * its own heading treatment would read as a different page bolted on, which is exactly the
 * failure this component must avoid.
 *
 * When nothing is missing it renders nothing at all: guidance that nags forever is the
 * failure mode this is written against.
 */
export default function SetupChecklist({ className = "" }: { className?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const { items, total, percent, complete, ready } = useSetupStatus();

  if (ready && complete) return null;

  return (
    <div data-testid="setup-checklist" className={`px-4 pt-5 ${className}`}>
      <div className="flex items-baseline justify-between">
        <p
          className="text-xs font-bold uppercase mb-3 tracking-wider"
          style={{ color: "var(--text-secondary)" }}
        >
          {t("setup.title")}
        </p>
        <span className="ds-row-qualifier" data-testid="setup-percent">
          {ready ? t("setup.percent", { x: percent }) : t("common.loading")}
        </span>
      </div>

      <ListCard>
        {!ready &&
          Array.from({ length: total }).map((_, i) => (
            <ListRow key={i} title="">
              <Skeleton className="h-4 w-2/3" />
            </ListRow>
          ))}

        {ready &&
          items.map((item) => (
            <ListRow
              key={item.id}
              title={item.title}
              meta={item.done ? undefined : item.action ? item.why : (item.instead ?? item.why)}
              value={item.done ? undefined : item.action?.label}
              trailing={
                item.done ? (
                  <Check size={18} strokeWidth={1.5} style={{ color: "var(--brand)" }} />
                ) : item.action ? (
                  <ChevronRight size={18} strokeWidth={1.5} style={{ color: "var(--text-tertiary)" }} />
                ) : undefined
              }
              onClick={item.done || !item.action ? undefined : () => navigate(item.action!.to)}
            />
          ))}
      </ListCard>
    </div>
  );
}
