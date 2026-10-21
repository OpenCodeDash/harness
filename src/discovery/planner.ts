import type { Brief } from "../brief/types.ts";
import type { DiscoverySource } from "../sources/discovery.ts";
import type { ResponsesClient } from "../vision/responses.ts";

export interface PlannedQuery {
  query: string;
  /** Optional bare host, e.g. "trademe.co.nz". */
  site?: string;
}

export interface QueryPlanner {
  plan(input: {
    brief: Brief;
    sources: DiscoverySource[];
  }): Promise<PlannedQuery[]>;
}

const MAX_QUERIES = 8;
const MIN_QUERIES = 1;
const MAX_QUERY_LENGTH = 120;

const SCHEMA = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      maxItems: MAX_QUERIES,
      items: {
        type: "object",
        properties: {
          query: { type: "string" },
          site: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
        required: ["query", "site"],
        additionalProperties: false,
      },
    },
  },
  required: ["queries"],
  additionalProperties: false,
} as const;

export function bareHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!
    .replace(/:\d+$/, "");
}

function cleanQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function validatePlannedQueries(
  raw: unknown,
  allowedHosts: string[],
): PlannedQuery[] {
  const hosts = new Set(allowedHosts.map(bareHost).filter(Boolean));
  const entries =
    raw && typeof raw === "object"
      ? (raw as { queries?: unknown }).queries
      : undefined;
  if (!Array.isArray(entries)) return [];

  const seen = new Set<string>();
  const planned: PlannedQuery[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { query?: unknown; site?: unknown };
    if (typeof item.query !== "string") continue;
    let query = cleanQuery(item.query);
    if (query.length < 3 || query.length > MAX_QUERY_LENGTH) continue;
    if (/[{}]/.test(query)) continue;

    let site =
      typeof item.site === "string" && item.site.trim()
        ? bareHost(item.site)
        : undefined;
    const inline = /^site:(\S+)\s+(.*)$/i.exec(query);
    if (inline) {
      site = site ?? bareHost(inline[1]!);
      query = cleanQuery(inline[2]!);
    }
    if (site && hosts.size > 0 && !hosts.has(site)) site = undefined;
    if (site && !site.includes(".")) site = undefined;

    const key = `${site ?? ""}|${query.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    planned.push({ query, ...(site ? { site } : {}) });
    if (planned.length >= MAX_QUERIES) break;
  }
  return planned.length >= MIN_QUERIES ? planned : [];
}

function buildPrompt(brief: Brief, sources: DiscoverySource[]): string {
  const explicit = brief.criteria
    .filter((criterion) => criterion.origin === "explicit")
    .map((criterion) => {
      const hard = criterion.hard ? ` (hard: ${JSON.stringify(criterion.hard)})` : "";
      return `- ${criterion.label}${hard}`;
    })
    .join("\n");

  const sourceLines = sources
    .map((source) => {
      const label = source.discovery?.label ?? source.id;
      const sites = source.discovery?.sites?.join(", ");
      return `- ${label}${sites ? ` (${sites})` : ""}`;
    })
    .join("\n");

  const namedSites = [...(brief.sources.allow ?? []), ...(brief.sources.prefer ?? [])];
  return [
    "Write web search queries that will find individual listings for this request.",
    "",
    "Rules:",
    `- Return ${MIN_QUERIES}-${MAX_QUERIES} queries, each a short phrase a person would type (3-12 words).`,
    "- Use the user's own nouns: product/model, location, and the attributes that distinguish a match.",
    "- Do not concatenate criterion labels into a keyword soup, and do not copy the whole request sentence.",
    "- Prefer several different angles (model names, synonyms, condition, size) over one long query.",
    "- Set site only when the user named a site or a source is clearly the right marketplace; use a bare host like trademe.co.nz, never a path.",
    "- Do not use the site: operator inside query.",
    "- Queries must be plain text with no braces or placeholders.",
    "",
    "Request:",
    brief.prompt,
    "",
    explicit ? `Explicit requirements:\n${explicit}` : "Explicit requirements: (none listed)",
    "",
    namedSites.length
      ? `The user named these sites: ${namedSites.join(", ")}`
      : "The user did not name a site.",
    "",
    "Available sources:",
    sourceLines || "(open web)",
  ].join("\n");
}

export class ResponsesQueryPlanner implements QueryPlanner {
  constructor(
    private readonly client: ResponsesClient,
    private readonly model: string,
  ) {}

  async plan(input: {
    brief: Brief;
    sources: DiscoverySource[];
  }): Promise<PlannedQuery[]> {
    const allowedHosts = input.sources.flatMap(
      (source) => source.discovery?.sites ?? [],
    );
    const result = await this.client.structured<Record<string, unknown>>({
      model: this.model,
      name: "discovery_queries",
      schema: SCHEMA as unknown as Record<string, unknown>,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: buildPrompt(input.brief, input.sources) }],
        },
      ],
    });
    return validatePlannedQueries(result.data, allowedHosts);
  }
}
