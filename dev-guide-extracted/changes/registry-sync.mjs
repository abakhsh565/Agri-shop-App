#!/usr/bin/env node
// AgriShop Change Registry — sync between the Markdown source of truth (CR-*.md)
// and a friendly, editable Excel workbook (AgriShop-Change-Registry.xlsx).
//
//   node changes/registry-sync.mjs build
//       Markdown CRs  →  regenerate the .xlsx  +  refresh the index table in README.md
//
//   node changes/registry-sync.mjs ingest [path-to-xlsx]
//       Edited .xlsx  →  update the CR-*.md files (status, priority, type, depends-on,
//       Goal/Current/Desired, and your comments; new rows become new CR files),
//       then run build so everything is back in sync.
//
// The .xlsx is what YOU edit. The .md files are what the agent reads/implements.
// Agent-filled sections (Impact Map, Dependencies, Implementation notes) are shown
// read-only in the sheet and are never overwritten by ingest.

import ExcelJS from "exceljs";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const XLSX_PATH = join(DIR, "AgriShop-Change-Registry.xlsx");
const README_PATH = join(DIR, "README.md");

const STATUSES = ["Draft", "Proposed", "Approved", "In Progress", "Implemented", "Verified", "Done", "Rejected", "Deferred"];
const PRIORITIES = ["High", "Medium", "Low"];
const TYPES = ["UX", "Content", "IA", "Data", "Bugfix", "Mixed"];

// Columns: [header, field-key, width, editable-by-user]
const COLUMNS = [
  ["ID", "id", 10, false],
  ["Title", "title", 34, true],
  ["Type", "type", 11, true],
  ["Priority", "priority", 11, true],
  ["Status", "status", 14, true],
  ["Depends on", "dependsOn", 13, true],
  ["Goal", "goal", 40, true],
  ["Current behavior", "current", 40, true],
  ["Desired behavior", "desired", 40, true],
  ["Impact (agent-filled)", "impact", 44, false],
  ["Your comments / requested edits", "comments", 40, true],
];

// ── Markdown parsing ────────────────────────────────────────────────────────
function crFiles() {
  return readdirSync(DIR).filter((f) => /^CR-\d+.*\.md$/.test(f)).sort();
}

function stripComments(s) {
  return (s || "").replace(/<!--[\s\S]*?-->/g, "").trim();
}

function field(md, label) {
  const m = md.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n<]*)`));
  return m ? m[1].trim() : "";
}

function section(md, heading) {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, "m");
  const m = md.match(re);
  return m ? stripComments(m[1]) : "";
}

function parseCR(file) {
  const md = readFileSync(join(DIR, file), "utf8");
  const titleLine = md.match(/^#\s+(CR-\d+)\s+[—-]\s+(.*)$/m);
  const id = titleLine ? titleLine[1] : file.match(/^(CR-\d+)/)[1];
  const title = titleLine ? titleLine[2].trim() : "";
  return {
    file, id, title,
    status: field(md, "Status"),
    priority: field(md, "Priority"),
    type: field(md, "Type"),
    dependsOn: field(md, "Depends on"),
    goal: section(md, "Goal"),
    current: section(md, "Current behavior"),
    desired: section(md, "Desired behavior"),
    impact: section(md, "Impact Map"),
    comments: section(md, "Reviewer comments"),
  };
}

function impactedAreasSummary(cr) {
  // Prefer Screens, but fall back through the other dimensions so a CR that only
  // fills e.g. Backend still gets a meaningful summary (not a bare label).
  const clean = (v) => v.replace(/`/g, "").replace(/\s*\([^)]*\)/g, "").replace(/,\s*$/, "").trim();
  for (const label of ["Screens", "Flows", "Data & stores", "Content / i18n", "Backend / DB & Security"]) {
    const m = cr.impact.match(new RegExp("\\*\\*" + label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + ":\\*\\*[^\\S\\n]*([^\\n]*)"));
    const s = m ? clean(m[1]) : "";
    if (s) return s.length > 70 ? s.slice(0, 67) + "…" : s;
  }
  return "—";
}

// ── BUILD: markdown → xlsx + README index ─────────────────────────────────────
async function build() {
  const crs = crFiles().map(parseCR);

  // 1. Excel workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = "AgriShop Change Registry";

  const info = wb.addWorksheet("How to use");
  info.getColumn(1).width = 100;
  [
    "AgriShop — Change Registry (your editable copy)",
    "",
    "• Edit the 'Changes' tab: change Status/Priority, refine Goal/Current/Desired, or write in the",
    "  'Your comments / requested edits' column. To add a NEW change, fill a new row and LEAVE ID BLANK.",
    "• Status values: " + STATUSES.join(", ") + ".",
    "• Grey columns (ID, Impact) are agent-filled — you can read them but you don't need to edit them.",
    "• Save the file and send it back. The agent runs 'ingest' to update the Markdown source of truth,",
    "  then regenerates this workbook so both stay in sync.",
    "• The Markdown files (CR-*.md) remain the machine-readable source of truth.",
  ].forEach((t, i) => {
    const c = info.getCell(i + 1, 1);
    c.value = t;
    if (i === 0) c.font = { bold: true, size: 14 };
  });

  const ws = wb.addWorksheet("Changes", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS.map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16610E" } };
  ws.getRow(1).alignment = { vertical: "middle", wrapText: true };

  crs.forEach((cr) => {
    const row = ws.addRow({ ...cr, impact: cr.impact || "" });
    row.alignment = { vertical: "top", wrapText: true };
    // grey out agent-filled read-only cells
    [1, 10].forEach((ci) => {
      row.getCell(ci).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F0F0" } };
      row.getCell(ci).font = { color: { argb: "FF666666" } };
    });
  });

  // data-validation dropdowns for Status/Priority/Type over a generous range
  const lastRow = crs.length + 200;
  for (let r = 2; r <= lastRow; r++) {
    ws.getCell(`E${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${STATUSES.join(",")}"`] };
    ws.getCell(`D${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${PRIORITIES.join(",")}"`] };
    ws.getCell(`C${r}`).dataValidation = { type: "list", allowBlank: true, formulae: [`"${TYPES.join(",")}"`] };
  }

  await wb.xlsx.writeFile(XLSX_PATH);

  // 2. Refresh README index table
  const rows = crs.map((cr) =>
    `| [${cr.id}](${cr.file}) | ${cr.title} | ${cr.type} | ${cr.priority} | ${cr.status} | ${impactedAreasSummary(cr)} |`
  );
  const table = [
    "| ID | Title | Type | Priority | Status | Impacted areas |",
    "|----|-------|------|----------|--------|----------------|",
    ...rows,
  ].join("\n");
  const readme = readFileSync(README_PATH, "utf8");
  const updated = readme.replace(
    /<!-- INDEX:START -->[\s\S]*?<!-- INDEX:END -->/,
    `<!-- INDEX:START -->\n${table}\n<!-- INDEX:END -->`
  );
  writeFileSync(README_PATH, updated);

  console.log(`✓ Built ${XLSX_PATH} (${crs.length} changes) and refreshed README index.`);
}

// ── INGEST: xlsx → markdown ───────────────────────────────────────────────────
function setField(md, label, value) {
  if (!value) return md;
  const re = new RegExp(`(\\*\\*${label}:\\*\\*\\s*)([^\\n<]*?)(\\s*<!--[\\s\\S]*?-->)?(\\r?\\n)`, "");
  if (re.test(md)) return md.replace(re, (_m, p1, _p2, p3 = "", nl) => `${p1}${value}${p3 || ""}${nl}`);
  return md;
}

function setSection(md, heading, body) {
  if (body == null || body === "") return md;
  const re = new RegExp(`(^##\\s+${heading}\\s*$)([\\s\\S]*?)(?=^##\\s|\\Z)`, "m");
  if (re.test(md)) return md.replace(re, (_m, h) => `${h}\n${body}\n\n`);
  return md.trimEnd() + `\n\n## ${heading}\n${body}\n`;
}

function nextCRNumber() {
  const nums = crFiles().map((f) => parseInt(f.match(/^CR-(\d+)/)[1], 10));
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0");
}

function slug(title) {
  return (title || "change").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

async function ingest(xlsxPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath || XLSX_PATH);
  const ws = wb.getWorksheet("Changes");
  if (!ws) throw new Error("No 'Changes' sheet found in the workbook.");

  const idx = Object.fromEntries(COLUMNS.map(([, key], i) => [key, i + 1]));
  const cell = (row, key) => {
    const v = row.getCell(idx[key]).value;
    if (v == null) return "";
    if (typeof v === "object" && "richText" in v) return v.richText.map((t) => t.text).join("");
    if (typeof v === "object" && "text" in v) return String(v.text);
    return String(v).trim();
  };

  const existing = Object.fromEntries(crFiles().map((f) => [parseCR(f).id, f]));
  let updated = 0, created = 0;

  ws.eachRow((row, n) => {
    if (n === 1) return; // header
    const id = cell(row, "id");
    const title = cell(row, "title");
    if (!id && !title) return; // blank row

    if (id && existing[id]) {
      // update existing CR
      const file = existing[id];
      let md = readFileSync(join(DIR, file), "utf8");
      const t = cell(row, "title");
      if (t) md = md.replace(/^(#\s+CR-\d+\s+[—-]\s+).*/m, `$1${t}`);
      md = setField(md, "Status", cell(row, "status"));
      md = setField(md, "Priority", cell(row, "priority"));
      md = setField(md, "Type", cell(row, "type"));
      md = setField(md, "Depends on", cell(row, "dependsOn"));
      md = setSection(md, "Goal", cell(row, "goal"));
      md = setSection(md, "Current behavior", cell(row, "current"));
      md = setSection(md, "Desired behavior", cell(row, "desired"));
      const comments = cell(row, "comments");
      if (comments) md = setSection(md, "Reviewer comments", comments);
      writeFileSync(join(DIR, file), md);
      updated++;
    } else if (title) {
      // new change → new CR file
      const num = nextCRNumber();
      const newId = `CR-${num}`;
      const file = `${newId}-${slug(title)}.md`;
      const md = [
        `# ${newId} — ${title}`, "",
        `**Status:** ${cell(row, "status") || "Proposed"}`,
        `**Priority:** ${cell(row, "priority") || "Medium"}`,
        `**Type:** ${cell(row, "type") || "UX"}`,
        `**Requested by:** Owner`,
        `**Created:** ${new Date().toISOString().slice(0, 10)}`,
        `**Depends on:** ${cell(row, "dependsOn") || "—"}`,
        `**Blocks:** —`, "",
        `## Goal`, cell(row, "goal") || "", "",
        `## Current behavior`, cell(row, "current") || "", "",
        `## Desired behavior`, cell(row, "desired") || "", "",
        `## Impact Map`,
        `- **Screens:**\n- **Flows:**\n- **Data & stores:**\n- **Content / i18n:**\n- **Backend / DB & Security:**`, "",
        `## Dependencies & conflicts`, "", "",
        `## Open questions`, "", "",
        `## Implementation notes`, "", "",
        `## Verification`, "", "",
      ];
      const comments = cell(row, "comments");
      if (comments) md.push(`## Reviewer comments`, comments, "");
      writeFileSync(join(DIR, file), md.join("\n"));
      existing[newId] = file;
      created++;
    }
  });

  console.log(`✓ Ingested workbook: ${updated} updated, ${created} created.`);
  await build();
}

// ── main ──────────────────────────────────────────────────────────────────────
const [cmd, arg] = process.argv.slice(2);
if (cmd === "build") await build();
else if (cmd === "ingest") await ingest(arg);
else {
  console.error("Usage: node changes/registry-sync.mjs <build | ingest [path-to-xlsx]>");
  process.exitCode = 1;
}
