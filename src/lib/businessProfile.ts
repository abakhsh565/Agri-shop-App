import { supabase } from "@/lib/supabase";

/**
 * What the business said about itself, as the server holds it.
 *
 * `shop` is the row the business lives in; `registration` is the signup record the approval
 * queue kept, linked back by owner phone and shop name (migration 0247). `registration` is
 * `null` when no single record can be linked to this business — a real answer the screen shows
 * as "not linked", never as a set of blanks that look like the owner skipped the form.
 *
 * Every field is nullable because every one of them can genuinely be absent: a column missing
 * from an older lineage, a question the form marked optional, or a record this business never
 * had.
 */
export interface BusinessProfileShop {
  id: string | null;
  name: string | null;
  phone: string | null;
  /** The number a customer can reach the business on over WhatsApp, if the owner gave one. */
  whatsapp_phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  /** retail · wholesale · both — the same three answers the signup form offers. */
  shop_type: string | null;
  registration_number: string | null;
  logo_url: string | null;
  /**
   * The three papers the business keeps on its own record: a path in the private
   * `business-documents` bucket when the owner added or replaced one here, or a full URL when the
   * picture came from the signup form. `null` means nothing has been added at all.
   */
  licence_url: string | null;
  cnic_front_url: string | null;
  cnic_back_url: string | null;
  join_code: string | null;
  created_at: string | null;
  marketplace_enabled: boolean | null;
  latitude: number | null;
  longitude: number | null;
  location_label: string | null;
  owner_name: string | null;
  owner_phone: string | null;
}

export interface BusinessProfileRegistration {
  shop_name: string | null;
  shop_type: string | null;
  shop_city: string | null;
  shop_address: string | null;
  business_registration_number: string | null;
  logo_url: string | null;
  submitted_at: string | null;
}

/**
 * The images the business submitted when it applied — the logo, the licence and the two sides
 * of a CNIC.
 *
 * Returned to an active owner/admin of THIS business only (migration 0249): the function refuses
 * the call for anyone else rather than blanking the fields. They are shown, never edited — the
 * approval record is what the business was admitted on, and replacing it is a re-review.
 */
export interface BusinessDocuments {
  logo: string | null;
  licence: string | null;
  cnic_front: string | null;
  cnic_back: string | null;
}

export interface BusinessProfile {
  shop: BusinessProfileShop;
  registration: BusinessProfileRegistration | null;
  /** `null` when no approval record could be linked to this business. */
  documents: BusinessDocuments | null;
}

/**
 * Read the profile of the business this account is working in.
 *
 * The function takes no shop argument on purpose — the server answers for `current_shop_id()`,
 * so this read can never name another business. It refuses a caller who is not an active
 * owner/admin there, and the screen reports that refusal instead of rendering half a page.
 */
export async function loadBusinessProfile(): Promise<BusinessProfile | null> {
  const { data, error } = await supabase.rpc("get_business_profile");
  if (error) throw new Error(error.message);
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (!parsed || !parsed.shop) return null;
  return parsed as BusinessProfile;
}

/**
 * One edit, named by the field it changes.
 *
 * ONLY THE KEYS THAT CHANGED ARE SENT, and the database reads that literally: a key that is
 * absent leaves its column alone, a key present with an empty string clears an optional field.
 * That is why the server takes a patch rather than one parameter per column — a positional NULL
 * cannot say which of those two things the screen meant.
 *
 * `update_business_profile` refuses a caller who is not an active owner/admin of the current
 * shop, so this can only ever write the business the screen is showing.
 */
export type BusinessPatch = Partial<{
  name: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  city: string;
  type: string;
  registration: string;
  logo: string;
  /** A path inside this business's folder of `business-documents`, or the https URL of an older picture. */
  licence: string;
  cnic_front: string;
  cnic_back: string;
}>;

export async function updateBusinessProfile(patch: BusinessPatch): Promise<BusinessProfileShop> {
  const { data, error } = await supabase.rpc("update_business_profile", { p_patch: patch });
  if (error) throw new Error(error.message);
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (!parsed?.shop) throw new Error("NO_RECORD");
  return parsed.shop as BusinessProfileShop;
}
