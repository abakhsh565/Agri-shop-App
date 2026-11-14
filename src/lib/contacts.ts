/**
 * The phone's contact picker, where the browser exposes it.
 *
 * Android Chrome/WebView ships the Contact Picker API; desktop browsers and iOS do not.
 * This is deliberately a capability check rather than a polyfill: there is no native
 * contacts permission this web app can request on those platforms, and a button that
 * pretends to work would be worse than one that says it is unavailable.
 */

export interface PickedContact {
  name: string;
  phone: string;
}

interface RawContact {
  name?: string[];
  tel?: string[];
}

interface ContactsManager {
  select(properties: string[], options?: { multiple?: boolean }): Promise<RawContact[]>;
}

function manager(): ContactsManager | null {
  if (typeof navigator === "undefined") return null;
  const candidate = (navigator as Navigator & { contacts?: ContactsManager }).contacts;
  return candidate && typeof candidate.select === "function" ? candidate : null;
}

export function canPickContact(): boolean {
  return manager() !== null;
}

/**
 * Opens the device picker. `null` means the reader backed out or the phone cannot do it;
 * the caller decides whether that is silent or worth a message.
 */
export async function pickContact(): Promise<PickedContact | null> {
  const contacts = manager();
  if (!contacts) return null;
  const rows = await contacts.select(["name", "tel"], { multiple: false });
  const first = rows[0];
  if (!first) return null;
  const name = (first.name ?? []).find((value) => value.trim())?.trim() ?? "";
  const phone = (first.tel ?? []).find((value) => value.trim())?.trim() ?? "";
  if (!name && !phone) return null;
  return { name, phone };
}
