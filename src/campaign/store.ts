import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  BriefVersion,
  Evidence,
  Feedback,
  FeedbackAction,
  Listing,
  ListingStatus,
  Media,
  NewEvidence,
  NewListing,
  NewScore,
  RecipeRow,
  Run,
  ScoreRow,
} from "./types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS brief_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  yaml TEXT NOT NULL,
  prompt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  raw_json TEXT,
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  confidence REAL NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_listing ON evidence(listing_id);

CREATE TABLE IF NOT EXISTS score (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  brief_version_id INTEGER NOT NULL REFERENCES brief_version(id) ON DELETE CASCADE,
  score REAL NOT NULL,
  coverage REAL NOT NULL,
  hard_pass INTEGER NOT NULL,
  breakdown_json TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  UNIQUE (listing_id, brief_version_id)
);
CREATE INDEX IF NOT EXISTS score_brief ON score(brief_version_id);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  text TEXT NOT NULL,
  action TEXT NOT NULL,
  delta_json TEXT NOT NULL,
  applied_at TEXT
);

CREATE TABLE IF NOT EXISTS run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  cursor TEXT,
  stop_reason TEXT,
  spend_usd REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS media (
  hash TEXT NOT NULL,
  listing_id INTEGER NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (hash, listing_id)
);

CREATE TABLE IF NOT EXISTS recipe (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  version INTEGER NOT NULL,
  code TEXT NOT NULL,
  last_ok_at TEXT
);

CREATE TABLE IF NOT EXISTS geo_cache (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
`;

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function toListing(row: Row): Listing {
  return {
    id: Number(row.id),
    source: String(row.source),
    externalId: String(row.external_id),
    url: String(row.url),
    firstSeen: String(row.first_seen),
    lastSeen: String(row.last_seen),
    status: String(row.status) as ListingStatus,
    raw: parseJson(row.raw_json),
  };
}

function toEvidence(row: Row): Evidence {
  return {
    id: Number(row.id),
    listingId: Number(row.listing_id),
    key: String(row.key),
    value: parseJson(row.value_json),
    sourceType: String(row.source_type) as Evidence["sourceType"],
    sourceRef: String(row.source_ref),
    confidence: Number(row.confidence),
    observedAt: String(row.observed_at),
  };
}

function toScore(row: Row): ScoreRow {
  return {
    id: Number(row.id),
    listingId: Number(row.listing_id),
    briefVersionId: Number(row.brief_version_id),
    score: Number(row.score),
    coverage: Number(row.coverage),
    hardPass: Number(row.hard_pass) === 1,
    breakdown: parseJson(row.breakdown_json),
    computedAt: String(row.computed_at),
  };
}

export class CampaignStore {
  readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(path: string): CampaignStore {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
    return new CampaignStore(db);
  }

  close(): void {
    this.db.close();
  }

  upsertListing(input: NewListing): Listing {
    const at = now();
    const row = this.db
      .prepare(
        `INSERT INTO listing (source, external_id, url, first_seen, last_seen, status, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source, external_id) DO UPDATE SET
           url = excluded.url,
           last_seen = excluded.last_seen,
           status = excluded.status,
           raw_json = excluded.raw_json
         RETURNING id`,
      )
      .get(
        input.source,
        input.externalId,
        input.url,
        at,
        at,
        input.status ?? "active",
        input.raw === undefined ? null : JSON.stringify(input.raw),
      ) as Row;
    return this.getListing(Number(row.id)) as Listing;
  }

  getListing(id: number): Listing | null {
    const row = this.db.prepare("SELECT * FROM listing WHERE id = ?").get(id) as
      | Row
      | undefined;
    return row ? toListing(row) : null;
  }

  findListing(source: string, externalId: string): Listing | null {
    const row = this.db
      .prepare("SELECT * FROM listing WHERE source = ? AND external_id = ?")
      .get(source, externalId) as Row | undefined;
    return row ? toListing(row) : null;
  }

  listListings(): Listing[] {
    const rows = this.db
      .prepare("SELECT * FROM listing ORDER BY id")
      .all() as Row[];
    return rows.map(toListing);
  }

  setListingStatus(id: number, status: ListingStatus): void {
    this.db
      .prepare("UPDATE listing SET status = ? WHERE id = ?")
      .run(status, id);
  }

  addEvidence(input: NewEvidence): Evidence {
    const row = this.db
      .prepare(
        `INSERT INTO evidence
           (listing_id, key, value_json, source_type, source_ref, confidence, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(
        input.listingId,
        input.key,
        JSON.stringify(input.value),
        input.sourceType,
        input.sourceRef,
        input.confidence,
        input.observedAt ?? now(),
      ) as Row;
    return this.getEvidence(Number(row.id)) as Evidence;
  }

  getEvidence(id: number): Evidence | null {
    const row = this.db.prepare("SELECT * FROM evidence WHERE id = ?").get(id) as
      | Row
      | undefined;
    return row ? toEvidence(row) : null;
  }

  listEvidence(listingId: number): Evidence[] {
    const rows = this.db
      .prepare("SELECT * FROM evidence WHERE listing_id = ? ORDER BY id")
      .all(listingId) as Row[];
    return rows.map(toEvidence);
  }

  latestEvidence(listingId: number): Map<string, Evidence> {
    const latest = new Map<string, Evidence>();
    for (const item of this.listEvidence(listingId)) {
      const current = latest.get(item.key);
      if (!current || current.observedAt <= item.observedAt) {
        latest.set(item.key, item);
      }
    }
    return latest;
  }

  saveBrief(yaml: string, prompt: string): BriefVersion {
    const row = this.db
      .prepare(
        "INSERT INTO brief_version (created_at, yaml, prompt) VALUES (?, ?, ?) RETURNING id",
      )
      .get(now(), yaml, prompt) as Row;
    return this.getBrief(Number(row.id)) as BriefVersion;
  }

  getBrief(id: number): BriefVersion | null {
    const row = this.db
      .prepare("SELECT * FROM brief_version WHERE id = ?")
      .get(id) as Row | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      createdAt: String(row.created_at),
      yaml: String(row.yaml),
      prompt: String(row.prompt),
    };
  }

  latestBrief(): BriefVersion | null {
    const row = this.db
      .prepare("SELECT * FROM brief_version ORDER BY id DESC LIMIT 1")
      .get() as Row | undefined;
    return row ? this.getBrief(Number(row.id)) : null;
  }

  saveScore(input: NewScore): ScoreRow {
    const row = this.db
      .prepare(
        `INSERT INTO score
           (listing_id, brief_version_id, score, coverage, hard_pass, breakdown_json, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (listing_id, brief_version_id) DO UPDATE SET
           score = excluded.score,
           coverage = excluded.coverage,
           hard_pass = excluded.hard_pass,
           breakdown_json = excluded.breakdown_json,
           computed_at = excluded.computed_at
         RETURNING id`,
      )
      .get(
        input.listingId,
        input.briefVersionId,
        input.score,
        input.coverage,
        input.hardPass ? 1 : 0,
        JSON.stringify(input.breakdown),
        input.computedAt ?? now(),
      ) as Row;
    return this.getScore(Number(row.id)) as ScoreRow;
  }

  getScore(id: number): ScoreRow | null {
    const row = this.db.prepare("SELECT * FROM score WHERE id = ?").get(id) as
      | Row
      | undefined;
    return row ? toScore(row) : null;
  }

  listScores(briefVersionId: number): ScoreRow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM score WHERE brief_version_id = ? ORDER BY score DESC, id",
      )
      .all(briefVersionId) as Row[];
    return rows.map(toScore);
  }

  addFeedback(
    text: string,
    action: FeedbackAction,
    delta: unknown,
  ): Feedback {
    const row = this.db
      .prepare(
        "INSERT INTO feedback (at, text, action, delta_json) VALUES (?, ?, ?, ?) RETURNING id",
      )
      .get(now(), text, action, JSON.stringify(delta)) as Row;
    return this.getFeedback(Number(row.id)) as Feedback;
  }

  getFeedback(id: number): Feedback | null {
    const row = this.db
      .prepare("SELECT * FROM feedback WHERE id = ?")
      .get(id) as Row | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      at: String(row.at),
      text: String(row.text),
      action: String(row.action) as FeedbackAction,
      delta: parseJson(row.delta_json),
      appliedAt: row.applied_at === null ? null : String(row.applied_at),
    };
  }

  listFeedback(): Feedback[] {
    const rows = this.db
      .prepare("SELECT * FROM feedback ORDER BY id")
      .all() as Row[];
    return rows.map((row) => ({
      id: Number(row.id),
      at: String(row.at),
      text: String(row.text),
      action: String(row.action) as FeedbackAction,
      delta: parseJson(row.delta_json),
      appliedAt: row.applied_at === null ? null : String(row.applied_at),
    }));
  }

  markFeedbackApplied(id: number): void {
    this.db
      .prepare("UPDATE feedback SET applied_at = ? WHERE id = ?")
      .run(now(), id);
  }

  startRun(): Run {
    const row = this.db
      .prepare("INSERT INTO run (started_at) VALUES (?) RETURNING id")
      .get(now()) as Row;
    return this.getRun(Number(row.id)) as Run;
  }

  getRun(id: number): Run | null {
    const row = this.db.prepare("SELECT * FROM run WHERE id = ?").get(id) as
      | Row
      | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      startedAt: String(row.started_at),
      endedAt: row.ended_at === null ? null : String(row.ended_at),
      cursor: row.cursor === null ? null : String(row.cursor),
      stopReason: row.stop_reason === null ? null : String(row.stop_reason),
      spendUsd: Number(row.spend_usd),
    };
  }

  latestRun(): Run | null {
    const row = this.db
      .prepare("SELECT id FROM run ORDER BY id DESC LIMIT 1")
      .get() as Row | undefined;
    return row ? this.getRun(Number(row.id)) : null;
  }

  checkpointRun(id: number, cursor: string, spendUsd?: number): void {
    if (spendUsd === undefined) {
      this.db.prepare("UPDATE run SET cursor = ? WHERE id = ?").run(cursor, id);
      return;
    }
    this.db
      .prepare("UPDATE run SET cursor = ?, spend_usd = ? WHERE id = ?")
      .run(cursor, spendUsd, id);
  }

  finishRun(id: number, stopReason: string, spendUsd?: number): void {
    this.db
      .prepare(
        "UPDATE run SET ended_at = ?, stop_reason = ?, spend_usd = COALESCE(?, spend_usd) WHERE id = ?",
      )
      .run(now(), stopReason, spendUsd ?? null, id);
  }

  addMedia(hash: string, listingId: number, path: string): Media {
    const at = now();
    this.db
      .prepare(
        `INSERT INTO media (hash, listing_id, path, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (hash, listing_id) DO UPDATE SET path = excluded.path, fetched_at = excluded.fetched_at`,
      )
      .run(hash, listingId, path, at);
    return {
      hash,
      listingId,
      path,
      fetchedAt: at,
    };
  }

  getMedia(hash: string): Media | null {
    const row = this.db
      .prepare("SELECT * FROM media WHERE hash = ? LIMIT 1")
      .get(hash) as Row | undefined;
    if (!row) return null;
    return {
      hash: String(row.hash),
      listingId: Number(row.listing_id),
      path: String(row.path),
      fetchedAt: String(row.fetched_at),
    };
  }

  saveRecipe(recipe: Omit<RecipeRow, "lastOkAt"> & { lastOkAt?: string | null }): void {
    this.db
      .prepare(
        `INSERT INTO recipe (id, domain, version, code, last_ok_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           domain = excluded.domain,
           version = excluded.version,
           code = excluded.code,
           last_ok_at = excluded.last_ok_at`,
      )
      .run(
        recipe.id,
        recipe.domain,
        recipe.version,
        recipe.code,
        recipe.lastOkAt ?? null,
      );
  }

  getRecipe(id: string): RecipeRow | null {
    const row = this.db.prepare("SELECT * FROM recipe WHERE id = ?").get(id) as
      | Row
      | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      domain: String(row.domain),
      version: Number(row.version),
      code: String(row.code),
      lastOkAt: row.last_ok_at === null ? null : String(row.last_ok_at),
    };
  }

  getGeoCache(key: string): { value: unknown; observedAt: string } | null {
    const row = this.db
      .prepare("SELECT * FROM geo_cache WHERE key = ?")
      .get(key) as Row | undefined;
    if (!row) return null;
    return {
      value: parseJson(row.value_json),
      observedAt: String(row.observed_at),
    };
  }

  setGeoCache(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO geo_cache (key, value_json, observed_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           value_json = excluded.value_json,
           observed_at = excluded.observed_at`,
      )
      .run(key, JSON.stringify(value), now());
  }
}
