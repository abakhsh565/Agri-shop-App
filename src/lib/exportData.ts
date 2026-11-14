/**
 * Quick export, for every screen with an overflow menu.
 *
 * ONE IMPLEMENTATION, because "export this" means the same four things everywhere: build rows from
 * what the screen already holds, write them as CSV, and hand them to the platform — a share sheet
 * on a phone, a download in a browser. Each screen used to be on its own for this, so some exported
 * nothing, one printed a page, and none of them agreed on a file name.
 *
 * No data is fetched here. A screen exports the rows it is already showing, which is the only
 * version of the data the reader can check against the screen in front of them.
 */

export interface CsvColumn<T> {
  /** Header cell in the file. Already translated by the caller. */
  label: string;
  /** The cell's value. Numbers are written as plain digits so a spreadsheet can add them. */
  value: (row: T) => string | number | null | undefined;
}

/** RFC 4180 escaping: quotes double, and any cell containing a comma, quote or newline is quoted. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((c) => cell(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => cell(c.value(row))).join(","));
  return [header, ...body].join("\r\n");
}

/** `sales-2026-10-29.csv` — the screen's own name, then the day it was taken. */
export function csvFileName(screen: string, todayISO = new Date().toISOString().slice(0, 10)): string {
  return `${screen}-${todayISO}.csv`;
}

function saveFile(filename: string, csv: string): void {
  // A BOM so Excel on Windows reads the Urdu names in these files as UTF-8 instead of mojibake.
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some WebViews; one tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ExportOutcome = "shared" | "downloaded";

/**
 * Share the file if the platform can, otherwise download it. Both are "export" from the reader's
 * point of view, so the caller only needs to know which toast to show.
 */
export async function exportCsv(filename: string, csv: string, title: string): Promise<ExportOutcome> {
  const file = new File([csv], filename, { type: "text/csv" });
  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      // A dismissed share sheet is not a failure the reader needs to hear about, but it also did
      // not export anything — fall through so the file still lands somewhere.
      if ((error as DOMException | undefined)?.name === "AbortError") return "shared";
    }
  }
  saveFile(filename, csv);
  return "downloaded";
}

/**
 * THE ONE SHARE PATH for the whole app: the platform's own sheet, or the clipboard.
 *
 * There are three platforms to satisfy and only one of them is a browser:
 *   1. The Android app (Capacitor). `Share.share` opens the system sheet — the one in the
 *      owner's reference: the link preview with its copy button, then Nearby Share, Gmail,
 *      Messages, WhatsApp and the rest of the installed apps. `navigator.share` alone is not
 *      enough there; a WebView can expose it and still draw nothing.
 *   2. A phone browser. `navigator.share` draws the same system sheet.
 *   3. A desktop browser. Neither exists, so the text (and its link) is copied and the caller
 *      says so — never a silent no-op, which is what a share row did before.
 *
 * `url` is passed as its own field, not glued to the text: the platform sheet renders it as a
 * link card with a copy button and lets the receiving app open it, and every app that only takes
 * text still receives it because the clipboard fallback appends it.
 */
export async function shareText(text: string, title: string, url?: string): Promise<ExportOutcome> {
  const payload = { title, text, ...(url ? { url } : {}) };

  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ ...payload, dialogTitle: title });
      return "shared";
    }
  } catch (error) {
    // A dismissed native sheet is a cancel, not a failure to fall through from.
    if ((error as DOMException | undefined)?.name === "AbortError") return "shared";
  }

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(payload);
      return "shared";
    } catch (error) {
      if ((error as DOMException | undefined)?.name === "AbortError") return "shared";
      /* any other refusal falls through to the clipboard */
    }
  }

  await navigator.clipboard?.writeText?.(url ? `${text}\n${url}` : text);
  return "downloaded";
}

/** Backwards-compatible name: the plain-text share is the same path. */
export async function exportText(text: string, title: string, url?: string): Promise<ExportOutcome> {
  return shareText(text, title, url);
}
