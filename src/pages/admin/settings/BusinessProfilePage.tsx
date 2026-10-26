import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BadgeCheck, Camera, Copy, Loader2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Sheet from "@/components/ui/Sheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import BusinessProfileSheet, { type BusinessField } from "@/components/shop/BusinessProfileSheet";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import { useUIStore } from "@/stores/uiStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { copyText } from "@/lib/clipboard";
import { formatPhoneDisplay } from "@/lib/formatters";
import { supabase } from "@/lib/supabase";
import { usePickedLocation } from "@/lib/usePickedLocation";
import type { PickedPlace } from "@/lib/geo";
import { businessDocumentUrl, uploadBusinessDocument, uploadImage } from "@/lib/storage";
import {
  loadBusinessProfile,
  updateBusinessProfile,
  type BusinessPatch,
  type BusinessProfile,
} from "@/lib/businessProfile";

/** The three papers, in the order the signup form asks for them. */
const PAPERS = [
  { key: "licence", labelKey: "business.licence" },
  { key: "cnic_front", labelKey: "business.cnicFront" },
  { key: "cnic_back", labelKey: "business.cnicBack" },
] as const;

type PaperKey = (typeof PAPERS)[number]["key"];
/** What a picture tap can be about: the logo, or one of the papers. */
type ImageKey = "logo" | PaperKey;

/**
 * The business record, in the account-screen grammar: one column of labelled facts, sections
 * separated by full-bleed hairlines, and the way to change a fact sitting on the line it belongs to.
 *
 * WHY THIS SHAPE. The two-column grid read as a form waiting to be filled; a record is read top
 * to bottom, one fact per line, and the eye should never have to decide which column comes next.
 *
 * EVERY LINE CARRIES ITS OWN ADD / CHANGE. There is no Edit for the section: the thing an owner
 * wants to fix is one line, so that line is where the control sits, in the same quiet grey as the
 * rest of the record. Missing values are not hidden — they say so, and offer to be filled.
 *
 * THE HEADINGS ARE THE APP'S HEADINGS. Section labels are `ds-section-label`, the one class that
 * owns every group heading in this app, and the business's own name is the largest thing on the
 * page. A screen that invents its own heading sizes reads as a different product on every tab.
 *
 * THE PHONE IS THE ACCOUNT'S, AND IT IS TICKED. Every account is created by entering a number and
 * confirming a code, so this number is not a claim typed into a field — it is the one the owner
 * proved they hold.
 */
export default function BusinessProfilePage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const { addToast } = useUIStore();
  const user = useAuthStore((s) => s.user);

  const activeShopId = useShopStore((s) => s.activeShopId);

  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [editing, setEditing] = useState<BusinessField | null>(null);
  const [savingPlace, setSavingPlace] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  /** Whichever picture is being read full size — the logo, or one of the papers. */
  const [viewer, setViewer] = useState<{ url: string; title: string; key: ImageKey } | null>(null);
  /** Which picture an upload is running for, so only that tile shows a spinner. */
  const [uploading, setUploading] = useState<ImageKey | null>(null);
  /** The paper URLs, signed and ready to draw. Keyed by paper, because paths expire. */
  const [pictures, setPictures] = useState<Record<string, string | null>>({});

  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKeyRef = useRef<ImageKey | null>(null);
  /**
   * The re-entry guard is a ref, not `uploading`.
   *
   * State is still the old value for the second tap in the same task, so a double tap on a tile
   * would start two uploads while the first is still running. The spinner and the disabled tiles
   * read state because they must re-render; the decision to start reads this.
   */
  const uploadingRef = useRef(false);

  const read = useCallback(async () => {
    try {
      setProfile(await loadBusinessProfile());
      setState("ready");
    } catch {
      setProfile(null);
      setState("failed");
    }
  }, []);

  useEffect(() => { void read(); }, [read, activeShopId]);

  const shop = profile?.shop ?? null;

  // What the server holds for each paper: a path in the private bucket, or an older https URL.
  const rawPictures = useMemo(
    () => ({
      licence: profile?.documents?.licence ?? null,
      cnic_front: profile?.documents?.cnic_front ?? null,
      cnic_back: profile?.documents?.cnic_back ?? null,
    }),
    [profile],
  );

  /**
   * Turn stored paper paths into URLs the screen can draw.
   *
   * The bucket is private (0250), so a bare path has to be signed; a `null` in the result is a
   * picture that could not be reached, and the tile falls back to its placeholder rather than
   * showing a broken image.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        Object.entries(rawPictures).map(async ([key, raw]) => [key, await businessDocumentUrl(raw)] as const),
      );
      if (alive) setPictures(Object.fromEntries(entries));
    })();
    return () => { alive = false; };
  }, [rawPictures]);

  /**
   * The location, written by the one function that knows a place must be a point inside Pakistan
   * (`set_place`, which also audits the change and authorizes `settings.edit`). The city follows
   * the place: the picker's own short name for it is the town the business is in, and it is stored
   * with the same authorization, so the two disagreeing is a failed write rather than a mismatch
   * nobody notices.
   */
  const applyPlace = useCallback(async (place: PickedPlace) => {
    if (!activeShopId) return;
    setSavingPlace(true);
    setPlaceError(null);
    try {
      const { error } = await supabase.rpc("set_place", {
        p_table: "shops",
        p_id: activeShopId,
        p_latitude: place.lat,
        p_longitude: place.lng,
        p_label: place.label,
        p_address: place.address,
        p_source: place.source,
      });
      if (error) throw error;
      await updateBusinessProfile({ city: place.label.slice(0, 100) });
      await read();
      addToast(t("business.addressSaved"), "success");
    } catch {
      setPlaceError(t("business.addressFailed"));
    } finally {
      setSavingPlace(false);
    }
  }, [activeShopId, addToast, read, t]);

  // The picker is a page of its own, so the choice comes back through the router.
  usePickedLocation((place) => void applyPlace(place));

  /** Open the picker, seeded with the point this business already has (if any). */
  function openPlacePicker() {
    const current: PickedPlace | null =
      shop?.latitude != null && shop?.longitude != null
        ? {
            lat: shop.latitude,
            lng: shop.longitude,
            label: shop.location_label ?? shop.city ?? shop.name ?? "",
            address: shop.address,
            // Never written back: the value carried out of the picker is the picked place, with the
            // provider that produced it. This only centres the map on where the business already is.
            source: "stored",
            countryCode: "pk",
          }
        : null;
    navigate("/pick-location", {
      state: { from: `${routeLocation.pathname}${routeLocation.search}`, value: current },
    });
  }

  async function copyShopId() {
    if (!shop?.join_code) return;
    if (!(await copyText(shop.join_code))) { addToast(t("copy.copyFailed"), "error"); return; }
    addToast(t("invite.copied"), "success");
  }

  /** One file input for every picture on the page; the tile that was tapped says where it goes. */
  function pickPicture(key: ImageKey) {
    if (uploadingRef.current) return;
    pendingKeyRef.current = key;
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const key = pendingKeyRef.current;
    pendingKeyRef.current = null;
    if (fileRef.current) fileRef.current.value = "";
    if (!file || !key) return;

    uploadingRef.current = true;
    setUploading(key);
    try {
      if (key === "logo") {
        // The logo is a public picture, like every other image in the app.
        const url = await uploadImage("company-logos", file);
        await updateBusinessProfile({ logo: url });
      } else {
        if (!activeShopId) throw new Error("NO_SHOP");
        // A paper goes to the private bucket, and the record keeps the PATH, never a URL.
        const path = await uploadBusinessDocument(file, activeShopId);
        await updateBusinessProfile({ [key]: path } as BusinessPatch);
      }
      await read();
      addToast(t("business.imageSaved"), "success");
    } catch {
      addToast(t("business.imageFailed"), "error");
    } finally {
      uploadingRef.current = false;
      setUploading(null);
    }
  }

  const phone = formatPhoneDisplay(user?.phone ?? shop?.phone ?? null);
  const shopType = shop?.shop_type ? t(`business.type.${shop.shop_type}`) : null;
  const shopAddress = shop?.address ?? null;
  // The picker writes both, so a row created since then has its own city. An older row only ever
  // had the place's short name, which is the same fact.
  const city = shop?.city ?? shop?.location_label ?? null;

  // The business image, from its own row or — for a business approved before that column
  // existed — from the picture on its approval record.
  const logoUrl = shop?.logo_url ?? profile?.documents?.logo ?? null;

  const changeCta = (has: boolean) => (has ? t("common.change") : t("business.add"));

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="business-profile-page"
    >
      <StatusBar />
      <NavHeader title={t("business.title")} backTo={`${base}/settings`} />
      <div style={{ borderTop: "1px solid var(--divider)" }} />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
        data-testid="business-image-input"
      />

      {state === "loading" && (
        <div className="px-5 pt-5" role="status" aria-busy="true" aria-label={t("business.loading")}>
          <SkeletonList rows={4} />
        </div>
      )}

      {state === "failed" && (
        <div className="px-5 pt-6" data-testid="business-profile-failed">
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("business.loadFailed")}</p>
          <button
            type="button"
            onClick={() => { setState("loading"); void read(); }}
            className="mt-3 h-9 px-4 rounded-full text-12 font-semibold ds-pressable"
            style={{ background: "var(--tone-sunken)" }}
          >
            {t("common.tryAgain")}
          </button>
        </div>
      )}

      {state === "ready" && (
        <>
          {/* ── Who the business is ──────────────────────────────────────────────── */}
          {/* The tile and the name read as one block, the way a plan or a profile does: the
              picture identifies, the name tells, and nothing between them competes. The tile is
              always drawn, so a business without a picture still has somewhere to put one —
              tapping the empty tile opens the picker, tapping a full one opens the picture. */}
          <div className="px-5 pt-6 pb-6 flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => {
                if (uploadingRef.current) return;
                if (logoUrl) setViewer({ url: logoUrl, title: t("business.image"), key: "logo" });
                else pickPicture("logo");
              }}
              disabled={uploading !== null}
              data-testid="business-image"
              aria-label={logoUrl ? t("business.openImage") : t("business.addImage")}
              className="relative size-[68px] rounded-[var(--radius-tile)] overflow-hidden shrink-0 flex items-center justify-center ds-pressable disabled:opacity-60"
              style={{
                background: "var(--tone-card)",
                border: logoUrl ? "none" : "1.5px dashed var(--divider)",
              }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <Camera size={20} style={{ color: "var(--text-tertiary)" }} aria-hidden="true" />
              )}
              {uploading === "logo" && (
                <span className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
                  <Loader2 size={18} className="animate-spin" color="#fff" />
                </span>
              )}
            </button>

            <div className="min-w-0 flex-1">
              <h1 className="text-18 font-semibold break-words leading-snug" data-testid="business-name">
                {shop?.name ?? t("business.noName")}
              </h1>
              <p className="flex items-center gap-1.5 mt-0.5 min-w-0">
                {/* A phone number is left-to-right wherever the reader is: in Urdu the bare
                    string "+92 300 1234567" is reordered by the bidi algorithm and reads
                    "1234567 300 92+", which is a different number. */}
                <span
                  className="text-13 truncate"
                  dir="ltr"
                  style={{ color: "var(--text-secondary)" }}
                  data-testid="business-phone"
                >
                  {phone ?? t("business.notProvided")}
                </span>
                {phone && (
                  <>
                    <BadgeCheck
                      size={14}
                      strokeWidth={2.4}
                      className="shrink-0"
                      style={{ color: "var(--brand-dark)" }}
                      aria-hidden="true"
                      data-testid="business-phone-verified"
                    />
                    <span className="sr-only">{t("business.verified")}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* ── Details ──────────────────────────────────────────────────────────── */}
          <section style={{ borderTop: "1px solid var(--divider)" }} data-testid="business-details">
            <div className="px-5 py-5">
              <h2 className="ds-section-label">{t("business.information")}</h2>

              <div className="mt-4 flex flex-col gap-4">
                <DetailLine
                  label={t("business.name")}
                  value={shop?.name}
                  testId="business-field-name"
                  onChange={() => setEditing("name")}
                  changeLabel={changeCta(Boolean(shop?.name))}
                />
                <DetailLine
                  label={t("business.whatsapp")}
                  value={formatPhoneDisplay(shop?.whatsapp_phone)}
                  testId="business-field-whatsapp"
                  onChange={() => setEditing("whatsapp")}
                  changeLabel={changeCta(Boolean(shop?.whatsapp_phone))}
                />
                <DetailLine
                  label={t("business.email")}
                  value={shop?.email}
                  testId="business-field-email"
                  onChange={() => setEditing("email")}
                  changeLabel={changeCta(Boolean(shop?.email))}
                />
                <DetailLine
                  label={t("business.type")}
                  value={shopType}
                  testId="business-field-type"
                  onChange={() => setEditing("type")}
                  changeLabel={changeCta(Boolean(shopType))}
                />
                <DetailLine
                  label={t("business.regNumber")}
                  value={shop?.registration_number}
                  testId="business-field-registration"
                  onChange={() => setEditing("registration")}
                  changeLabel={changeCta(Boolean(shop?.registration_number))}
                />
                {/* The shop id is not a fact the owner may edit: it is the code their staff and
                    customers use to reach this business, so it only ever gets copied. */}
                <DetailLine
                  label={t("auth.shopId")}
                  value={shop?.join_code}
                  testId="business-field-shop-id"
                  trailing={shop?.join_code ? (
                    <button
                      type="button"
                      onClick={() => void copyShopId()}
                      aria-label={t("invite.copyShopId")}
                      data-testid="business-copy-shop-id"
                      className="size-7 -me-1 rounded-full flex items-center justify-center shrink-0 ds-pressable"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <Copy size={14} />
                    </button>
                  ) : undefined}
                />
              </div>
            </div>
          </section>

          {/* ── Where the business is ───────────────────────────────────────────── */}
          <section style={{ borderTop: "1px solid var(--divider)" }} data-testid="business-address">
            <button
              type="button"
              onClick={openPlacePicker}
              disabled={savingPlace}
              className="w-full text-start px-5 py-5 ds-pressable disabled:opacity-60"
              data-testid="business-address-edit"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="ds-section-label">{t("common.address")}</h2>
                  {/* The place's own name leads, as the branch screen does: it is what a person
                      says out loud, and the full address under it is what a courier reads. */}
                  <p
                    className="mt-2.5 text-15 font-semibold break-words"
                    dir={city ? "auto" : undefined}
                    style={{ color: city ? "var(--text-primary)" : "var(--text-tertiary)" }}
                    data-testid="business-field-city"
                  >
                    {city ?? t("business.noAddress")}
                  </p>
                  {shopAddress && (
                    <p
                      className="text-13 leading-relaxed mt-0.5 text-pretty"
                      dir="auto"
                      style={{ color: "var(--text-secondary)" }}
                      data-testid="business-address-value"
                    >
                      {shopAddress}
                    </p>
                  )}
                </div>
                {savingPlace ? (
                  <Loader2 size={14} className="animate-spin shrink-0 mt-4" style={{ color: "var(--text-secondary)" }} />
                ) : (
                  <span className="text-12 font-semibold shrink-0 mt-4" style={{ color: "var(--text-tertiary)" }}>
                    {changeCta(Boolean(city))}
                  </span>
                )}
              </div>
            </button>
            {placeError && (
              <p className="px-5 pb-4 text-12" style={{ color: "var(--error)" }} role="alert">{placeError}</p>
            )}
          </section>

          {/* ── The pictures the business keeps ──────────────────────────────────── */}
          {/* The owner asked where the pictures they uploaded at signup went, and asked to be able
              to add the ones the form never received. Every slot is drawn whether or not it holds
              anything: a filled tile opens the picture, an empty one opens the picker. Papers live
              in a private bucket, so what is stored is a path and what is drawn is a signed URL. */}
          <section style={{ borderTop: "1px solid var(--divider)" }} data-testid="business-images">
            <div className="px-5 py-5">
              <h2 className="ds-section-label">{t("business.images")}</h2>

              <div className="mt-4 flex items-start gap-3">
                {PAPERS.map((paper) => {
                  const url = pictures[paper.key] ?? null;
                  return (
                    <div key={paper.key} className="flex flex-col items-center gap-1.5" style={{ width: 84 }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (uploadingRef.current) return;
                          if (url) setViewer({ url, title: t(paper.labelKey), key: paper.key });
                          else pickPicture(paper.key);
                        }}
                        disabled={uploading !== null}
                        aria-label={url ? t(paper.labelKey) : t("business.addImage")}
                        data-testid={`business-document-${paper.key}`}
                        className="relative size-[84px] rounded-[var(--radius-tile)] overflow-hidden flex items-center justify-center ds-pressable disabled:opacity-60"
                        style={{
                          background: "var(--tone-card)",
                          border: url ? "none" : "1.5px dashed var(--divider)",
                        }}
                      >
                        {url ? (
                          <img src={url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="flex flex-col items-center gap-1" style={{ color: "var(--text-tertiary)" }}>
                            <Camera size={18} aria-hidden="true" />
                            <span className="text-11 font-medium">{t("business.addImage")}</span>
                          </span>
                        )}
                        {uploading === paper.key && (
                          <span className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
                            <Loader2 size={18} className="animate-spin" color="#fff" />
                          </span>
                        )}
                      </button>
                      <span className="text-11 text-center leading-tight" style={{ color: "var(--text-secondary)" }}>
                        {t(paper.labelKey)}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="mt-3 text-11 leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                {t("business.imagesNote")}
              </p>
            </div>
          </section>

          <div className="pb-8" />
        </>
      )}

      {editing && (
        <BusinessProfileSheet
          shop={shop}
          field={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void read()}
        />
      )}

      <Sheet
        open={viewer !== null}
        title={viewer?.title ?? t("business.images")}
        onClose={() => setViewer(null)}
      >
        {viewer && (
          <div className="px-5 pb-4 flex flex-col gap-4">
            <img src={viewer.url} alt={viewer.title} className="w-full rounded-[var(--radius-tile)]" />
            <button
              type="button"
              onClick={() => {
                const key = viewer.key;
                setViewer(null);
                pickPicture(key);
              }}
              data-testid="business-image-change"
              className="w-full h-11 rounded-full text-13 font-bold ds-pressable"
              style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
            >
              {t("business.changeImage")}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/**
 * One fact on the page: its name, then what it says, then the quiet way to change it.
 *
 * A missing value is an em dash rather than a blank, because "nothing recorded here" is itself
 * information — and the control beside it already offers to fill it in.
 */
function DetailLine({
  label,
  value,
  testId,
  onChange,
  changeLabel,
  trailing,
}: {
  label: string;
  value: string | null | undefined;
  testId?: string;
  onChange?: () => void;
  /** "Add" or "Change", translated by the caller — never an English word written here. */
  changeLabel?: string;
  trailing?: React.ReactNode;
}) {
  const shown = value && value.trim() ? value.trim() : null;
  return (
    <div
      className="flex items-start justify-between gap-3"
      data-testid={testId}
      data-missing={shown ? "false" : "true"}
    >
      <div className="min-w-0">
        <p className="text-13" style={{ color: "var(--text-secondary)" }}>{label}</p>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          <p
            className="text-15 font-semibold break-words"
            style={{ color: shown ? "var(--text-primary)" : "var(--text-tertiary)" }}
            dir={shown ? "auto" : undefined}
          >
            {shown ?? "—"}
          </p>
          {trailing}
        </div>
      </div>

      {onChange && changeLabel && (
        <button
          type="button"
          onClick={onChange}
          data-testid={testId ? `${testId}-change` : undefined}
          className="shrink-0 text-12 font-semibold ds-pressable mt-0.5"
          style={{ color: "var(--text-tertiary)" }}
        >
          {changeLabel}
        </button>
      )}
    </div>
  );
}
