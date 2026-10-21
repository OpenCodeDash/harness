import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  echoBrief,
  parseBrief,
  parseBriefData,
  serializeBrief,
} from "../brief/brief.ts";
import type { Brief } from "../brief/types.ts";
import { applyFeedback } from "../feedback/interpret.ts";
import { CampaignStore } from "../campaign/store.ts";
import { isTie } from "../scoring/score.ts";
import {
  runCampaign,
  type BrowserProvider,
  type CampaignSummary,
  type MediaCacheFn,
  type RunnerControl,
  type RunnerDeps,
  type TextAdapter,
  type VisionAdapter,
} from "../runner/loop.ts";
import { persistScores, scoreCampaign } from "../runner/score.ts";
import type { SearchProvider } from "../discovery/searxng.ts";
import type { CachedGeoService } from "../geo/service.ts";
import { CampaignRegistry, type CampaignRecord } from "./registry.ts";

export interface CampaignRuntime {
  record: CampaignRecord;
  store: CampaignStore;
  brief: Brief;
  paused: boolean;
  stopped: boolean;
  running: boolean;
  runId?: number;
  lastSummary?: CampaignSummary;
  events: EventEmitter;
}

export interface ManagerProviders {
  browser: BrowserProvider;
  search: SearchProvider;
  geo?: CachedGeoService;
  vision?: VisionAdapter;
  text?: TextAdapter;
  cacheImage?: MediaCacheFn;
}

export interface ManagerOptions {
  root: string;
  providers: ManagerProviders;
  compileBrief: (prompt: string) => Promise<Brief>;
  registryPath?: string;
  maxConcurrent?: number;
  visitDetails?: boolean;
  detailLimit?: number;
  photosPerListing?: number;
}

export interface CreateCampaignInput {
  prompt?: string;
  brief?: string | Record<string, unknown>;
  name?: string;
}

export interface PublicSummary extends Omit<CampaignSummary, "csv"> {}

export interface CampaignStatus {
  id: string;
  name: string;
  prompt: string;
  domain: string;
  status: string;
  paused: boolean;
  stopped: boolean;
  running: boolean;
  runId: number | null;
  lastSummary: PublicSummary | null;
  createdAt: string;
}

export interface ResultRow {
  listingId: number;
  rank: number | null;
  score: number;
  coverage: number;
  hardPass: boolean;
  hardFailures: string[];
  url: string;
  source: string;
  status: string;
  fields: Record<string, unknown>;
  breakdown: unknown;
  gaps: unknown;
  questions: string[];
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "campaign";

function countSeeds(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(cursor) as { seeds?: unknown };
    return Array.isArray(parsed.seeds) ? parsed.seeds.length : 0;
  } catch {
    return 0;
  }
}

export class CampaignManager {
  private readonly registry: CampaignRegistry;
  private readonly runtimes = new Map<string, CampaignRuntime>();
  private readonly queue: Array<() => Promise<void>> = [];
  private active = 0;
  private readonly maxConcurrent: number;

  constructor(private readonly options: ManagerOptions) {
    this.registry =
      options.registryPath
        ? new CampaignRegistry(options.registryPath)
        : new CampaignRegistry(join(options.root, "daemon.db"));
    this.maxConcurrent = options.maxConcurrent ?? 1;
  }

  async open(): Promise<void> {
    for (const record of this.registry.list()) {
      try {
        const store = CampaignStore.open(join(record.dir, "campaign.db"));
        const latest = store.latestBrief();
        if (!latest) throw new Error("campaign has no brief");
        const brief = parseBrief(latest.yaml);
        const runtime: CampaignRuntime = {
          record,
          store,
          brief,
          paused: false,
          stopped: false,
          running: false,
          events: new EventEmitter(),
        };
        const run = store.latestRun();
        if (run) {
          const scored = scoreCampaign(store, brief);
          runtime.runId = run.id;
          runtime.lastSummary = {
            runId: run.id,
            stopReason: run.stopReason ?? "idle",
            discovered: countSeeds(run.cursor),
            collected: store.listListings().length,
            hardPass: scored.hardPass,
            shortlisted: Math.min(scored.hardPass, 10),
            withGaps: scored.withGaps,
            spendUsd: run.spendUsd,
            csv: scored.csv,
            errors: [],
          };
        }
        runtime.events.setMaxListeners(0);
        this.runtimes.set(record.id, runtime);
      } catch (error) {
        console.error(
          `skipping campaign ${record.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  list(): CampaignStatus[] {
    return [...this.runtimes.values()].map((runtime) => this.status(runtime));
  }

  get(id: string): CampaignRuntime | null {
    return this.runtimes.get(id) ?? null;
  }

  status(runtime: CampaignRuntime): CampaignStatus {
    let lastSummary: PublicSummary | null = null;
    if (runtime.lastSummary) {
      const { csv: _csv, ...rest } = runtime.lastSummary;
      lastSummary = rest;
    }

    return {
      id: runtime.record.id,
      name: runtime.record.name,
      prompt: runtime.record.prompt,
      domain: runtime.record.domain,
      status: runtime.running
        ? "running"
        : runtime.stopped
          ? "stopped"
          : runtime.paused
            ? "paused"
            : runtime.lastSummary?.stopReason ?? "idle",
      paused: runtime.paused,
      stopped: runtime.stopped,
      running: runtime.running,
      runId: runtime.runId ?? null,
      lastSummary,
      createdAt: runtime.record.createdAt,
    };
  }

  async preview(input: { prompt: string }): Promise<{ brief: Brief; echo: string }> {
    const brief = await this.options.compileBrief(input.prompt);
    return { brief, echo: echoBrief(brief) };
  }

  async create(input: CreateCampaignInput): Promise<CampaignRuntime> {
    let brief: Brief;
    if (input.brief) {
      brief = parseBriefData(input.brief);
    } else if (input.prompt) {
      brief = await this.options.compileBrief(input.prompt);
    } else {
      throw new Error("prompt or brief is required");
    }

    const base = slug(input.name ?? input.prompt ?? "campaign");
    const id = `${base}-${randomUUID().slice(0, 6)}`;
    const dir = join(this.options.root, "campaigns", id);
    mkdirSync(dir, { recursive: true });

    const store = CampaignStore.open(join(dir, "campaign.db"));
    store.saveBrief(serializeBrief(brief), brief.prompt);

    const record = this.registry.create({
      id,
      name: input.name ?? (brief.prompt.slice(0, 80) || id),
      prompt: brief.prompt,
      domain: brief.domain,
      dir,
    });

    const runtime: CampaignRuntime = {
      record,
      store,
      brief,
      paused: false,
      stopped: false,
      running: false,
      events: new EventEmitter(),
    };
    runtime.events.setMaxListeners(0);
    this.runtimes.set(id, runtime);
    return runtime;
  }

  start(id: string): CampaignRuntime {
    const runtime = this.require(id);
    if (runtime.running) return runtime;
    this.enqueue(runtime);
    return runtime;
  }

  pause(id: string): void {
    this.require(id).paused = true;
  }

  resume(id: string): CampaignRuntime {
    const runtime = this.require(id);
    runtime.paused = false;
    if (!runtime.running && runtime.runId) this.enqueue(runtime, runtime.runId);
    return runtime;
  }

  stop(id: string): void {
    const runtime = this.require(id);
    runtime.stopped = true;
    runtime.paused = false;
  }

  feedback(
    id: string,
    text: string,
  ): {
    changed: boolean;
    summary: string;
    action: string;
    briefVersion?: number;
    rescored?: number;
  } {
    const runtime = this.require(id);
    const applied = applyFeedback(runtime.brief, text);
    const feedback = runtime.store.addFeedback(
      text,
      applied.delta.action,
      applied.delta,
    );

    if (!applied.changed) {
      return {
        changed: false,
        summary: applied.summary,
        action: applied.delta.action,
      };
    }

    runtime.brief = applied.brief;
    const version = runtime.store.saveBrief(
      serializeBrief(runtime.brief),
      runtime.brief.prompt,
    );
    const scored = scoreCampaign(runtime.store, runtime.brief);
    persistScores(runtime.store, version.id, scored.items);
    runtime.store.markFeedbackApplied(feedback.id);
    if (runtime.lastSummary) {
      runtime.lastSummary = {
        ...runtime.lastSummary,
        collected: runtime.store.listListings().length,
        hardPass: scored.hardPass,
        shortlisted: Math.min(scored.hardPass, 10),
        withGaps: scored.withGaps,
      };
    }

    if (applied.delta.action === "re-search" && !runtime.running) {
      this.enqueue(runtime);
    }

    return {
      changed: true,
      summary: applied.summary,
      action: applied.delta.action,
      briefVersion: version.id,
      rescored: scored.items.length,
    };
  }

  results(id: string): {
    campaignId: string;
    generatedAt: string;
    briefVersion: number | null;
    counts: { listings: number; hardPass: number; withGaps: number };
    rows: ResultRow[];
  } {
    const runtime = this.require(id);
    const scored = scoreCampaign(runtime.store, runtime.brief);
    const sorted = [...scored.items].sort(
      (a, b) =>
        Number(b.result.hardPass) - Number(a.result.hardPass) ||
        b.result.score - a.result.score ||
        a.listing.id - b.listing.id,
    );

    let position = 0;
    let lastRank: number | null = null;
    let lastScore: number | null = null;
    const rows: ResultRow[] = sorted.map((item) => {
      let rank: number | null = null;
      if (item.result.hardPass) {
        position += 1;
        const tied =
          lastScore !== null && isTie(item.result.score, lastScore);
        rank = tied ? lastRank : position;
        lastRank = rank;
        lastScore = item.result.score;
      } else {
        lastRank = null;
        lastScore = null;
      }

      return {
        listingId: item.listing.id,
        rank,
        score: Number(item.result.score.toFixed(4)),
        coverage: Number(item.result.coverage.toFixed(4)),
        hardPass: item.result.hardPass,
        hardFailures: item.result.hardFailures,
        url: item.listing.url,
        source: item.listing.source,
        status: item.listing.status,
        fields: Object.fromEntries(
          [...item.facts.entries()].map(([key, fact]) => [key, fact.value]),
        ),
        breakdown: item.result.breakdown,
        gaps: item.result.gaps,
        questions: item.result.questions,
      };
    });

    return {
      campaignId: id,
      generatedAt: new Date().toISOString(),
      briefVersion: runtime.store.latestBrief()?.id ?? null,
      counts: {
        listings: rows.length,
        hardPass: scored.hardPass,
        withGaps: scored.withGaps,
      },
      rows,
    };
  }

  exportCsv(id: string): string {
    const runtime = this.require(id);
    return scoreCampaign(runtime.store, runtime.brief).csv;
  }

  async waitForIdle(): Promise<void> {
    while (this.active > 0 || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  close(): void {
    for (const runtime of this.runtimes.values()) runtime.store.close();
    this.runtimes.clear();
    this.registry.close();
  }

  private require(id: string): CampaignRuntime {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error(`campaign ${id} not found`);
    return runtime;
  }

  private enqueue(runtime: CampaignRuntime, resumeRunId?: number): void {
    this.queue.push(async () => {
      runtime.running = true;
      runtime.stopped = false;
      try {
        const summary = await runCampaign(this.depsFor(runtime), {
          brief: runtime.brief,
          resumeRunId,
        });
        runtime.runId = summary.runId;
        runtime.lastSummary = summary;
      } catch (error) {
        runtime.events.emit("event", {
          type: "error",
          campaignId: runtime.record.id,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        runtime.running = false;
      }
    });
    this.pump();
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      this.active += 1;
      void job().finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private depsFor(runtime: CampaignRuntime): RunnerDeps {
    const control: RunnerControl = {
      paused: () => runtime.paused,
      stopped: () => runtime.stopped,
    };
    return {
      store: runtime.store,
      browser: this.options.providers.browser,
      search: this.options.providers.search,
      geo: this.options.providers.geo,
      vision: this.options.providers.vision,
      text: this.options.providers.text,
      cacheImage: this.options.providers.cacheImage,
      mediaDir: join(runtime.record.dir, "media"),
      exportPath: join(runtime.record.dir, "exports", "latest.csv"),
      visitDetails: this.options.visitDetails,
      detailLimit: this.options.detailLimit,
      photosPerListing: this.options.photosPerListing,
      control,
      onEvent: (event) => {
        runtime.events.emit("event", {
          campaignId: runtime.record.id,
          at: new Date().toISOString(),
          ...event,
        });
      },
    };
  }
}
