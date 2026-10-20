export type SourceType = "page" | "image" | "inference" | "user";

export type ListingStatus = "active" | "stale" | "gone";

export type FeedbackAction = "re-score" | "re-extract" | "re-search";

export interface Listing {
  id: number;
  source: string;
  externalId: string;
  url: string;
  firstSeen: string;
  lastSeen: string;
  status: ListingStatus;
  raw: unknown;
}

export interface NewListing {
  source: string;
  externalId: string;
  url: string;
  status?: ListingStatus;
  raw?: unknown;
}

export interface Evidence {
  id: number;
  listingId: number;
  key: string;
  value: unknown;
  sourceType: SourceType;
  sourceRef: string;
  confidence: number;
  observedAt: string;
}

export interface NewEvidence {
  listingId: number;
  key: string;
  value: unknown;
  sourceType: SourceType;
  sourceRef: string;
  confidence: number;
  observedAt?: string;
}

export interface BriefVersion {
  id: number;
  createdAt: string;
  yaml: string;
  prompt: string;
}

export interface ScoreRow {
  id: number;
  listingId: number;
  briefVersionId: number;
  score: number;
  coverage: number;
  hardPass: boolean;
  breakdown: unknown;
  computedAt: string;
}

export interface NewScore {
  listingId: number;
  briefVersionId: number;
  score: number;
  coverage: number;
  hardPass: boolean;
  breakdown: unknown;
  computedAt?: string;
}

export interface Feedback {
  id: number;
  at: string;
  text: string;
  action: FeedbackAction;
  delta: unknown;
  appliedAt: string | null;
}

export interface Run {
  id: number;
  startedAt: string;
  endedAt: string | null;
  cursor: string | null;
  stopReason: string | null;
  spendUsd: number;
}

export interface Media {
  hash: string;
  listingId: number;
  path: string;
  fetchedAt: string;
}

export interface RecipeRow {
  id: string;
  domain: string;
  version: number;
  code: string;
  lastOkAt: string | null;
}
