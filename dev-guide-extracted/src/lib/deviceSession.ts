// Device-session flag: a small localStorage marker of which phone numbers have
// completed sign-in on THIS device (used to decide whether to show the quick
// PIN unlock vs. full OTP). The authoritative session lives in Supabase auth;
// this is only a local UX hint and holds no business data.

const STORE_KEY = "agri_device_session";

function read(): Record<string, boolean> {
  const stored = localStorage.getItem(STORE_KEY);
  if (!stored) return {};
  try {
    return JSON.parse(stored) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function hasDeviceSession(phone: string): boolean {
  return read()[phone] === true;
}

export function saveDeviceSession(phone: string): void {
  const sessions = read();
  sessions[phone] = true;
  localStorage.setItem(STORE_KEY, JSON.stringify(sessions));
}

export function clearDeviceSession(phone: string): void {
  const sessions = read();
  delete sessions[phone];
  localStorage.setItem(STORE_KEY, JSON.stringify(sessions));
}
