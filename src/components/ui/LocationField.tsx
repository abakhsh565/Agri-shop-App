import { useEffect, useRef, useState } from "react";
import { MapPin, LocateFixed, ChevronRight, X } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import {
  GeoError,
  MIN_SEARCH_LENGTH,
  mapProvider,
  reverseInPakistan,
  type PickedPlace,
} from "@/lib/geo";

/**
 * Where something is — chosen on a map, never typed.
 *
 * THE RULE, IN ONE COMPONENT. A typed address is not a location: "near the bus stop, Chak 42"
 * cannot be routed to and two people write it two ways. So this field has NO text input for the
 * location itself. What it offers is a search (which asks a map service), a list of what that
 * service found, and a "use my current location" action — and what it hands back is a point plus
 * the address the SERVICE returned (`lib/geo.ts`), never a string assembled from a keyboard.
 *
 * PAKISTAN, TWICE. The search asks for `countrycodes=pk` and every row that comes back is checked
 * against the service's own `country_code`; a coordinate from the phone is reverse-geocoded and
 * checked the same way. When nothing in Pakistan matches, the screen says exactly that instead of
 * showing a neighbouring country's result. The database refuses the same thing again (0172), so a
 * point outside the country cannot be stored even if this screen is wrong.
 *
 * IT IS ONE SHEET, NOT A ROUTE. Branches, customers and the shop itself all need the same picker,
 * on different screens with different return paths; a sheet keeps the caller's form state exactly
 * where it was and cannot be reached with a stale id.
 */
interface LocationFieldProps {
  /** The picked place, or null when there is none yet. */
  value: PickedPlace | null;
  onChange: (place: PickedPlace | null) => void;
  /** The field's label. Defaults to the word for the thing being located. */
  label?: string;
  /** One line under the label, for the reason — optional, and never a second instruction. */
  hint?: string;
  disabled?: boolean;
  testId?: string;
}

/** Nominatim's usage policy asks for light use; one search per pause is what that means. */
const SEARCH_DEBOUNCE_MS = 500;
/** The same floor the provider applies, imported rather than restated so the two cannot drift. */
const MIN_QUERY = MIN_SEARCH_LENGTH;

export default function LocationField({ value, onChange, label, hint, disabled, testId }: LocationFieldProps) {
  const t = useT();
  const isUrdu = useThemeStore((s) => s.language) === "ur";
  const provider = mapProvider();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PickedPlace[]>([]);
  /** `idle` is "nothing asked yet", which is not the same as a search that found nothing. */
  const [state, setState] = useState<"idle" | "searching" | "empty" | "unreachable" | "locating" | "outside">("idle");
  const searchSeq = useRef(0);

  // One search per pause in typing. The sequence number matters: a slow answer to an earlier
  // query must not overwrite the results of a later one.
  useEffect(() => {
    if (!open) return;
    const text = query.trim();
    if (text.length < MIN_QUERY) {
      setHits([]);
      setState("idle");
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      setState("searching");
      try {
        const found = await provider.search(text);
        if (seq !== searchSeq.current) return;
        setHits(found);
        setState(found.length ? "idle" : "empty");
      } catch (e) {
        if (seq !== searchSeq.current) return;
        setHits([]);
        // "Could not reach the map" and "the map found nothing" need different words, so they are
        // different states rather than one empty list.
        setState(e instanceof GeoError && e.kind === "unreachable" ? "unreachable" : "unreachable");
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open, provider]);

  function close() {
    setOpen(false);
    setQuery("");
    setHits([]);
    setState("idle");
  }

  function pick(place: PickedPlace) {
    onChange(place);
    close();
  }

  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      setState("unreachable");
      return;
    }
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        const check = await reverseInPakistan(point, provider);
        if (check.status === "outside") { setState("outside"); return; }
        if (check.status === "unreachable") { setState("unreachable"); return; }
        const label = check.address?.split(",")[0]?.trim() || t("location.myLocation");
        pick({
          ...point,
          label,
          address: check.address,
          source: provider.name,
          countryCode: check.countryCode,
        });
      },
      () => setState("unreachable"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const preview = value ? provider.previewUrl(value, 96) : null;

  return (
    <div data-testid={testId}>
      <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
        {label ?? t("location.fieldLabel")}
      </p>

      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="w-full rounded-[var(--radius-card)] p-3 text-start flex items-center gap-3 ds-pressable disabled:opacity-50"
        style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        data-testid={testId ? `${testId}-open` : undefined}
      >
        {/* The tile, when there is one: a picture of the pin is what makes a wrong town obvious
            at a glance, which no amount of address text does. */}
        {preview ? (
          <img
            src={preview}
            alt=""
            width={72}
            height={72}
            className="rounded-[var(--radius-tile)] shrink-0 object-cover"
            style={{ width: 72, height: 72, background: "var(--surface)" }}
          />
        ) : (
          <span
            className="rounded-[var(--radius-tile)] shrink-0 flex items-center justify-center"
            style={{ width: 72, height: 72, background: "var(--surface)", border: "1px solid var(--divider)" }}
          >
            <MapPin size={22} style={{ color: "var(--text-secondary)" }} />
          </span>
        )}

        <span className="min-w-0 flex-1">
          {/* The picked place's own words, so `dir="auto"` as on the result rows above. The two
              fallback sentences are the app's and are covered by the page's direction. */}
          <span
            className="block text-sm font-bold truncate"
            dir={value ? "auto" : undefined}
            style={{ color: value ? "var(--text-primary)" : "var(--text-secondary)" }}
          >
            {value ? value.label : t("location.chooseOnMap")}
          </span>
          <span
            className="block text-11 mt-0.5 truncate"
            dir={value ? "auto" : undefined}
            style={{ color: "var(--text-secondary)" }}
          >
            {value?.address ?? t("location.notTyped")}
          </span>
        </span>

        {value && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("location.clear")}
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange(null); } }}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
            data-testid={testId ? `${testId}-clear` : undefined}
          >
            <X size={14} style={{ color: "var(--text-secondary)" }} />
          </span>
        )}
      </button>
      {/*
       * The hint is only drawn once there is a place to replace it.
       *
       * Empty, the field's own second line IS the hint ("locations are picked on the map, not
       * typed") — showing it again underneath said the same sentence twice, in the state where a
       * person is looking hardest for what to do. With a place set, that line shows the address
       * instead, so the explanation is no longer on screen and the hint has a job again.
       */}
      {hint && value && <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{hint}</p>}

      <Sheet open={open} title={t("location.sheetTitle")} onClose={close} closeButton>
        <div className="flex flex-col gap-3 p-4">
          {/* A search box, not a location box: what is typed here is a QUESTION, and the answer
              is a row below that carries a point. Nothing in this field is ever stored. */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("location.searchPlaceholder")}
            className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
            data-testid="location-search"
          />

          <Button variant="outline" size="md" fullWidth onClick={useCurrentLocation} loading={state === "locating"}>
            <span className="inline-flex items-center gap-2">
              <LocateFixed size={16} />
              {t("location.useCurrent")}
            </span>
          </Button>

          {state === "searching" && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("location.searching")}</p>
          )}
          {/* The one sentence the requirement asks for, said exactly as asked. */}
          {state === "empty" && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }} data-testid="location-empty">
              {t("location.nothingInPakistan")}
            </p>
          )}
          {state === "outside" && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }} data-testid="location-outside">
              {t("location.outsidePakistan")}
            </p>
          )}
          {state === "unreachable" && (
            <p className="text-xs" style={{ color: "var(--error)" }} data-testid="location-unreachable">
              {t("location.unreachable")}
            </p>
          )}

          {hits.length > 0 && (
            <ListCard>
              {hits.map((hit, i) => (
                <ListRow
                  key={`${hit.lat},${hit.lng},${hit.label}`}
                  onClick={() => pick(hit)}
                  testId={`location-hit-${i}`}
                  /* A chevron, not a tick: a tick on every row says "chosen" about rows that are
                     only being offered, and the one thing this list must not do is suggest a
                     location has been picked when it has not. */
                  trailing={
                    <ChevronRight size={16} className={isUrdu ? "rotate-180" : ""} style={{ color: "var(--text-secondary)" }} />
                  }
                >
                  {/* `dir="auto"` because these two lines are the SERVICE's words, not the app's:
                      an address can be mostly English with one Urdu street name in it (or the
                      reverse), and read with the interface's direction the odd run lands at the
                      wrong end of the line. `auto` lets each string decide from its own first
                      strong character, which is the only thing that can be right for both. */}
                  <span className="min-w-0 block">
                    <span className="block text-sm font-semibold truncate" dir="auto" style={{ color: "var(--text-primary)" }}>
                      {hit.label}
                    </span>
                    {hit.address && (
                      <span className="block text-11 truncate" dir="auto" style={{ color: "var(--text-secondary)" }}>
                        {hit.address}
                      </span>
                    )}
                  </span>
                </ListRow>
              ))}
            </ListCard>
          )}

          {/* Required by the service whose data this is, and shown wherever its data appears.
              `bdi dir="ltr"` and not a bare string: the attribution is a fixed English credit with
              a © in front of it, and in an RTL interface the neutral © attaches to the right-hand
              end, so the line rendered as "OpenStreetMap contributors ©" — the credit reordered by
              the language of the screen it is credited on. The <bdi> isolates the run so it reads
              the same in both languages, while the paragraph keeps the page's own alignment. */}
          <p className="text-10" style={{ color: "var(--text-secondary)" }} data-testid="location-attribution">
            <bdi dir="ltr">{provider.attribution}</bdi>
          </p>
        </div>
      </Sheet>
    </div>
  );
}
