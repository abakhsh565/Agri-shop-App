/**
 * Where a shop, a branch or a customer is — picked on a map, never typed.
 *
 * THE RULE THIS FILE EXISTS FOR. A typed address is not a location: "near the bus stop, Chak 42"
 * cannot be routed to, cannot be shown, and two people write it two ways. What the app stores is a
 * point (latitude/longitude) plus the address the map service gave for it, and the only way to
 * produce one is to pick it on a map.
 *
 * ── Pakistan only, in two independent places ───────────────────────────────────────────────
 *
 * This app serves one country, and a location it cannot route to is worse than no location: a
 * shop pinned in the wrong country is a delivery that never arrives. So Pakistan is enforced
 * TWICE, on purpose:
 *
 *   1. the request asks the service for Pakistan only (`countrycodes=pk`), so the service cannot
 *      answer with anything else; and
 *   2. every row that comes back is checked again against the service's own `country_code`, and
 *      anything that is not `pk` is dropped.
 *
 * A filter the caller controls is a convenience; a check the caller performs is the boundary. Both
 * are here because the first can be ignored — by a proxy, a service change, or a cached response —
 * and the second cannot be argued with. Reverse geocoding is held to the same rule: a point outside
 * Pakistan is refused rather than reversed into an address nobody can use.
 *
 * ── One seam, two providers ────────────────────────────────────────────────────────────────
 *
 * The picking screen never talks to a map service directly. It asks a `MapProvider`, and today
 * there is one implementation:
 *
 *   • `openStreetMapProvider` — Nominatim search and reverse geocoding plus OpenStreetMap tiles.
 *     No API key, no billing, works the moment the app is installed, which is why it is first.
 *   • a Google provider — the same three methods, dropped in behind the same interface when a key
 *     exists. Nothing in the screens changes: they ask for a search and a label, not for a vendor.
 *
 * That is the whole reason for the seam: the owner asked for Google later, and a screen that had
 * called Google directly would have to be rewritten (and re-tested, and re-translated) to get it.
 *
 * ── What is NOT in here ────────────────────────────────────────────────────────────────────
 *
 * No storage, no screen, no React. This is the part that can be proved without a device: which
 * fields a place has, how a provider's payload becomes those fields, and what the app does when a
 * provider cannot be reached — which is to say so, and never to invent a coordinate.
 */

/** A point on the earth, in the order the rest of the world writes it. */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A place someone picked.
 *
 * `label` is what a person reads in a list ("Main Bazaar, Sahiwal"), `address` is the fuller line
 * the map service returned, and the point is what everything else uses. Both strings come from the
 * provider: the app never assembles an address out of parts it did not receive.
 */
export interface PickedPlace extends LatLng {
  /** Short name for the row: the first line of whatever the service called it. */
  label: string;
  /** The full address, when the service gave one. Never guessed. */
  address: string | null;
  /** The provider that produced it, so a later change of provider is visible in the data. */
  source: string;
  /**
   * The country the service says this is in, lowercased. Kept on the place rather than discarded
   * after the check: it is the evidence that the check happened, and a row stored without one is a
   * row stored before this rule existed.
   */
  countryCode: string;
}

/** A search result, before it is picked. Same shape — picking adds nothing but intent. */
export type PlaceHit = PickedPlace;

export interface MapProvider {
  /** Stable name, stored with the place (`PickedPlace.source`). */
  readonly name: string;
  /** The attribution the service requires to be shown wherever its data appears. */
  readonly attribution: string;
  /** Search, within the country this app serves — Pakistan, and nothing else. */
  search(query: string, limit?: number): Promise<PlaceHit[]>;
  /** The address at a point, with the country the service says that point is in. */
  reverse(point: LatLng): Promise<ReverseResult>;
  /**
   * A URL for a picture of this point, for the small preview on the picking screen. Providers
   * without one return null and the screen simply shows the address instead of a picture.
   */
  previewUrl(point: LatLng, size?: number): string | null;
}

/** Any failure from a map service, in the app's own words rather than the service's. */
export class GeoError extends Error {
  readonly kind: "unreachable" | "empty";
  constructor(kind: "unreachable" | "empty", message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * The shortest thing worth asking the service about.
 *
 * Three characters: below that a search is noise ("ab" matches half the country), and the one
 * screen that calls this debounces to a pause, so a real search is a real phrase.
 */
export const MIN_SEARCH_LENGTH = 3;

/** Pakistan, when the app only needs somewhere sensible to start a search. */
export const DEFAULT_CENTRE: LatLng = { lat: 30.3753, lng: 69.3451 };

/** The only country this app pins anything in, as the services spell it. */
export const COUNTRY_CODE = "pk";

/** Is this a place in the country this app serves? Compared as the service returns it. */
export function isInPakistan(countryCode: string | null | undefined): boolean {
  return String(countryCode ?? "").trim().toLowerCase() === COUNTRY_CODE;
}

/** What reverse geocoding answered: the address, and the country the service says it is in. */
export interface ReverseResult {
  /** The address line, or null when the service had none for this point. */
  address: string | null;
  /** The service's own country code, lowercased. `null` when it did not say. */
  countryCode: string | null;
}

const NOMINATIM = "https://nominatim.openstreetmap.org";

/**
 * The two shapes Nominatim answers with, as far as this app uses them. Declared here so the
 * mapping below is checked by the compiler rather than trusted.
 */
interface NominatimSearchHit {
  place_id?: number | string;
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  address?: Record<string, string>;
}

/**
 * Map one service result onto a place.
 *
 * Returns null — the row is dropped, not shown greyed out — when the result is not a usable point,
 * or is not in Pakistan. Dropping it here is the second of the two locks: the request already asked
 * for `countrycodes=pk`, and this is what happens when that is ignored.
 */
export function placeFromNominatim(hit: NominatimSearchHit, source: string): PickedPlace | null {
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  // A result with no coordinates is not a location, whatever else it carries: dropping it is the
  // honest answer, and an invented 0,0 would put the shop in the Atlantic.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const countryCode = String(hit.address?.country_code ?? "").trim().toLowerCase();
  if (!isInPakistan(countryCode)) return null;

  const display = String(hit.display_name ?? "").trim();
  const named = String(hit.name ?? "").trim();
  const street = [hit.address?.road, hit.address?.suburb, hit.address?.city ?? hit.address?.town ?? hit.address?.village]
    .filter(Boolean)
    .join(", ");

  const label = named || street || display.split(",")[0]?.trim() || "—";
  return {
    lat,
    lng,
    label,
    address: display || street || null,
    source,
    countryCode,
  };
}

/** One fetch, with the failure the screens need to tell apart from "nothing found". */
async function getJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    // No connection, or the service is blocked. NOT an empty result — an empty result is a
    // successful search that found nothing, and the two need different words on screen.
    throw new GeoError("unreachable", "The map service could not be reached.");
  }
  if (!response.ok) throw new GeoError("unreachable", `The map service answered ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new GeoError("unreachable", "The map service answered with something unreadable.");
  }
}

/**
 * OpenStreetMap, through Nominatim — no key, no account, no billing.
 *
 * Their usage policy asks for light use and a truthful identity; in the built app the WebView
 * sends its own origin, which is what identifies the caller. Searches are debounced by the screen
 * that calls this, and one search is one request.
 */
export const openStreetMapProvider: MapProvider = {
  name: "openstreetmap",
  attribution: "© OpenStreetMap contributors",
  async search(query, limit = 6) {
    const text = query.trim();
    if (text.length < MIN_SEARCH_LENGTH) return [];

    const ask = async (q: string): Promise<PickedPlace[]> => {
      const url =
        `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=${limit}` +
        `&countrycodes=${COUNTRY_CODE}&accept-language=en&q=${encodeURIComponent(q)}`;
      const payload = await getJson(url);
      if (!Array.isArray(payload)) return [];
      // Every row is checked again against its own country code; the filter above is the request,
      // this is the rule.
      return payload
        .map((hit) => placeFromNominatim(hit as NominatimSearchHit, "openstreetmap"))
        .filter((place): place is PickedPlace => place !== null);
    };

    const found = await ask(text);
    if (found.length > 0) return found;

    //
    // THE PLACE AND THE TOWN, TOGETHER.
    //
    // People name a landmark and its city in one breath — "Ghanta Ghar Faisalabad" — and the
    // free-text search answers NOTHING for the pair, because a search is not a place lookup: that
    // exact string is not in the map's data, while "Ghanta Ghar" alone finds three clock towers.
    // Measured on the live service: two words → 0 rows, one word → 3.
    //
    // So the last word is treated as the narrowing hint it usually is: if the whole phrase finds
    // nothing, the search is tried once more without it. Once, not in a loop — this is a hint, not
    // a search that quietly drops half of what somebody asked for — and only when the remaining
    // words are still long enough to be a place. A request that FAILED is never retried here: that
    // is a different answer for the screen (see GeoError), not an empty one.
    //
    const words = text.split(/\s+/);
    if (words.length >= 2) {
      const shorter = words.slice(0, -1).join(" ");
      if (shorter.length >= MIN_SEARCH_LENGTH) {
        const relaxed = await ask(shorter);
        //
        // AND THE DROPPED WORD STILL DECIDES THE ORDER.
        //
        // The hint is what the person was narrowing by — the town. If any row's own address
        // contains it, those rows come first, so "Ghanta Ghar Faisalabad" leads with the Faisalabad
        // clock tower instead of whichever clock tower the map happens to list first. Asked for a
        // place in a town, the town is the answer's first word.
        //
        const town = words[words.length - 1].toLowerCase();
        if (town.length >= MIN_SEARCH_LENGTH) {
          const inTown = (p: PickedPlace) =>
            `${p.label} ${p.address ?? ""}`.toLowerCase().includes(town);
          if (relaxed.some(inTown)) return [...relaxed.filter(inTown), ...relaxed.filter((p) => !inTown(p))];
        }
        return relaxed;
      }
    }
    return found;
  },
  async reverse(point) {
    const url =
      `${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&accept-language=en` +
      `&lat=${point.lat}&lon=${point.lng}`;
    const payload = (await getJson(url)) as { display_name?: string; address?: { country_code?: string } };
    const display = String(payload?.display_name ?? "").trim();
    const countryCode = String(payload?.address?.country_code ?? "").trim().toLowerCase();
    return { address: display || null, countryCode: countryCode || null };
  },
  previewUrl(point, size = 240) {
    // A single tile of the standard OpenStreetMap layer, centred by arithmetic: the tile that
    // contains this point. Enough to confirm the pin landed in the right town, and it needs no
    // map library, no key and no extra script in a WebView that may be offline.
    const zoom = 14;
    const n = 2 ** zoom;
    const x = Math.floor(((point.lng + 180) / 360) * n);
    const latRad = (point.lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
    return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png?size=${size}`;
  },
};

/**
 * The provider the app uses.
 *
 * Swapping in Google later is one function and one key — the screens ask for this, and every one
 * of them keeps working because the interface does not move.
 */
export function mapProvider(): MapProvider {
  return openStreetMapProvider;
}

/**
 * Reverse geocode a point, and say plainly whether it is somewhere this app can use.
 *
 * Three outcomes, because three different sentences are needed on screen: a point in Pakistan with
 * its address, a point outside it ("No location found in Pakistan"), and a service that could not
 * be asked — which is not the same thing as an empty answer and must never be shown as one.
 */
export type ReverseCheck =
  | { status: "ok"; address: string | null; countryCode: string }
  | { status: "outside" }
  | { status: "unreachable" };

export async function reverseInPakistan(
  point: LatLng,
  provider: MapProvider = mapProvider(),
): Promise<ReverseCheck> {
  let result: ReverseResult;
  try {
    result = await provider.reverse(point);
  } catch {
    return { status: "unreachable" };
  }
  if (!isInPakistan(result.countryCode)) return { status: "outside" };
  return { status: "ok", address: result.address, countryCode: result.countryCode as string };
}

/**
 * The last thing checked before a location is stored.
 *
 * Everything a location is allowed to carry is here: a real point on earth, a country this app
 * serves, and a label/address that came from the map service — never from a keyboard. A place that
 * fails any of it is not saved at all.
 */
export function isStorablePlace(place: Partial<PickedPlace> | null | undefined): place is PickedPlace {
  if (!place) return false;
  const { lat, lng, countryCode, label } = place;
  if (!isLatLng({ lat, lng })) return false;
  if (!isInPakistan(countryCode)) return false;
  return typeof label === "string" && label.trim().length > 0;
}

/** Ready-made bounds check, so a coordinate from anywhere can be refused rather than stored. */
export function isLatLng(value: Partial<LatLng> | null | undefined): value is LatLng {
  if (!value) return false;
  const { lat, lng } = value;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
