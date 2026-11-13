import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, LocateFixed, MapPin } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";

/**
 * The map is loaded only when this screen is opened.
 *
 * MapLibre and its worker weigh about 465 KB gzipped between them, which is a great deal to make
 * every route of the app pay for the one route that draws a map. Loaded eagerly it landed inside
 * the main index chunk and was downloaded with the login screen; deferred, it is fetched when
 * somebody actually picks a place, and no other screen is charged for it. The fallback reserves
 * the same height so the search box does not jump when the map arrives.
 */
const LocationMap = lazy(() => import("@/components/ui/LocationMap"));
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

/**
 * How much of the screen the map takes.
 *
 * Big enough to recognise a neighbourhood by — the point of showing a map at all — and small
 * enough that the search and the results list are still above the fold when the keyboard opens.
 */
const MAP_HEIGHT = 300;
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
  /**
   * The place the pin is sitting on right now — from a drag, a tap, or a search row.
   *
   * Held separately from `hits` because it is a different kind of answer: a hit is a candidate
   * somebody might want, this one is a position somebody has actually pointed at, and only this
   * one is offered back to the form.
   */
  const [chosen, setChosen] = useState<PickedPlace | null>(state.value ?? null);
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
    else navigate("/", { replace: true });
  }

  /** The chosen point, handed back to the screen that opened this one. */
  function pick(place: PickedPlace) {
    if (from) navigate(from, { state: { pickedPlace: place }, replace: true });
    else navigate("/", { replace: true });
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

  /**
   * A point dropped on the map. Tapping and dragging both land here, and both go through the
   * same country check the GPS button uses — the map is the one surface where a pin can be put
   * anywhere on the canvas, so this is exactly where a point abroad would arrive.
   *
   * The search box is deliberately NOT filled in. It holds what the person TYPED, and typing into
   * it is what runs a search; writing the address the map resolved into it would fire a search
   * nobody asked for and list a result row for the place already chosen directly above it.
   */
  function handleMapOutcome(outcome: { kind: "picked"; place: PickedPlace } | { kind: "outside" } | { kind: "unreachable" }) {
    if (outcome.kind === "outside") {
      setSearchState("outside");
      return;
    }
    if (outcome.kind === "unreachable") {
      setSearchState("unreachable");
      return;
    }
    setSearchState("idle");
    setChosen(outcome.place);
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title={t("location.sheetTitle")} onBack={close} />

      {/* THE MAP COMES FIRST, because it is the answer and the search is a shortcut to it.
          A list of candidate names with no map beside them asks the person to trust a row; the
          pin is the thing that can be checked, moved and trusted. `flex-1` lets the map take
          whatever height the keyboard leaves it. */}
      <div className="px-4 pt-3">
        <div className="overflow-hidden rounded-[var(--radius-card)]" style={{ height: MAP_HEIGHT }}>
          <Suspense
            fallback={
              <div
                className="w-full h-full"
                style={{ height: MAP_HEIGHT, background: "var(--surface-2)" }}
                data-testid="location-map-loading"
              />
            }
          >
            <LocationMap value={chosen} onOutcome={handleMapOutcome} height={MAP_HEIGHT} testId="location-map" />
          </Suspense>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* A search box, not a location box: what is typed here is a QUESTION, and the answer
            is a row below that carries a point. Nothing in this field is ever stored. */}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("location.searchPlaceholder")}
          className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
          style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
          data-testid="location-search"
        />

        {/* A small text control under the search, not a full-width button: using the current
            position is the second thing a person might do, not the first, and at button size it
            competed with the search it belongs to. It is still a full 44px tall — small in
            WEIGHT, not in target; at its old 32px it was the one undersized control on a screen
            the accessibility lane had never actually been pointed at. */}
        <button
          type="button"
          onClick={useCurrentLocation}
          data-testid="location-use-current"
          className="self-start inline-flex items-center gap-1.5 h-11 text-12 font-bold ds-pressable disabled:opacity-50"
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

        {/*
          The pin the map came back with, and the one control that commits it.

          A DRAG DOES NOT COMMIT ON ITS OWN, and that is the whole difference between this and the
          old screen. Dropping a pin is a question ("is this the right place?") and answering it
          by dropping it again is free; returning to the form the instant a finger lifts would
          make a mis-drop a trip to fix. So the address is shown, and one button says yes.

          Tapping a search ROW is still a commitment, because a row is a deliberate act — and it
          moves the map as well, so the two halves cannot disagree about what is chosen.
        */}
        {chosen && (
          <div
            className="flex flex-col gap-2"
            data-testid="location-chosen"
          >
            <div className="flex items-start gap-2.5">
              <MapPin size={18} className="shrink-0 mt-0.5" style={{ color: "var(--brand-dark)" }} />
              <span className="min-w-0 block">
                <span className="block text-sm font-bold truncate" dir="auto" style={{ color: "var(--text-primary)" }}>
                  {chosen.label}
                </span>
                {chosen.address && (
                  <span className="block text-11 truncate" dir="auto" style={{ color: "var(--text-secondary)" }}>
                    {chosen.address}
                  </span>
                )}
              </span>
            </div>
            <Button fullWidth onClick={() => pick(chosen)} testId="location-use-picked">
              {t("location.useThisLocation")}
            </Button>
          </div>
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

        {/* The attribution is NOT repeated here. It used to stand at the foot of this screen,
            crediting the search service; it now lives inside the map itself, which is where the
            basemap's own credit belongs, and the two words are the same two services. Printing
            the identical line twice on one screen reads as a mistake, and the map's copy is the
            one that sits directly against the data it credits. */}
      </div>
    </div>
  );
}
