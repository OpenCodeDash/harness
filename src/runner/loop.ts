import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { serializeBrief } from "../brief/brief.ts";
import type { Brief } from "../brief/types.ts";
import type { CampaignStore } from "../campaign/store.ts";
import type { DomainPack, ImageFeatureDef } from "../domain/types.ts";
import { buildDiscoveryQueries } from "../discovery/queries.ts";
import type { SearchProvider } from "../discovery/searxng.ts";
import type { CachedGeoService } from "../geo/service.ts";
import type { GeoPoint } from "../geo/types.ts";
import { selectFacts, scoreListing } from "../scoring/score.ts";
import { persistScores, scoreCampaign } from "./score.ts";
import {
  getRecipeFor,
  runListing,
  runSearch,
  type Recipe,
  type RecipePage,
  type RawListing,
} from "../sources/index.ts";
import { cacheImage } from "../vision/media.ts";
import type { ImageFact } from "../vision/vision.ts";
import { extractDescriptionFacts } from "./text.ts";

export interface RunnerPage extends RecipePage {
  close(): Promise<void>;
}

export interface BrowserProvider {
  newPage(url: string): Promise<RunnerPage>;
}

export interface VisionAdapter {
  model: string;
  extract(input: {
    imagePath: string;
    mimeType: string;
    features: ImageFeatureDef[];
  }): Promise<ImageFact[]>;
}

export interface RunnerControl {
  paused(): boolean;
  stopped?(): boolean;
}

export type RunnerEvent =
  | { type: "run.started"; runId: number }
  | {
      type: "stage";
      stage: "discover" | "collect" | "vision" | "score" | "export";
      discovered: number;
      collected: number;
      spendUsd: number;
    }
  | {
      type: "run.finished";
      runId: number;
      stopReason: string;
      collected: number;
      hardPass: number;
      spendUsd: number;
    };

export interface MediaCacheFn {
  (url: string): Promise<{ hash: string; path: string; mimeType: string }>;
}

export interface RunnerDeps {
  store: CampaignStore;
  browser: BrowserProvider;
  search: SearchProvider;
  geo?: CachedGeoService;
  vision?: VisionAdapter;
  cacheImage?: MediaCacheFn;
  mediaDir?: string;
  exportPath?: string;
  visitDetails?: boolean;
  detailLimit?: number;
  photosPerListing?: number;
  costPerVisionCallUsd?: number;
  control?: RunnerControl;
  onEvent?: (event: RunnerEvent) => void;
  now?: () => string;
}

export interface CampaignOptions {
  brief: Brief;
  pack: DomainPack;
  briefVersionId?: number;
  resumeRunId?: number;
  seedUrls?: string[];
}

export interface CampaignSummary {
  runId: number;
  stopReason: string;
  discovered: number;
  collected: number;
  hardPass: number;
  shortlisted: number;
  withGaps: number;
  spendUsd: number;
  csv: string;
  errors: string[];
}

interface Progress {
  stage: "collect" | "vision";
  seeds: string[];
  index: number;
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export async function runCampaign(
  deps: RunnerDeps,
  options: CampaignOptions,
): Promise<CampaignSummary> {
  const store = deps.store;
  const { brief, pack } = options;
  const briefVersionId =
    options.briefVersionId ??
    store.saveBrief(serializeBrief(brief), brief.prompt).id;
  const run = options.resumeRunId
    ? store.getRun(options.resumeRunId)
    : store.startRun();
  if (!run) throw new Error(`run ${options.resumeRunId} not found`);

  const errors: string[] = [];
  const paused = () => deps.control?.paused() ?? false;
  const stopped = () => deps.control?.stopped?.() ?? false;
  const emit = deps.onEvent ?? (() => {});
  emit({ type: "run.started", runId: run.id });
  const observe = () => deps.now?.() ?? new Date().toISOString();
  const deadline = Date.now() + brief.budgets.maxMinutes * 60_000;
  const detailLimit = deps.detailLimit ?? 30;
  const photosPerListing = deps.photosPerListing ?? 3;

  let spend = run.spendUsd;
  let progress: Progress | null = null;
  if (run.cursor) {
    try {
      progress = JSON.parse(run.cursor) as Progress;
    } catch {
      progress = null;
    }
  }

  const checkpoint = (next: Progress) => {
    progress = next;
    store.checkpointRun(run.id, JSON.stringify(next), spend);
  };

  let seeds: string[] = progress?.seeds ?? [];
  let discovered = seeds.length;
  if (!progress) {
    const found = await discover(deps, brief, pack, errors);
    seeds = found;
    discovered = seeds.length;
    checkpoint({ stage: "collect", seeds, index: 0 });
    emit({
      type: "stage",
      stage: "discover",
      discovered,
      collected: 0,
      spendUsd: spend,
    });
  }

  let stopReason: "complete" | "paused" | "budget" | "stopped" = "complete";
  let collected = 0;
  let detailCount = 0;

  if (!progress || progress.stage === "collect") {
    const start = progress?.index ?? 0;
    for (let index = start; index < seeds.length; index += 1) {
      if (stopped()) {
        checkpoint({ stage: "collect", seeds, index });
        stopReason = "stopped";
        break;
      }
      if (paused()) {
        checkpoint({ stage: "collect", seeds, index });
        stopReason = "paused";
        break;
      }
      if (Date.now() > deadline) {
        stopReason = "budget";
        break;
      }
      if (collected >= brief.budgets.maxListings) {
        stopReason = "budget";
        break;
      }

      const url = seeds[index]!;
      const recipe = getRecipeFor(url);
      if (!recipe) {
        errors.push(`no recipe for ${url}`);
        continue;
      }

      let page: RunnerPage | null = null;
      try {
        page = await deps.browser.newPage(url);
        const items = recipe.isListing(url)
          ? [await runListing(page, recipe, url)]
          : await runSearch(page, recipe, url);

        for (const item of items) {
          ingest(store, pack, recipe, item, observe);
          collected += 1;
          if (collected >= brief.budgets.maxListings) break;
        }
        if (collected >= brief.budgets.maxListings) {
          stopReason = "budget";
        }

        if (
          stopReason === "complete" &&
          !recipe.isListing(url) &&
          deps.visitDetails !== false &&
          detailCount < detailLimit
        ) {
          for (const item of items) {
            if (
              detailCount >= detailLimit ||
              collected >= brief.budgets.maxListings
            ) {
              break;
            }
            if (paused()) break;
            let detailPage: RunnerPage | null = null;
            try {
              detailPage = await deps.browser.newPage(item.url);
              const detail = await runListing(detailPage, recipe, item.url);
              ingest(store, pack, recipe, detail, observe);
              detailCount += 1;
            } catch (error) {
              errors.push(`detail ${item.url}: ${message(error)}`);
            } finally {
              await detailPage?.close();
            }
          }
        }
      } catch (error) {
        errors.push(`collect ${url}: ${message(error)}`);
      } finally {
        await page?.close();
      }

      checkpoint({ stage: "collect", seeds, index: index + 1 });
    }

    if (stopReason === "complete") {
      checkpoint({ stage: "vision", seeds, index: 0 });
    }
    emit({
      type: "stage",
      stage: "collect",
      discovered,
      collected,
      spendUsd: spend,
    });
  }

  if (stopReason === "complete") {
    await addCommutes(deps, brief, errors);
    await addVision(deps, brief, pack, progress, checkpoint, errors, {
      spend,
      photosPerListing,
      paused,
      stopped,
      setSpend: (value: number) => {
        spend = value;
      },
      stop: (reason: "paused" | "budget" | "stopped") => {
        stopReason = reason;
      },
    });
    emit({
      type: "stage",
      stage: "vision",
      discovered,
      collected,
      spendUsd: spend,
    });
  }

  const scored = scoreCampaign(store, brief, pack);
  persistScores(store, briefVersionId, scored.items);
  emit({
    type: "stage",
    stage: "score",
    discovered,
    collected,
    spendUsd: spend,
  });
  const csv = scored.csv;
  if (deps.exportPath) {
    await mkdir(dirname(deps.exportPath), { recursive: true });
    await writeFile(deps.exportPath, csv, "utf8");
  }
  emit({
    type: "stage",
    stage: "export",
    discovered,
    collected,
    spendUsd: spend,
  });

  store.finishRun(run.id, stopReason, spend);
  emit({
    type: "run.finished",
    runId: run.id,
    stopReason,
    collected,
    hardPass: scored.hardPass,
    spendUsd: spend,
  });

  return {
    runId: run.id,
    stopReason,
    discovered,
    collected,
    hardPass: scored.hardPass,
    shortlisted: Math.min(scored.hardPass, 10),
    withGaps: scored.withGaps,
    spendUsd: spend,
    csv,
    errors,
  };
}

async function discover(
  deps: RunnerDeps,
  brief: Brief,
  pack: DomainPack,
  errors: string[],
): Promise<string[]> {
  const queries = buildDiscoveryQueries(brief, pack);
  const seeds = new Set<string>();

  for (const query of queries) {
    if (seeds.size >= brief.budgets.maxListings) break;
    try {
      const results = await deps.search.search(query, { limit: 10 });
      for (const result of results) {
        if (!getRecipeFor(result.url)) continue;
        seeds.add(result.url);
        if (seeds.size >= brief.budgets.maxListings) break;
      }
    } catch (error) {
      errors.push(`search "${query}": ${message(error)}`);
    }
  }
  return [...seeds];
}

function ingest(
  store: CampaignStore,
  pack: DomainPack,
  recipe: Recipe,
  item: RawListing,
  observe: () => string,
): number {
  const listing = store.upsertListing({
    source: item.source,
    externalId: item.externalId,
    url: item.url,
    raw: item.raw,
  });
  const sourceRef = `recipe:${recipe.id}@${recipe.version}`;
  const observedAt = observe();

  for (const [key, value] of Object.entries(item.fields)) {
    if (value === undefined || value === null || value === "") continue;
    store.addEvidence({
      listingId: listing.id,
      key,
      value,
      sourceType: "page",
      sourceRef,
      confidence: 1,
      observedAt,
    });
  }

  if (item.media.length) {
    store.addEvidence({
      listingId: listing.id,
      key: "media_urls",
      value: item.media,
      sourceType: "page",
      sourceRef,
      confidence: 1,
      observedAt,
    });
  }

  const description =
    typeof item.fields.description === "string" ? item.fields.description : "";
  if (description) {
    for (const fact of extractDescriptionFacts(description, pack)) {
      store.addEvidence({
        listingId: listing.id,
        key: fact.key,
        value: fact.value,
        sourceType: "inference",
        sourceRef: "text:description",
        confidence: fact.confidence,
        observedAt,
      });
    }
  }

  return listing.id;
}

async function addCommutes(
  deps: RunnerDeps,
  brief: Brief,
  errors: string[],
): Promise<void> {
  if (!deps.geo || !brief.anchors.work) return;

  let work: GeoPoint | null = null;
  try {
    if (
      typeof brief.anchors.work.lat === "number" &&
      typeof brief.anchors.work.lon === "number"
    ) {
      work = { lat: brief.anchors.work.lat, lon: brief.anchors.work.lon };
    } else if (brief.anchors.work.address) {
      work = await deps.geo.geocode(brief.anchors.work.address);
    }
  } catch (error) {
    errors.push(`geocode work: ${message(error)}`);
    return;
  }
  if (!work) {
    errors.push("work anchor could not be geocoded");
    return;
  }

  for (const listing of deps.store.listListings()) {
    const facts = selectFacts(deps.store.listEvidence(listing.id));
    const address = facts.get("address")?.value;
    if (typeof address !== "string") continue;
    try {
      const commute = await deps.geo.commuteMinutes(address, work);
      if (!commute) continue;
      deps.store.addEvidence({
        listingId: listing.id,
        key: "commute",
        value: commute.minutes,
        sourceType: "inference",
        sourceRef: "route",
        confidence: 0.9,
      });
    } catch (error) {
      errors.push(`commute ${listing.id}: ${message(error)}`);
    }
  }
}

async function addVision(
  deps: RunnerDeps,
  brief: Brief,
  pack: DomainPack,
  progress: Progress | null,
  checkpoint: (next: Progress) => void,
  errors: string[],
  state: {
    spend: number;
    photosPerListing: number;
    paused: () => boolean;
    stopped: () => boolean;
    setSpend: (value: number) => void;
    stop: (reason: "paused" | "budget" | "stopped") => void;
  },
): Promise<void> {
  if (!deps.vision) return;

  const candidates = deps.store
    .listListings()
    .map((listing) => {
      const facts = selectFacts(deps.store.listEvidence(listing.id));
      return { listing, facts, result: scoreListing(brief, pack, facts) };
    })
    .sort(
      (a, b) =>
        Number(b.result.hardPass) - Number(a.result.hardPass) ||
        b.result.score - a.result.score ||
        a.listing.id - b.listing.id,
    )
    .slice(0, brief.budgets.visionMax);

  const seeds = progress?.seeds ?? [];
  const start = progress?.stage === "vision" ? progress.index : 0;
  const cache: MediaCacheFn =
    deps.cacheImage ??
    ((url) => cacheImage({ url, dir: deps.mediaDir ?? "media" }));
  const costPerCall = deps.costPerVisionCallUsd ?? 0.01;

  for (let index = start; index < candidates.length; index += 1) {
    if (state.stopped()) {
      checkpoint({ stage: "vision", seeds, index });
      state.stop("stopped");
      return;
    }
    if (state.paused()) {
      checkpoint({ stage: "vision", seeds, index });
      state.stop("paused");
      return;
    }
    if (state.spend >= brief.budgets.maxUsd) {
      state.stop("budget");
      return;
    }

    const candidate = candidates[index]!;
    const media = candidate.facts.get("media_urls")?.value;
    const urls = Array.isArray(media)
      ? media.filter((url): url is string => typeof url === "string").slice(0, state.photosPerListing)
      : [];

    for (const url of urls) {
      if (state.spend >= brief.budgets.maxUsd) {
        state.stop("budget");
        return;
      }
      try {
        const cached = await cache(url);
        deps.store.addMedia(cached.hash, candidate.listing.id, cached.path);
        const facts = await deps.vision.extract({
          imagePath: cached.path,
          mimeType: cached.mimeType,
          features: pack.imageFeatures,
        });
        for (const fact of facts) {
          deps.store.addEvidence({
            listingId: candidate.listing.id,
            key: fact.key,
            value: fact.value,
            sourceType: "image",
            sourceRef: fact.sourceRef,
            confidence: fact.confidence,
          });
        }
        state.setSpend(state.spend + costPerCall);
      } catch (error) {
        errors.push(`vision ${candidate.listing.id}: ${message(error)}`);
      }
    }

    checkpoint({ stage: "vision", seeds, index: index + 1 });
  }
}
