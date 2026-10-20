import type { Brief } from "../brief/types.ts";
import type { Listing } from "../campaign/types.ts";
import type { DomainPack } from "../domain/types.ts";
import type { Fact, ScoreResult } from "../scoring/score.ts";
import { isTie } from "../scoring/score.ts";

export type Cell = string | number | boolean | null;

export interface ExportColumn {
  key: string;
  label: string;
}

export interface ExportTable {
  columns: ExportColumn[];
  rows: Array<Record<string, Cell>>;
}

export interface ExportItem {
  listing: Listing;
  facts: Map<string, Fact>;
  result: ScoreResult;
}

const CORE_COLUMNS: ExportColumn[] = [
  { key: "rank", label: "Rank" },
  { key: "score", label: "Score" },
  { key: "coverage", label: "Coverage" },
  { key: "hard_pass", label: "Hard pass" },
  { key: "failures", label: "Hard failures" },
];

const TAIL_COLUMNS: ExportColumn[] = [
  { key: "gaps", label: "Unknowns" },
  { key: "questions", label: "Questions" },
  { key: "url", label: "URL" },
  { key: "source", label: "Source" },
  { key: "status", label: "Status" },
  { key: "listing_id", label: "Listing id" },
];

function formatCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function sortItems(items: ExportItem[]): ExportItem[] {
  return [...items].sort((a, b) => {
    const hardPass =
      Number(b.result.hardPass) - Number(a.result.hardPass);
    if (hardPass !== 0) return hardPass;
    if (b.result.score !== a.result.score) return b.result.score - a.result.score;
    if (b.result.coverage !== a.result.coverage) {
      return b.result.coverage - a.result.coverage;
    }
    return a.listing.id - b.listing.id;
  });
}

function rankItems(items: ExportItem[]): Array<number | null> {
  const ranks: Array<number | null> = [];
  let position = 0;
  let lastRank: number | null = null;
  let lastScore: number | null = null;
  let previousPassed = false;

  for (const item of items) {
    if (!item.result.hardPass) {
      ranks.push(null);
      previousPassed = false;
      lastScore = null;
      lastRank = null;
      continue;
    }
    position += 1;
    const tied =
      previousPassed && lastScore !== null && isTie(item.result.score, lastScore);
    const rank: number = tied ? (lastRank ?? position) : position;
    ranks.push(rank);
    previousPassed = true;
    lastScore = item.result.score;
    lastRank = rank;
  }
  return ranks;
}

export function buildExportTable(
  items: ExportItem[],
  brief: Brief,
  pack: DomainPack,
): ExportTable {
  const criteria = brief.soft
    .map((soft) => pack.defaultCriteria.find((c) => c.key === soft.key))
    .filter((criterion): criterion is NonNullable<typeof criterion> =>
      Boolean(criterion),
    );

  const criterionColumns: ExportColumn[] = criteria.map((criterion) => ({
    key: `criterion:${criterion.key}`,
    label: criterion.label,
  }));

  const columns: ExportColumn[] = [
    ...CORE_COLUMNS,
    ...criterionColumns,
    ...TAIL_COLUMNS,
  ];

  const sorted = sortItems(items);
  const ranks = rankItems(sorted);

  const rows = sorted.map((item, index) => {
    const row: Record<string, Cell> = {
      rank: ranks[index] ?? null,
      score: Number(item.result.score.toFixed(4)),
      coverage: Number(item.result.coverage.toFixed(4)),
      hard_pass: item.result.hardPass,
      failures: item.result.hardFailures.join("; "),
      gaps: item.result.gaps
        .map((gap) => `${gap.label} (${gap.reason})`)
        .join("; "),
      questions: item.result.questions.join("; "),
      url: item.listing.url,
      source: item.listing.source,
      status: item.listing.status,
      listing_id: item.listing.id,
    };

    for (const criterion of criteria) {
      row[`criterion:${criterion.key}`] = formatCell(
        item.facts.get(criterion.key)?.value,
      );
    }

    return row;
  });

  return { columns, rows };
}

function escapeCell(value: Cell): string {
  if (value === null) return "";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) {
    text = `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function tableToCsv(table: ExportTable): string {
  const header = table.columns.map((column) => escapeCell(column.label));
  const lines = [header.join(",")];
  for (const row of table.rows) {
    lines.push(
      table.columns.map((column) => escapeCell(row[column.key] ?? null)).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
