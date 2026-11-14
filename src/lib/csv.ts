/**
 * CSV, written once.
 *
 * Two screens now send their rows out — the recorded-money ledger and the cash position — and
 * both have to produce a file Excel opens without asking questions. A byte-order mark, CRLF line
 * endings and quoting only where a value needs it are the three details that make the difference,
 * so they live here instead of being restated (and forgotten) per screen.
 *
 * The file is the visible list: callers build the rows from what is on screen, never from a wider
 * read, so the document cannot disagree with the screen it was exported from.
 */

/** One field, quoted only when its own text would break the row. */
export function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The whole document: BOM, CRLF, no trailing newline. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

/** Hand the CSV to the browser's download machinery. No server, no second read. */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
