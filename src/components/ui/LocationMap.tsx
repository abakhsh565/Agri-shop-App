import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { DEFAULT_CENTRE, mapProvider, reverseInPakistan, type LatLng, type PickedPlace } from "@/lib/geo";

/**
 * WHERE A PLACE IS, ON AN ACTUAL MAP — with a pin you can move.
 *
 * WHY THIS EXISTS. The field was search-and-list, and a search is a guess: the person typed a
 * name, the service returned the best row it had, and the only way to correct a wrong town was
 * to go back and type again. A map removes the guess. The pin IS the answer, it is visible, and
 * dragging it a kilometre is faster than retyping anything. It also de-risks the search itself:
 * once the pin can be adjusted by hand, a search result that is slightly off stops being a wrong
 * answer and becomes a starting position.
 *
 * WHY OPENFREEMAP. Vector tiles with no key, no account and no rate limit, over four styles.
 * `positron` is pale and high contrast, which is what stays readable in direct sun on a cheap
 * screen; `dark` follows the app's own theme. Both are OpenMapTiles' OpenStreetMap data, and
 * `MapProvider.attribution` credits it.
 *
 * THE WORKER — WHY THERE IS A LINE ABOVE THE COMPONENT. MapLibre parses tiles in a Web Worker
 * and resolves it through `import.meta.url`. Left to the bundler that specifier is rewritten by
 * dependency pre-bundling, the worker file is never emitted, and the map comes up blank
 * reporting a worker failure that reads like a network problem and is not one. `setWorkerUrl` is
 * the supported answer. It has to run before any map is constructed, so it cannot live in an
 * effect — which is why it is at module scope here.
 *
 * PAKISTAN, TWICE, AND HERE IT IS NOT OPTIONAL. A map is the one place a person can put a pin
 * anywhere on the canvas, including across the border. So every position the pin comes to rest
 * at is run through the same `reverseInPakistan` the GPS button uses, and a point abroad is
 * refused with the same sentence. The database refuses it a third time (0172). A pin that cannot
 * be stored must never be offered as though it could.
 *
 * WHY NO ZOOM BUTTONS. MapLibre's navigation control is a stack of ~29px icon buttons and the
 * accessibility lane freezes undersized targets at zero, so shipping it would fail the build
 * over a control a thumb does not need. Pinch, double-tap and the wheel already do it.
 */
setWorkerUrl(workerUrl);

type Outcome =
  | { kind: "picked"; place: PickedPlace }
  | { kind: "outside" }
  | { kind: "unreachable" };

interface LocationMapProps {
  /** The place already chosen, if there is one; the pin opens on it. */
  value: PickedPlace | null;
  /** Called once a position has been resolved to a place this app is allowed to store. */
  onOutcome: (outcome: Outcome) => void;
  /** How tall the map is. The page gives it what is left between the search and the keyboard. */
  height?: number;
  testId?: string;
}

/** The pin tip sits ON the coordinate, not beside it. */
const PIN_ANCHOR = "bottom" as const;

/**
 * A pin big enough to grab.
 *
 * MapLibre's stock marker is 27×41: under the 44px touch floor, and this pin is not decoration —
 * it is the control the whole screen exists for. It is rebuilt here rather than padded, so the
 * drag handle is a real button the finger can find, and so the app's own brand colour and type
 * scale are what a shop owner sees instead of a third-party teardrop.
 */
function buildPin(label: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", label);
  el.style.cssText =
    "width:48px;height:48px;padding:0;border:0;background:transparent;cursor:grab;" +
    "display:flex;align-items:flex-end;justify-content:center;touch-action:none;";
  el.innerHTML =
    '<svg width="30" height="44" viewBox="0 0 30 44" aria-hidden="true" focusable="false">' +
    '<path d="M15 43C15 43 28.5 27.8 28.5 17A13.5 13.5 0 1 0 1.5 17C1.5 27.8 15 43 15 43Z" ' +
    `fill="var(--brand, #84cc16)" stroke="var(--surface, #fff)" stroke-width="2.5"/>` +
    '<circle cx="15" cy="16.5" r="4.6" fill="var(--surface, #0a0a0a)"/></svg>';
  return el;
}

export default function LocationMap({ value, onOutcome, height = 320, testId }: LocationMapProps) {
  const t = useT();
  const theme = useThemeStore((s) => s.theme);
  const provider = mapProvider();

  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  /**
   * Callbacks the map's own listeners hold, kept in refs so a new function identity on the
   * parent does not tear the map down. Re-rendering a map to hand it a callback is how a pin
   * jumps back under the person's thumb mid-drag.
   */
  const onOutcomeRef = useRef(onOutcome);
  onOutcomeRef.current = onOutcome;
  const tRef = useRef(t);
  tRef.current = t;
  /** Where the pin is, including while it is being dragged and before it resolves. */
  const pinRef = useRef<LatLng | null>(value ? { lat: value.lat, lng: value.lng } : null);
  /**
   * The last position this app is ALLOWED to store.
   *
   * Kept apart from `pinRef` on purpose. A pin dropped in Iran is refused, but if it is left
   * sitting there the map says one country and the address under it says another — two halves
   * of one screen disagreeing about the answer, which is worse than either being vague. So a
   * refused drop puts the pin back where it was last valid and leaves the answer standing.
   */
  const validRef = useRef<LatLng | null>(value ? { lat: value.lat, lng: value.lng } : null);

  const [ready, setReady] = useState(false);

  // A place chosen by SEARCH moves the pin too — otherwise the two halves of the screen disagree.
  useEffect(() => {
    if (!value) return;
    const next: LatLng = { lat: value.lat, lng: value.lng };
    pinRef.current = next;
    validRef.current = next;
    markerRef.current?.setLngLat([next.lng, next.lat]);
    mapRef.current?.jumpTo({ center: [next.lng, next.lat] });
  }, [value]);

  // The theme swaps the style rather than rebuilding the map: a new map would flash grey and
  // drop the pin's position, which is the one thing the person is holding.
  useEffect(() => {
    mapRef.current?.setStyle(provider.mapStyle(theme));
  }, [theme, provider]);

  useEffect(() => {
    const container = holder.current;
    if (!container) return;

    const start = pinRef.current ?? DEFAULT_CENTRE;
    const map = new MapLibreMap({
      container,
      style: provider.mapStyle(theme),
      center: [start.lng, start.lat],
      zoom: pinRef.current ? 13 : 5,
      // MapLibre's own attribution control is a small round "i" button — under the 44px floor,
      // and the lane counts it. The same credit is drawn as text below instead.
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    // `idle`, NOT `load`. `load` waits on every sprite image the style names, and OpenFreeMap's
    // Positron style names one its own sprite sheet does not carry (`circle-11`) — so `load`
    // never arrives, the map sits there correctly drawn behind a spinner that never stops, and
    // the screen looks broken while it is working. `idle` is the honest question: has it finished
    // drawing what it has?
    map.once("idle", () => setReady(true));
    // A tile that fails must not take the screen with it: the pin, the search and the address
    // all still work, and the next pan usually fetches what was missing.
    map.on("error", () => {});

    /**
     * A pin at rest, resolved to an address — or refused, in the app's own words.
     *
     * Runs on `dragend` and click only, never on a frame: the address service allows one request
     * a second and a drag produces hundreds of moves a second. The pin moves freely; only the
     * moment it is let go costs a request.
     */
    async function resolve(point: LatLng) {
      pinRef.current = point;
      const check = await reverseInPakistan(point, provider);
      if (check.status === "outside") {
        snapBack();
        onOutcomeRef.current({ kind: "outside" });
        return;
      }
      if (check.status === "unreachable") {
        snapBack();
        onOutcomeRef.current({ kind: "unreachable" });
        return;
      }
      validRef.current = point;
      onOutcomeRef.current({
        kind: "picked",
        place: {
          ...point,
          label: check.address?.split(",")[0]?.trim() || tRef.current("location.myLocation"),
          address: check.address,
          source: provider.name,
          countryCode: check.countryCode,
        },
      });
    }

    /** Put the pin back on the last position that could actually be stored. */
    function snapBack() {
      const back = validRef.current;
      if (!back) return;
      pinRef.current = back;
      markerRef.current?.setLngLat([back.lng, back.lat]);
      mapRef.current?.easeTo({ center: [back.lng, back.lat], duration: 300 });
    }

    map.on("click", (e) => {
      const point = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      markerRef.current?.setLngLat([e.lngLat.lng, e.lngLat.lat]);
      void resolve(point);
    });

    const marker = new Marker({ draggable: true, anchor: PIN_ANCHOR, element: buildPin(tRef.current("location.movePin")) })
      .setLngLat([start.lng, start.lat])
      .addTo(map);
    markerRef.current = marker;

    marker.on("dragend", () => {
      const at = marker.getLngLat();
      void resolve({ lat: at.lat, lng: at.lng });
    });

    // A WebGL context is scarce and a WebView that opens and closes this screen repeatedly runs
    // out long before the phone runs out of memory. Nothing may outlive the component.
    return () => {
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // The map is built once. `value` and `theme` are applied by the effects above, deliberately
    // not here: as dependencies they would destroy and rebuild the map on every pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="relative overflow-hidden"
      style={{ height, background: "var(--surface-2)" }}
      data-testid={testId}
      data-ready={ready ? "1" : "0"}
    >
      <div ref={holder} className="absolute inset-0" style={{ minHeight: height }} />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-secondary)" }} />
        </div>
      )}

      {/* The credit the tiles' licence requires, as words rather than a small round button. */}
      <p
        className="text-10 absolute bottom-0 inset-inline-start-0 end-0 px-2 py-1 pointer-events-none"
        style={{ color: "var(--text-secondary)", background: "var(--surface)" }}
      >
        <bdi dir="ltr">{provider.attribution}</bdi>
      </p>
    </div>
  );
}
