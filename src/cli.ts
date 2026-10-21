#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileBrief, echoBrief, parseBrief } from "./brief/brief.ts";
import { ResponsesBriefExtractor } from "./brief/extractor.ts";
import type { Brief } from "./brief/types.ts";
import type { CampaignStore } from "./campaign/store.ts";
import { CampaignStore as Store } from "./campaign/store.ts";
import { createControlServer, type ControlServer, type ControlState } from "./control/api.ts";
import { connectSearxngMcp } from "./discovery/searxng.ts";
import { ResponsesQueryPlanner } from "./discovery/planner.ts";
import { NominatimGeocoder, OpenRouteServiceRouter } from "./geo/providers.ts";
import { CachedGeoService } from "./geo/service.ts";
import { McpBrowser } from "./browser/mcp.ts";
import { runCampaign, type CampaignSummary, type RunnerDeps } from "./runner/loop.ts";
import { ResponsesClient } from "./vision/responses.ts";
import { extractImageFacts } from "./vision/vision.ts";
import { TextCriteriaExtractor } from "./runner/text-extract.ts";

export interface CliOptions {
  db: string;
  briefPath?: string;
  prompt?: string;
  exportPath: string;
  mediaDir: string;
  serve?: number;
  noVision: boolean;
  noDetails: boolean;
  resume?: number;
  now: boolean;
  waitSeconds: number;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    db: "campaigns/default/campaign.db",
    noVision: false,
    noDetails: false,
    now: false,
    waitSeconds: 60,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = () => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${arg} requires a value`);
      index += 1;
      return next;
    };

    switch (arg) {
      case "--db":
        options.db = value();
        break;
      case "--brief":
        options.briefPath = value();
        break;
      case "--prompt":
        options.prompt = value();
        break;
      case "--export":
        options.exportPath = value();
        break;
      case "--media":
        options.mediaDir = value();
        break;
      case "--serve": {
        const next = argv[index + 1];
        options.serve =
          next && !next.startsWith("-") ? Number(value()) : 7331;
        break;
      }
      case "--no-vision":
        options.noVision = true;
        break;
      case "--no-details":
        options.noDetails = true;
        break;
      case "--resume":
        options.resume = Number(value());
        break;
      case "--now":
        options.now = true;
        break;
      case "--wait":
        options.waitSeconds = Number(value());
        break;
      case "--help":
        throw new Error(help());
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }

  const db = options.db!;
  const dir = dirname(db);
  return {
    ...(options as Omit<CliOptions, "exportPath" | "mediaDir">),
    exportPath: options.exportPath ?? join(dir, "exports", "latest.csv"),
    mediaDir: options.mediaDir ?? join(dir, "media"),
  };
}

function help(): string {
  return [
    "Usage: harness --prompt \"...\" | --brief brief.yaml [options]",
    "",
    "  --db <path>        campaign database (default campaigns/default/campaign.db)",
    "  --brief <path>     load a brief from YAML",
    "  --prompt <text>    compile a brief from a prompt via the router",
    "  --export <path>    CSV output path",
    "  --media <path>     cached image directory",
    "  --serve [port]     run the control API (default 7331)",
    "  --no-vision        skip image extraction",
    "  --no-details       skip per-listing detail pages",
    "  --resume <id>      resume a run id",
    "  --now              start without the 60s confirm window",
    "  --wait <seconds>   change the confirm window",
  ].join("\n");
}

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const options = parseArgs(argv);
  const store: CampaignStore = Store.open(options.db);
  const router = new ResponsesClient({
    baseUrl: env("ROUTER_BASE_URL", "http://192.168.68.51:3005/v1"),
    apiKey: process.env.ROUTER_API_KEY,
    timeoutMs: 120_000,
  });
  const model = env("HARNESS_MODEL", "opencode-go-gpt-5.6-luna");
  const planner = new ResponsesQueryPlanner(router, model);

  let brief: Brief;
  if (options.briefPath) {
    brief = parseBrief(await readFile(options.briefPath, "utf8"));
  } else if (options.prompt) {
    brief = await compileBrief(
      options.prompt,
      new ResponsesBriefExtractor(router, model),
    );
  } else {
    throw new Error(`provide --prompt or --brief\n\n${help()}`);
  }

  console.log(echoBrief(brief));
  if (!options.now) {
    console.log(`Starting in ${options.waitSeconds}s (Ctrl-C to cancel).`);
    await new Promise((resolve) =>
      setTimeout(resolve, options.waitSeconds * 1000),
    );
  }

  const search = await connectSearxngMcp(
    env("SEARXNG_MCP_URL", "http://192.168.68.4:8049/mcp"),
  );
  const browser = await McpBrowser.connect();
  const state: ControlState = {
    store,
    brief,
    paused: false,
    token: process.env.HARNESS_TOKEN,
  };

  const textExtractor = new TextCriteriaExtractor(router, model);

  const deps: RunnerDeps = {
    store,
    browser,
    search: search.provider,
    planner,
    mediaDir: options.mediaDir,
    exportPath: options.exportPath,
    visitDetails: !options.noDetails,
    control: { paused: () => state.paused },
    vision: options.noVision
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
          cache: {
            get: (key) => store.getGeoCache(key),
            set: (key, value) => store.setGeoCache(key, value),
          },
        })
      : undefined,
  };

  let lastRunId = options.resume;
  state.runId = lastRunId;
  const research = async (nextBrief: Brief): Promise<CampaignSummary> => {
    state.brief = nextBrief;
    const summary = await runCampaign(deps, {
      brief: nextBrief,
      resumeRunId: lastRunId,
    });
    lastRunId = summary.runId;
    state.runId = summary.runId;
    state.lastSummary = summary;
    return summary;
  };
  const resume = async (runId: number): Promise<CampaignSummary> => {
    const summary = await runCampaign(deps, {
      brief: state.brief,
      resumeRunId: runId,
    });
    lastRunId = summary.runId;
    state.runId = summary.runId;
    state.lastSummary = summary;
    return summary;
  };
  state.onResearch = research;
  state.onResume = resume;

  let server: ControlServer | undefined;
  if (options.serve !== undefined) {
    server = createControlServer(state);
    const port = await server.listen(options.serve);
    console.log(`control api: http://127.0.0.1:${port}`);
  }

  const shutdown = async () => {
    await server?.close();
    await search.close();
    await browser.close();
    store.close();
  };

  try {
    const summary = await research(brief);
    console.log(
      JSON.stringify(
        {
          runId: summary.runId,
          stopReason: summary.stopReason,
          discovered: summary.discovered,
          collected: summary.collected,
          hardPass: summary.hardPass,
          shortlisted: summary.shortlisted,
          withGaps: summary.withGaps,
          spendUsd: summary.spendUsd,
          export: options.exportPath,
          errors: summary.errors.slice(0, 5),
        },
        null,
        2,
      ),
    );
  } finally {
    if (!server) await shutdown();
  }

  if (server) {
    process.on("SIGINT", () => {
      void shutdown().finally(() => process.exit(0));
    });
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
