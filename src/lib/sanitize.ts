/**
 * Input Sanitization Utilities
 *
 * Protects against XSS, injection, and other input-based attacks.
 * All user inputs should pass through these functions before rendering
 * or sending to the database.
 */

/**
 * Sanitize a string for safe HTML rendering.
 * Escapes all HTML special characters.
 */
export function sanitizeHtml(input: string): string {
  const div = document.createElement("div");
  div.textContent = input;
  return div.innerHTML;
}

/**
 * Sanitize a string for use in SQL queries (belt-and-suspenders).
 * Removes null bytes and common SQL injection patterns.
 * Note: This is a defense-in-depth measure; the primary protection
 * should be parameterized queries via Supabase RPC.
 */
export function sanitizeForQuery(input: string): string {
  return input
    .replace(/\0/g, "") // Remove null bytes
    .replace(/'/g, "''") // Escape single quotes
    .replace(/--/g, "") // Remove SQL comments
    .replace(/;/g, ""); // Remove statement terminators
}

/**
 * Validate and sanitize a phone number.
 * Only allows digits, +, and spaces.
 */
export function sanitizePhone(input: string): string {
  return input.replace(/[^\d+\s()-]/g, "").trim();
}

/**
 * Validate and sanitize a name.
 * Allows letters, spaces, hyphens, and apostrophes only.
 */
export function sanitizeName(input: string): string {
  return input.replace(/[^\w\s'-]/g, "").trim();
}

/**
 * Validate and sanitize a numeric input.
 * Only allows digits and decimal point.
 */
export function sanitizeNumber(input: string): string {
  return input.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

/**
 * Validate and sanitize a barcode.
 * Allows alphanumeric characters and hyphens.
 */
export function sanitizeBarcode(input: string): string {
  return input.replace(/[^\w-]/g, "").toUpperCase().trim();
}

/**
 * Truncate a string to a maximum length.
 */
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return input.slice(0, maxLength - 3) + "...";
}

/**
 * Validate that a string is not empty after trimming.
 */
export function isNonEmpty(input: string): boolean {
  return input.trim().length > 0;
}

/**
 * Validate email format (basic check).
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate that a number is within a range.
 */
export function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Sanitize a filename for storage upload.
 * Removes path traversal characters and special characters.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[\/\\]/g, "") // Remove path separators
    .replace(/\.\./g, "") // Remove parent directory references
    .replace(/[^\w.-]/g, "_") // Replace special chars with underscore
    .slice(0, 255); // Limit length
}

/**
 * Check if a URL is safe (same-origin or whitelisted).
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    // Only allow same-origin or known domains
    return (
      parsed.origin === window.location.origin ||
      parsed.hostname.endsWith(".supabase.co") ||
      parsed.hostname === "fonts.googleapis.com" ||
      parsed.hostname === "fonts.gstatic.com"
    );
  } catch {
    return false;
  }
}
