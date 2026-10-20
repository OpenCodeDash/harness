import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  limit?: number;
}

export interface SearchProvider {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

export type ToolCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|srsltid$|mc_|ref$|ref_)/i;

export function canonicalUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  } catch {
    return input;
  }
}

function normaliseResults(raw: unknown): SearchResult[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { results?: unknown })?.results)
      ? ((raw as { results: unknown[] }).results)
      : [];

  const results: SearchResult[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const url = typeof item.url === "string" ? item.url : "";
    if (!/^https?:\/\//.test(url)) continue;
    results.push({
      title: typeof item.title === "string" ? item.title : "",
      url: canonicalUrl(url),
      snippet:
        typeof item.content === "string"
          ? item.content
          : typeof item.snippet === "string"
            ? item.snippet
            : "",
    });
  }
  return results;
}

export function parseSearchResults(raw: unknown): SearchResult[] {
  const response = raw as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
  };

  if (response?.isError) {
    const message =
      response.content?.find((item) => item.type === "text")?.text ??
      "search failed";
    throw new Error(message);
  }

  if (response?.structuredContent !== undefined) {
    return normaliseResults(response.structuredContent);
  }

  const text = response?.content?.find((item) => item.type === "text")?.text;
  if (!text) return [];

  try {
    return normaliseResults(JSON.parse(text));
  } catch {
    return [];
  }
}

export class SearxngMcpProvider implements SearchProvider {
  constructor(private readonly callTool: ToolCaller) {}

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const raw = await this.callTool("searxng_web_search", {
      query,
      num_results: options.limit ?? 10,
      response_format: "json",
      result_detail: "compact",
    });

    const seen = new Set<string>();
    const results: SearchResult[] = [];
    for (const result of parseSearchResults(raw)) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      results.push(result);
    }
    return results;
  }
}

export async function connectSearxngMcp(url: string): Promise<{
  provider: SearxngMcpProvider;
  close: () => Promise<void>;
}> {
  const client = new Client({ name: "harness", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);

  const callTool: ToolCaller = (name, args) =>
    client.callTool({ name, arguments: args });

  return {
    provider: new SearxngMcpProvider(callTool),
    close: () => client.close(),
  };
}
