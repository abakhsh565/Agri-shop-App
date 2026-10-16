import {
  AlertTriangle, BadgeCheck, Ban, BookOpen, ChevronRight, Info, List, Package, Receipt, Truck, User,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { toolTitleKey, type AssistantWidget as Widget } from "@/lib/assistant";

/**
 * The detail, drawn in the conversation.
 *
 * A question is never answered with a link to somewhere else: if it is about a number or a list,
 * the card for it appears right under the sentence, built from the same primitives the app's own
 * screens use — `ListCard` and `ListRow` for rows, the `ds-stat` tiles for totals, `EmptyState`
 * when there is nothing to show. So what the shopkeeper reads in the chat and what they would see
 * on the screen are the same information in the same visual language, and a screen link stays a
 * small extra for whoever wants to go and act on it.
 *
 * One renderer per tool, keyed by the tool that produced the facts — a missing entry is a gap in
 * this file, not a fallback table of keys. Every word a person reads comes through `t()`, so the
 * card is in the language the app is being read in.
 */

type T = (key: string, vars?: Record<string, string | number>) => string;

interface WidgetHelpers {
  t: T;
  /** A card can ask the next question instead of sending the person away from the chat. */
  onAsk: (text: string) => void;
}

/** The tool's own figure, formatted the way the rest of the app writes money. */
function money(value: unknown): string {
  const plain = Number(String(value ?? 0).replace(/,/g, ""));
  return formatCurrency(Number.isFinite(plain) ? plain : 0);
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="ds-stat">
      <div className="ds-stat-label">{label}</div>
      <div className="ds-stat-value num">{value}</div>
    </div>
  );
}

function Stats({ items }: { items: React.ReactNode[] }) {
  return (
    <div className="p-4 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
      {items}
    </div>
  );
}

/** A state pill. Tone comes from the tokens, so it reads in dark as well as light. */
function Pill({ text, tone = "muted" }: { text: string; tone?: "muted" | "ok" | "warn" | "bad" }) {
  const colours = {
    muted: { background: "var(--surface-2)", color: "var(--text-secondary)" },
    ok: { background: "var(--brand-light)", color: "var(--brand-dark)" },
    warn: { background: "var(--warning-bg)", color: "#d97706" },
    bad: { background: "var(--error-bg)", color: "var(--error)" },
  }[tone];
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-11 font-semibold whitespace-nowrap"
      style={colours}
    >
      {text}
    </span>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div className="p-4">
      <div
        className="flex items-start gap-3 p-3 rounded-[14px] ds-meta"
        style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
      >
        <Info size={16} className="shrink-0 mt-0.5" />
        <span>{text}</span>
      </div>
    </div>
  );
}

/**
 * A count said the way the language says it.
 *
 * "1 sale" and "2 sales" are two sentences, not one sentence with a number in it — Urdu does it
 * the other way round — so the pair of keys is chosen here and the number is filled in by the
 * dictionary that owns the wording.
 */
function many(t: T, one: string, several: string, count: number): string {
  return t(count === 1 ? one : several, { count });
}

function titleCase(value: unknown): string {
  const clean = String(value ?? "").replace(/_/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

type Card = { meta: string | null; body: React.ReactNode[] };

// ─── one renderer per tool ───────────────────────────────────────────────────

function salesSummary(f: any, { t }: WidgetHelpers): Card {
  if (!f.saleCount) {
    return { meta: f.period ?? null, body: [<EmptyState key="e" icon={Receipt} title={t("assistant.empty.sales")} />] };
  }
  const body: React.ReactNode[] = [
    <Stats
      key="stats"
      items={[
        <Stat key="c" label={t("assistant.l.sales")} value={String(f.saleCount)} />,
        <Stat key="t" label={t("assistant.l.total")} value={money(f.total)} />,
        <Stat key="p" label={t("assistant.l.counter")} value={money(f.paidAtCounter)} />,
        <Stat key="d" label={t("assistant.l.owed")} value={money(f.stillOwed)} />,
      ]}
    />,
  ];
  for (const person of f.byEmployee ?? []) {
    body.push(
      <ListRow
        key={`emp-${person.name}`}
        icon={User}
        title={person.name}
        meta={many(t, "assistant.s.saleOne", "assistant.s.saleMany", person.count)}
        value={money(person.total)}
      />,
    );
  }
  if (f.biggestSale) {
    body.push(
      <ListRow
        key="biggest"
        icon={Receipt}
        title={f.biggestSale.saleNumber}
        meta={f.biggestSale.at}
        value={money(f.biggestSale.amount)}
      />,
    );
  }
  return { meta: f.period ?? null, body };
}

function profitSummary(f: any, { t }: WidgetHelpers): Card {
  const kind = f.profitFigureIs ?? "exact";
  const body: React.ReactNode[] = [
    <Stats
      key="stats"
      items={[
        <Stat key="r" label={t("assistant.l.revenue")} value={money(f.revenue)} />,
        <Stat key="c" label={t("assistant.l.cost")} value={money(f.knownCost)} />,
        kind === "unknown" ? (
          <Stat key="p" label={t("assistant.l.profit")} value={t("assistant.s.notKnown")} />
        ) : (
          <Stat
            key="p"
            label={kind === "atLeast" ? t("assistant.l.profitAtLeast") : t("assistant.l.profit")}
            value={money(f.profit)}
          />
        ),
        <Stat key="m" label={t("assistant.l.margin")} value={kind === "unknown" ? "—" : `${f.marginPercent}%`} />,
      ]}
    />,
  ];
  if (kind !== "exact") {
    body.push(
      <ListRow
        key="bound"
        icon={AlertTriangle}
        title={kind === "unknown" ? t("assistant.s.noCostEver") : t("assistant.s.upperBound")}
        meta={t("assistant.s.profitWhy", { count: f.linesWithUnknownCost, lines: f.linesCounted })}
      />,
    );
  }
  body.push(
    <ListRow key="lines" icon={List} title={t("assistant.l.lines")} value={String(f.linesCounted)} />,
    <ListRow key="unknown" icon={List} title={t("assistant.l.linesNoCost")} value={String(f.linesWithUnknownCost)} />,
  );
  return { meta: f.period ?? null, body };
}

function customerAccount(f: any, { t, onAsk }: WidgetHelpers): Card {
  if (f.matches === 0) {
    return {
      meta: f.query ?? null,
      body: [<EmptyState key="e" icon={User} title={t("assistant.empty.customer")} subtitle={String(f.query)} />],
    };
  }
  if (f.ambiguous) {
    return {
      meta: t("assistant.s.matches", { count: f.candidates.length }),
      body: (f.candidates ?? []).map((candidate: any) => (
        <ListRow
          key={candidate.name + candidate.phone}
          icon={User}
          title={candidate.name}
          qualifier={candidate.phone ?? undefined}
          value={money(candidate.owed)}
          onClick={() => onAsk(t("assistant.ask.customer", { name: candidate.name }))}
        />
      )),
    };
  }
  const tone = f.standing === "over limit" ? "bad" : f.standing === "near the limit" ? "warn" : "ok";
  const standingLabel =
    f.standing === "over limit"
      ? t("assistant.standing.over")
      : f.standing === "near the limit"
        ? t("assistant.standing.near")
        : t("assistant.standing.within");
  const body: React.ReactNode[] = [
    <ListRow
      key="who"
      icon={User}
      title={f.name}
      meta={f.phone ?? t("assistant.noNumber")}
      emphasis
      trailing={<Pill text={standingLabel} tone={tone as "bad" | "warn" | "ok"} />}
    />,
    <Stats
      key="stats"
      items={[
        <Stat key="o" label={t("assistant.l.owed")} value={money(f.owes)} />,
        <Stat key="l" label={t("assistant.l.limit")} value={money(f.creditLimit)} />,
        <Stat key="b" label={t("assistant.l.bought")} value={money(f.totalBoughtEver)} />,
        <Stat key="p" label={t("assistant.l.paidEver")} value={money(f.totalPaidEver)} />,
      ]}
    />,
  ];
  if (f.dueDate) body.push(<ListRow key="due" icon={List} title={t("assistant.l.due")} value={String(f.dueDate)} />);
  if (f.archived) body.push(<ListRow key="arch" icon={Ban} title={t("assistant.s.archived")} />);
  body.push(
    f.lastPurchase ? (
      <ListRow
        key="last"
        icon={Receipt}
        title={f.lastPurchase.saleNumber}
        meta={`${f.lastPurchase.at} · ${f.lastPurchase.soldBy}`}
        value={money(f.lastPurchase.amount)}
        emphasis
      />
    ) : (
      <ListRow key="last" icon={Receipt} title={t("assistant.empty.nothingYet")} />
    ),
  );
  return { meta: f.phone ?? t("assistant.customer"), body };
}

function productStock(f: any, { t }: WidgetHelpers): Card {
  const products = f.products ?? [];
  if (!products.length) {
    return { meta: null, body: [<EmptyState key="e" icon={Package} title={t("assistant.empty.product")} />] };
  }
  const body: React.ReactNode[] = [];
  for (const product of products) {
    body.push(
      <div key={`p-${product.product}`} className="ds-section px-4 pt-4 pb-1">
        {product.company ? `${product.product} · ${product.company}` : product.product}
      </div>,
    );
    if (!product.packs?.length) {
      body.push(<ListRow key={`${product.product}-none`} icon={Package} title={t("assistant.empty.pack")} />);
      continue;
    }
    for (const pack of product.packs) {
      const bits = [t("assistant.s.inStock", { count: pack.stock })];
      if (pack.unitSize > 1) bits.push(t("assistant.s.perPack", { count: pack.unitSize }));
      if (pack.expiry) bits.push(t("assistant.s.expires", { date: pack.expiry }));
      if (pack.costPrice != null) bits.push(t("assistant.s.costLine", { amount: money(pack.costPrice) }));
      body.push(
        <ListRow
          key={`${product.product}-${pack.pack}`}
          icon={Package}
          title={pack.pack}
          meta={bits.join(" · ")}
          value={money(pack.sellingPrice)}
          trailing={
            pack.low ? (
              <Pill
                text={pack.stock <= 0 ? t("assistant.s.out") : t("assistant.s.low")}
                tone={pack.stock <= 0 ? "bad" : "warn"}
              />
            ) : undefined
          }
        />,
      );
    }
  }
  return {
    meta: f.lowPacks ? many(t, "assistant.s.packLowOne", "assistant.s.packLowMany", f.lowPacks) : null,
    body,
  };
}

function lowStock(f: any, { t }: WidgetHelpers): Card {
  if (!f.count) {
    return {
      meta: t("assistant.s.reorder"),
      body: [<EmptyState key="e" icon={Package} title={t("assistant.empty.lowStock")} subtitle={t("assistant.empty.lowStockWhy")} />],
    };
  }
  const body: React.ReactNode[] = (f.items ?? []).map((item: any) => (
    <ListRow
      key={`${item.product}-${item.pack}`}
      icon={Package}
      title={item.product}
      qualifier={item.pack}
      meta={t("assistant.s.lowLevel", { stock: item.stock, level: item.threshold })}
      trailing={<Pill text={item.stock <= 0 ? t("assistant.s.out") : t("assistant.s.low")} tone={item.stock <= 0 ? "bad" : "warn"} />}
    />
  ));
  if ((f.items?.length ?? 0) < f.count) {
    body.push(<ListRow key="more" title={t("assistant.s.moreRows", { count: f.count - f.items.length })} />);
  }
  return { meta: t("assistant.s.reorder"), body };
}

function saleLookup(f: any, { t }: WidgetHelpers): Card {
  if (!f.matches) {
    return {
      meta: f.searchedFor ?? null,
      body: [<EmptyState key="e" icon={Receipt} title={t("assistant.empty.sale")} subtitle={f.searchedFor ?? undefined} />],
    };
  }
  const sales = f.sales ?? [];
  const body: React.ReactNode[] = [];
  for (const sale of sales.slice(0, 3)) {
    body.push(
      <ListRow
        key={`${sale.saleNumber}-head`}
        icon={Receipt}
        title={sale.saleNumber}
        meta={`${sale.when} · ${sale.soldBy}`}
        emphasis
        trailing={sale.voided ? <Pill text={t("assistant.s.voided")} tone="warn" /> : undefined}
      />,
      <Stats
        key={`${sale.saleNumber}-stats`}
        items={[
          <Stat key="t" label={t("assistant.l.total")} value={money(sale.total)} />,
          <Stat key="p" label={t("assistant.l.paid")} value={money(sale.paid)} />,
          <Stat key="o" label={t("assistant.l.owed")} value={money(sale.stillOwed)} />,
        ]}
      />,
      <ListRow key={`${sale.saleNumber}-cust`} icon={User} title={t("assistant.customer")} value={sale.customer ?? "—"} />,
    );
    if (sale.payment) {
      body.push(<ListRow key={`${sale.saleNumber}-pay`} icon={List} title={t("assistant.l.payment")} value={sale.payment} />);
    }
    for (const line of sale.lines ?? []) {
      body.push(<ListRow key={`${sale.saleNumber}-${line.item}`} title={line.item} qualifier={`×${line.qty}`} value={money(line.lineTotal)} />);
    }
  }
  if (sales.length > 3) {
    body.push(
      <ListRow
        key="more"
        title={many(t, "assistant.s.moreSaleOne", "assistant.s.moreSaleMany", sales.length - 3)}
      />,
    );
  }
  return { meta: f.searchedFor ?? null, body };
}

function supplierDues(f: any, { t }: WidgetHelpers): Card {
  const suppliers = f.suppliers ?? [];
  if (!suppliers.length) {
    return { meta: null, body: [<EmptyState key="e" icon={Truck} title={t("assistant.empty.dues")} />] };
  }
  return {
    meta: many(t, "assistant.s.supplierOne", "assistant.s.supplierMany", suppliers.length),
    body: [
      <Stats key="stats" items={[<Stat key="t" label={t("assistant.l.totalOwed")} value={money(f.totalOwed)} />]} />,
      ...suppliers.map((supplier: any) => (
        <ListRow
          key={supplier.name}
          icon={Truck}
          title={supplier.name}
          qualifier={supplier.phone ?? undefined}
          meta={supplier.dueDate ? t("assistant.s.due", { date: supplier.dueDate }) : undefined}
          value={money(supplier.owed)}
        />
      )),
    ],
  };
}

function employeeActivity(f: any, { t }: WidgetHelpers): Card {
  const body: React.ReactNode[] = [];
  if (f.salesByEmployee?.length) {
    for (const person of f.salesByEmployee) {
      body.push(
        <ListRow
          key={`emp-${person.name}`}
          icon={User}
          title={person.name}
          meta={many(t, "assistant.s.saleOne", "assistant.s.saleMany", person.count)}
          value={money(person.total)}
        />,
      );
    }
  } else {
    body.push(<EmptyState key="e" icon={User} title={t("assistant.empty.period")} />);
  }
  if (!f.activity?.length) {
    body.push(<ListRow key="none" icon={List} title={t("assistant.empty.log")} />);
  } else {
    for (const event of f.activity.slice(0, 12)) {
      body.push(<ListRow key={`${event.action}-${event.at}`} icon={List} title={titleCase(event.action)} qualifier={event.entity} meta={event.at} />);
    }
  }
  return { meta: f.period ?? null, body };
}

function myAbilities(f: any, { t }: WidgetHelpers): Card {
  const granted = f.granted ?? [];
  const body: React.ReactNode[] = granted.map((item: any) => (
    <ListRow key={item.code} icon={BadgeCheck} title={item.label} meta={item.module} />
  ));
  if (f.deniedCount) {
    body.push(
      <ListRow
        key="denied"
        icon={Ban}
        title={t("assistant.s.blockedCount", { count: f.deniedCount })}
        meta={t("assistant.s.blockedWhy")}
      />,
    );
  }
  return { meta: t("assistant.s.allowed", { count: granted.length }), body };
}

function helpTopic(f: any, { t }: WidgetHelpers): Card {
  if (!f.topicsMatched) {
    return {
      meta: null,
      body: [<EmptyState key="e" icon={BookOpen} title={t("assistant.empty.help")} subtitle={String(f.query)} />],
    };
  }
  const body: React.ReactNode[] = [];
  if (f.explanation) {
    body.push(
      <div key="why" className="px-4 py-3 ds-body" style={{ color: "var(--text-secondary)" }}>
        {f.explanation}
      </div>,
    );
  }
  (f.steps ?? []).forEach((step: string, index: number) => {
    body.push(<ListRow key={`step-${index}`} title={step} icon={List} />);
  });
  for (const [index, bullet] of (f.whatYouCanDo ?? []).entries()) {
    body.push(
      <div key={`bullet-${index}`} className="px-4 py-2 ds-body" style={{ color: "var(--text-secondary)" }}>
        {`• ${bullet}`}
      </div>,
    );
  }
  for (const related of f.related ?? []) {
    body.push(<ListRow key={`rel-${related.title}`} icon={BookOpen} title={related.title} description={related.explanation ?? undefined} />);
  }
  return { meta: t("assistant.s.fromGuide"), body };
}

const RENDERERS: Record<string, (f: any, helpers: WidgetHelpers) => Card> = {
  sales_summary: salesSummary,
  profit_summary: profitSummary,
  customer_account: customerAccount,
  product_stock: productStock,
  low_stock: lowStock,
  sale_lookup: saleLookup,
  supplier_dues: supplierDues,
  employee_activity: employeeActivity,
  my_abilities: myAbilities,
  help_topic: helpTopic,
};

export default function AssistantWidget({
  widget,
  onAsk,
}: {
  widget: Widget;
  onAsk: (text: string) => void;
}) {
  const t = useT() as unknown as T;
  const navigate = useNavigate();
  const render = RENDERERS[widget.tool];
  const { meta, body } = render
    ? render(widget.facts ?? {}, { t, onAsk })
    : { meta: null, body: [<EmptyState key="e" icon={Info} title={t("assistant.empty.card")} />] };
  // The server's title is English; the heading is read in the language this screen is in.
  const titleKey = toolTitleKey(widget.tool);
  // Where the same thing can be acted on. The server names that screen in English, so it is not
  // printed: the card says what it is, and one small mark goes there. Nothing the answer needs is
  // behind it — the answer is above, in the conversation.
  const screen = (widget.sources ?? [])[0];

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 px-4 mb-2">
        <p className="ds-section flex-1 min-w-0">
          {titleKey ? t(titleKey) : widget.title}
          {meta ? ` · ${meta}` : ""}
        </p>
        {screen?.route && (
          <button
            type="button"
            onClick={() => navigate(screen.route)}
            aria-label={t("assistant.openScreen")}
            className="ds-pressable flex items-center justify-center shrink-0"
            style={{ width: 28, height: 28, color: "var(--text-tertiary)" }}
          >
            <ChevronRight size={16} strokeWidth={1.5} className="ds-glyph-sm" />
          </button>
        )}
      </div>
      <div className="px-4">
        <ListCard>{body}</ListCard>
      </div>
      {(widget.notes ?? []).map((text, index) => (
        <Note key={index} text={text} />
      ))}
    </div>
  );
}
