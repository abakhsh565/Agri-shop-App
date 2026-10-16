/**
 * The location picker's own half, proved without a network.
 *
 * A location is the one thing in this app that must never be invented: a wrong point sends a
 * delivery to the wrong village, and a typed address cannot be corrected by looking at it. So the
 * parts that can be held to account offline are held here — what a provider's answer becomes, what
 * happens when the answer has no coordinates, and the difference between "nothing found" and "the
 * service could not be reached", which are two different sentences on screen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GeoError,
  isLatLng,
  isStorablePlace,
  mapProvider,
  openStreetMapProvider,
  placeFromNominatim,
  reverseInPakistan,
} from "../../src/lib/geo";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("what a picked location is", () => {
  it("keeps the coordinates, the name a person reads, and the full address", () => {
    const place = placeFromNominatim(
      {
        place_id: 12,
        lat: "30.6612",
        lon: "73.1054",
        name: "Main Bazaar",
        display_name: "Main Bazaar, Sahiwal, Punjab, Pakistan",
        address: { road: "Main Bazaar", city: "Sahiwal", country_code: "pk" },
      },
      "openstreetmap",
    );
    expect(place).toMatchObject({ lat: 30.6612, lng: 73.1054, label: "Main Bazaar" });
    expect(place?.address).toContain("Sahiwal");
    expect(place?.source).toBe("openstreetmap");
    expect(place?.countryCode).toBe("pk");
  });

  it("falls back to the street when the service gave no name", () => {
    const place = placeFromNominatim(
      {
        lat: "31.5",
        lon: "74.3",
        display_name: "Some Road, Lahore",
        address: { road: "Some Road", city: "Lahore", country_code: "PK" },
      },
      "openstreetmap",
    );
    expect(place?.label).toBe("Some Road, Lahore");
  });

  it("refuses a result with no usable coordinates instead of inventing 0,0", () => {
    // 0,0 is a real place in the Atlantic. A place with no point is not a place.
    expect(placeFromNominatim({ display_name: "Nowhere" }, "openstreetmap")).toBeNull();
    expect(placeFromNominatim({ lat: "abc", lon: "12" }, "openstreetmap")).toBeNull();
    expect(placeFromNominatim({ lat: "30", lon: undefined }, "openstreetmap")).toBeNull();
  });

  it("drops anything that is not in Pakistan, whatever the request asked for", () => {
    // The second lock. The request carries countrycodes=pk, and this is what happens when a
    // service, a proxy or a cache ignores it: the row is dropped, not shown for the person to
    // notice for themselves.
    const inPakistan = { lat: "30.6", lon: "73.1", display_name: "Sahiwal", address: { country_code: "pk" } };
    const inIndia = { lat: "28.6", lon: "77.2", display_name: "Delhi", address: { country_code: "in" } };
    // A row that never says which country it is in is not evidence of Pakistan either.
    const silent = { lat: "30.6", lon: "73.1", display_name: "Somewhere" };

    expect(placeFromNominatim(inPakistan, "openstreetmap")?.countryCode).toBe("pk");
    expect(placeFromNominatim(inIndia, "openstreetmap")).toBeNull();
    expect(placeFromNominatim(silent, "openstreetmap")).toBeNull();
    // The code is compared as the service writes it, not as we hope it writes it.
    expect(placeFromNominatim({ ...inPakistan, address: { country_code: "PK" } }, "osm")?.countryCode).toBe("pk");
  });

  it("only stores a location the map service actually returned, inside Pakistan", () => {
    const good = placeFromNominatim(
      { lat: "30.6", lon: "73.1", name: "Shop", address: { country_code: "pk" } },
      "openstreetmap",
    );
    expect(isStorablePlace(good)).toBe(true);
    // A typed address has no coordinates and no country — it cannot be stored, by construction.
    expect(isStorablePlace({ label: "near the bus stop" } as never)).toBe(false);
    // A point abroad cannot be stored even if somebody assembles the object by hand.
    expect(isStorablePlace({ lat: 28.6, lng: 77.2, label: "Delhi", address: null, source: "x", countryCode: "in" })).toBe(false);
  });

  it("refuses a coordinate outside the world", () => {
    expect(isLatLng({ lat: 30.1, lng: 73.2 })).toBe(true);
    expect(isLatLng({ lat: 91, lng: 73 })).toBe(false);
    expect(isLatLng({ lat: 30, lng: 200 })).toBe(false);
    expect(isLatLng(null)).toBe(false);
    expect(isLatLng({ lat: Number.NaN, lng: 73 })).toBe(false);
  });
});

describe("the map service", () => {
  it("tells 'nothing found' apart from 'could not be reached'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(openStreetMapProvider.search("Sahiwal")).rejects.toMatchObject({ kind: "unreachable" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    await expect(openStreetMapProvider.search("Sahiwal")).resolves.toEqual([]);
  });

  it("treats the trailing town as a hint when the whole phrase finds nothing", async () => {
    // Measured on the live service: "Ghanta Ghar Faisalabad" answers NOTHING (that exact string is
    // not in the map's data) while "Ghanta Ghar" finds three clock towers. A person naming a
    // landmark and its city in one breath got "No location found in Pakistan" for a place that is
    // there, so the last word is dropped once — and only once.
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { lat: "31.41", lon: "73.07", name: "Ghanta Ghar", display_name: "Ghanta Ghar, Faisalabad", address: { country_code: "pk" } },
        ],
      });
    vi.stubGlobal("fetch", fetchSpy);

    const hits = await openStreetMapProvider.search("Ghanta Ghar Faisalabad");
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe("Ghanta Ghar");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(encodeURIComponent("Ghanta Ghar Faisalabad"));
    expect(String(fetchSpy.mock.calls[1][0])).toContain(encodeURIComponent("Ghanta Ghar"));
  });

  it("puts the rows in the town the person named first", async () => {
    // The dropped word is not noise — it is what they were narrowing by. With clock towers in
    // several cities, asking for "Ghanta Ghar Faisalabad" must not lead with Multan's.
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { lat: "30.2", lon: "71.5", name: "Ghanta Ghar", display_name: "Ghanta Ghar, Multan, Punjab, Pakistan", address: { city: "Multan", country_code: "pk" } },
          { lat: "31.4", lon: "73.1", name: "Ghanta Ghar", display_name: "Ghanta Ghar, Faisalabad, Punjab, Pakistan", address: { city: "Faisalabad", country_code: "pk" } },
        ],
      });
    vi.stubGlobal("fetch", fetchSpy);

    const hits = await openStreetMapProvider.search("Ghanta Ghar Faisalabad");
    expect(hits).toHaveLength(2);
    expect(hits[0].address).toContain("Faisalabad");
    // Nothing is hidden — the other town is still offered, just second.
    expect(hits[1].address).toContain("Multan");
  });

  it("keeps the country filter on the second attempt too", async () => {
    // The hint must not become a way around the rule: both requests carry `countrycodes=pk`, and a
    // row the second one returns outside Pakistan is still dropped.
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { lat: "25.2", lon: "55.3", name: "Dubai Mall", display_name: "Dubai Mall, Dubai", address: { country_code: "ae" } },
        ],
      });
    vi.stubGlobal("fetch", fetchSpy);

    expect(await openStreetMapProvider.search("Dubai Mall Something")).toEqual([]);
    for (const call of fetchSpy.mock.calls) expect(String(call[0])).toContain("countrycodes=pk");
  });

  it("does not search for a word or two — a shop cannot be found from 'ab'", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await openStreetMapProvider.search("ab")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a search answer onto places, dropping the rows it cannot place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { lat: "30.66", lon: "73.10", name: "Shop", display_name: "Shop, Sahiwal", address: { country_code: "pk" } },
          { display_name: "Broken row with no point" },
          { lat: "28.6", lon: "77.2", name: "Delhi", display_name: "Delhi", address: { country_code: "in" } },
        ],
      }),
    );
    const hits = await openStreetMapProvider.search("Sahiwal");
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe("Shop");
  });

  it("answers with the address at a point, and says which country it is in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ display_name: "Sahiwal, Punjab", address: { country_code: "pk" } }),
      }),
    );
    expect(await openStreetMapProvider.reverse({ lat: 30.6, lng: 73.1 })).toEqual({
      address: "Sahiwal, Punjab",
      countryCode: "pk",
    });
  });

  it("refuses to reverse a point outside Pakistan, and says the service was unreachable differently", async () => {
    // Outside the country: a definite answer, and the one the screen shows as
    // "No location found in Pakistan."
    const abroad = {
      search: async () => [],
      reverse: async () => ({ address: "Delhi, India", countryCode: "in" }),
      previewUrl: () => null,
      name: "test",
      attribution: "test",
    };
    expect(await reverseInPakistan({ lat: 28.6, lng: 77.2 }, abroad)).toEqual({ status: "outside" });

    // The service could not be asked. NOT the same sentence: one is a fact about the place, the
    // other is a fact about the phone.
    const offline = { ...abroad, reverse: async () => { throw new GeoError("unreachable", "offline"); } };
    expect(await reverseInPakistan({ lat: 30.6, lng: 73.1 }, offline)).toEqual({ status: "unreachable" });

    const inPakistan = { ...abroad, reverse: async () => ({ address: "Sahiwal", countryCode: "pk" }) };
    expect(await reverseInPakistan({ lat: 30.6, lng: 73.1 }, inPakistan)).toEqual({
      status: "ok",
      address: "Sahiwal",
      countryCode: "pk",
    });
  });

  it("asks the search for Pakistan only", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", fetchSpy);
    await openStreetMapProvider.search("Main Bazaar");
    expect(String(fetchSpy.mock.calls[0][0])).toContain("countrycodes=pk");
  });

  it("is served behind one seam, so the provider can change without the screens changing", () => {
    const provider = mapProvider();
    expect(provider.name).toBe("openstreetmap");
    // The three methods the picking screen needs, and no vendor detail above them.
    expect(typeof provider.search).toBe("function");
    expect(typeof provider.reverse).toBe("function");
    // The BASEMAP is asked for here too, and it is deliberately a separate answer to a separate
    // question: OpenFreeMap serves vector tiles but does no geocoding at all, so the two come
    // from different services and only meet on the picking screen.
    expect(typeof provider.mapStyle).toBe("function");
    // There is no `previewUrl` any more. It drew a 72px snapshot of a raster basemap that the
    // picker no longer draws on, and keeping it would mean two services behind one decision.
    expect("previewUrl" in provider).toBe(false);
  });

  it("draws the basemap for the app's own theme, and credits both services", () => {
    const provider = mapProvider();
    // A pale, high-contrast style for a phone held up in sun, a dark one for the app's dark
    // theme — asking for one style in both would leave one of them unreadable.
    expect(provider.mapStyle("light")).toContain("positron");
    expect(provider.mapStyle("dark")).toContain("dark");
    expect(provider.mapStyle("light")).not.toBe(provider.mapStyle("dark"));
    // Two services are behind the screen now: the search and address come from OpenStreetMap's
    // data, the tiles from OpenMapTiles. The credit has to name both or the licence is missed.
    expect(provider.attribution).toContain("OpenStreetMap");
    expect(provider.attribution).toContain("OpenMapTiles");
  });

  it("refuses a response that is not ok, rather than reading it as an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    await expect(openStreetMapProvider.search("Sahiwal")).rejects.toBeInstanceOf(GeoError);
  });
});
