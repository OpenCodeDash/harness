#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { compileBrief } from "../brief/brief.ts";
import { ResponsesBriefExtractor } from "../brief/extractor.ts";
import { McpBrowser } from "../browser/mcp.ts";
import { connectSearxngMcp } from "../discovery/searxng.ts";
import { ResponsesQueryPlanner } from "../discovery/planner.ts";
import { NominatimGeocoder, MemoryGeoCache, OpenRouteServiceRouter } from "../geo/providers.ts";
import { CachedGeoService } from "../geo/service.ts";
import { ResponsesClient } from "../vision/responses.ts";
import { extractImageFacts } from "../vision/vision.ts";
import { TextCriteriaExtractor } from "../runner/text-extract.ts";
import { CampaignManager } from "./manager.ts";
import { createDaemonServer } from "./server.ts";

const env = (name: string, fallback: string) => process.env[name] ?? fallback;

export async function startDaemon(): Promise<void> {
  const root = env("HARNESS_ROOT", "campaigns");
  const host = env("HARNESS_HOST", "127.0.0.1");
  const port = Number(env("HARNESS_PORT", "7332"));
  const token = process.env.HARNESS_TOKEN;
  const model = env("HARNESS_MODEL", "opencode-go-gpt-5.6-luna");

  const router = new ResponsesClient({
    baseUrl: env("ROUTER_BASE_URL", "http://192.168.68.51:3005/v1"),
    apiKey: process.env.ROUTER_API_KEY,
    timeoutMs: 120_000,
  });

  const search = await connectSearxngMcp(
    env("SEARXNG_MCP_URL", "http://192.168.68.4:8049/mcp"),
  );
  const browser = await McpBrowser.connect();

  const textExtractor = new TextCriteriaExtractor(router, model);

  const manager = new CampaignManager({
    root,
    providers: {
      browser,
      search: search.provider,
      planner: new ResponsesQueryPlanner(router, model),
      vision: process.env.HARNESS_NO_VISION
        ? undefined
        : {
            model,
            async extract({ imagePath, mimeType, features }) {
              const result = await extractImageFacts(router, {
                imagePath,
                mimeType,
                features,
                model,
              });
              return result.facts;
            },
          },
      text: {
        model,
        extract: (input) => textExtractor.extract(input),
      },
      geo: process.env.ORS_API_KEY
        ? new CachedGeoService({
            geocoder: new NominatimGeocoder(),
            router: new OpenRouteServiceRouter({
              apiKey: process.env.ORS_API_KEY,
            }),
            cache: new MemoryGeoCache(),
          })
        : undefined,
    },
    compileBrief: (prompt) =>
      compileBrief(prompt, new ResponsesBriefExtractor(router, model)),
  });

  await manager.open();

  const server = createDaemonServer({ manager, token });
  const bound = await server.listen(port, host);
  console.log(`harness daemon listening on http://${host}:${bound}`);
  if (!token) {
    console.warn("HARNESS_TOKEN is not set; the API is unauthenticated");
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close().catch(() => {});
    await search.close().catch(() => {});
    await browser.close().catch(() => {});
    manager.close();
  };

  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startDaemon().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
