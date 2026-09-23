import { useNavigate } from "react-router-dom";
import { Building2, ChevronRight, Package, Users, type LucideIcon } from "lucide-react";
import { useSetupStatus } from "@/lib/setupStatus";
import { useDir } from "@/lib/dirContext";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import type { Dependency } from "@/lib/dependencyGraph";

const ICONS: Record<Dependency, LucideIcon> = {
  supplier: Building2,
  product: Package,
  customer: Users,
};

/**
 * The one thing to do next, on Home.
 *
 * Deliberately NOT the checklist. Settings owns completion status — all three steps, a
 * percentage, a permanent place to audit the shop. Home is where a new owner lands with
 * nothing configured, and what that person needs is not a dashboard of unfinished work;
 * it is one clear next action.
 *
 * Deliberately not a card with buttons either. A prompt on someone's home screen earns its
 * place only by being smaller than the thing it asks for, so this is a single row on the
 * app's own list grammar — glyph, the action as the label, the reason as the meta line, a
 * chevron that mirrors in RTL — which means it inherits the same height, inset, type and
 * press state as every other row in the product, and introduces no second visual language.
 *
 * The row shows the first unmet dependency in the graph's own order (supplier → product →
 * customer, because a product needs a supplier and a sale needs both). Finishing it reveals
 * the next one. Once the shop can trade the block renders nothing at all.
 */
export default function NextStepCard({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  const { isRtl } = useDir();
  const { items, ready, complete } = useSetupStatus();

  const next = items.find((i) => !i.done);
  // Not loaded, already trading, or nothing missing: Home stays Home.
  if (!ready || complete || !next) return null;

  const action = next.action;

  return (
    <div className={className} data-testid="setup-next-step">
      <ListCard>
        <ListRow
          icon={ICONS[next.id]}
          // The label is the action, not the state: a row you can tap should say what
          // tapping does. The state ("No suppliers yet") stays in the in-flow empty
          // states, where the owner meets the entity itself.
          title={action ? action.label : next.title}
          // No permission to create it: say who can, and drop the chevron so the row
          // never looks tappable when it is not.
          meta={action ? next.why : (next.instead ?? next.why)}
          trailing={
            action ? (
              <ChevronRight
                size={18}
                className="ds-glyph-sm shrink-0"
                style={{
                  color: "var(--text-secondary)",
                  transform: isRtl ? "rotate(180deg)" : undefined,
                }}
              />
            ) : undefined
          }
          onClick={action ? () => navigate(action.to) : undefined}
        />
      </ListCard>
    </div>
  );
}
