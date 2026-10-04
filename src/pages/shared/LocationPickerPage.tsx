import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, LocateFixed } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
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
 * Where something is — chosen on a map, never typed, on a page of its own.
 *
 * THE RULE, IN ONE SCREEN. A typed address is not a location: "near the bus stop, Chak 42"
 * cannot be routed to and two people write it two ways. So this page has NO text input for the
 * location itself. What it offers is a search (which asks a map service), a list of what that
 * service found, and a small "use my current location" action — and what it hands back is a
 * point plus the address the SERVICE returned (`lib/geo.ts`), never a string assembled from a
 * keyboard.
 *
 * It used to be a bottom sheet. It is a page now because picking a place is a process — search,
 * check, sometimes retry — and a sheet that has to hold a result list, its states and an
 * attribution line was doing a page's job in a panel. Which screen opened it, and where the
 * chosen point has to go back to, travel in the router state (`from`, and `pickedPlace` on the
 * way back); no other part of the app has to know this screen exists.
 *
 * PAKISTAN, TWICE. The search asks for `countrycodes=pk` and every row that comes back is checked
 * against the service's own `country_code`; a coordinate from the phone is reverse-geocoded and
 * checked the same way. When nothing in Pakistan matches, the page says exactly that instead of
 * showing a neighbouring country's result. The database refuses the same thing again (0172), so
 * a point outside the country cannot be stored even if this page is wrong.
 */

/** Nominatim's usage policy asks for light use; one search per pause is what that means. */
const SEARCH_DEBOUNCE_MS = 500;
/** The same floor the provider applies, imported rather than restated so the two cannot drift. */
const MIN_QUERY = MIN_SEARCH_LENGTH;

export default function LocationPickerPage() {
  const t = useT();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const isUrdu = useThemeStore((s) => s.language) === "ur";
  const provider = mapProvider();

  /** Which screen is waiting for the answer, and whether it already has a point to show. */
  const state = (routeLocation.state as { from?: string; value?: PickedPlace | null } | null) ?? {};
  const from = state.from;

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PickedPlace[]>([]);
  /** `idle` is "nothing asked yet", which is not the same as a search that found nothing. */
  const [searchState, setSearchState] = useState<"idle" | "searching" | "empty" | "unreachable" | "locating" | "outside">("idle");
  const searchSeq = useRef(0);

  // One search per pause in typing. The sequence number matters: a slow answer to an earlier
  // query must not overwrite the results of a later one.
  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_QUERY) {
      setHits([]);
      setSearchState("idle");
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      setSearchState("searching");
      try {
        const found = await provider.search(text);
        if (seq !== searchSeq.current) return;
        setHits(found);
        setSearchState(found.length ? "idle" : "empty");
      } catch (e) {
        if (seq !== searchSeq.current) return;
        setHits([]);
        // "Could not reach the map" and "the map found nothing" need different words, so they are
        // different states rather than one empty list.
        setSearchState(e instanceof GeoError && e.kind === "unreachable" ? "unreachable" : "unreachable");
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, provider]);

  /** Leaving without a choice is a normal outcome, so it is just going back. */
  function close() {
    if (from) navigate(from, { replace: true });
    else navigate(-1);
  }

  /** The chosen point, handed back to the screen that opened this one. */
  function pick(place: PickedPlace) {
    if (from) navigate(from, { state: { pickedPlace: place }, replace: true });
    else navigate(-1);
  }

  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      setSearchState("unreachable");
      return;
    }
    setSearchState("locating");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        const check = await reverseInPakistan(point, provider);
        if (check.status === "outside") { setSearchState("outside"); return; }
        if (check.status === "unreachable") { setSearchState("unreachable"); return; }
        const label = check.address?.split(",")[0]?.trim() || t("location.myLocation");
        pick({
          ...point,
          label,
          address: check.address,
          source: provider.name,
          countryCode: check.countryCode,
        });
      },
      () => setSearchState("unreachable"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={t("location.sheetTitle")} onBack={close} />

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

        {/* A small text control under the search, not a full-width button: using the current
            position is the second thing a person might do, not the first, and at button size it
            competed with the search it belongs to. */}
        <button
          type="button"
          onClick={useCurrentLocation}
          data-testid="location-use-current"
          className="self-start inline-flex items-center gap-1.5 h-8 text-12 font-bold ds-pressable disabled:opacity-50"
          style={{ color: "var(--brand-dark)" }}
        >
          <LocateFixed size={14} />
          {searchState === "locating" ? t("location.searching") : t("location.useCurrent")}
        </button>

        {searchState === "searching" && (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("location.searching")}</p>
        )}
        {/* The one sentence the requirement asks for, said exactly as asked. */}
        {searchState === "empty" && (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }} data-testid="location-empty">
            {t("location.nothingInPakistan")}
          </p>
        )}
        {searchState === "outside" && (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }} data-testid="location-outside">
            {t("location.outsidePakistan")}
          </p>
        )}
        {searchState === "unreachable" && (
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
    </div>
  );
}
