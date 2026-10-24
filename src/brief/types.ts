import type { CriterionSpec } from "../domain/types.ts";

export type CommuteMode = "drive" | "walk" | "cycle" | "transit";

export interface Anchor {
  address?: string;
  lat?: number;
  lon?: number;
}

export interface Commute {
  mode: CommuteMode;
  maxMinutes: number;
  hard: boolean;
}

export interface HardConstraints {
  rentMax?: number;
  bedrooms?: { min?: number; max?: number };
  areas?: string[];
  required?: Record<string, unknown>;
}

export type UnknownPolicy = "flag" | "penalize" | "investigate";

export type WebScope = "open" | "structured-only" | "off";

export interface SourceScope {
  /** Source ids or hosts to search. Empty means no allow restriction. */
  allow?: string[];
  /** Source ids or hosts to exclude. */
  deny?: string[];
  /** Source ids or hosts to query first. */
  prefer?: string[];
  /** open: all sources; structured-only: skip generic HTML; off: only allowed sources. */
  web: WebScope;
}

export const DEFAULT_SOURCE_SCOPE: SourceScope = { web: "open" };

export interface Budgets {
  maxListings: number;
  maxUsd: number;
  maxMinutes: number;
  visionMax: number;
  textMax: number;
  htmlMax: number;
}

export interface Brief {
  version: number;
  domain: string;
  prompt: string;
  anchors: { work?: Anchor; commute?: Commute };
  hard: HardConstraints;
  criteria: CriterionSpec[];
  unknownPolicy: UnknownPolicy;
  sources: SourceScope;
  /** URLs to collect directly; discovery is skipped when present. */
  seeds: string[];
  /** Extra searches the user asked for; the planner includes them. */
  queries: string[];
  budgets: Budgets;
  assumptions: string[];
  warnings: string[];
}

export type FeedbackAction = "re-score" | "re-extract" | "re-search";

export interface BriefDelta {
  action: FeedbackAction;
  setWeights?: Record<string, number>;
  addCriteria?: CriterionSpec[];
  removeCriteria?: string[];
  hard?: Partial<HardConstraints>;
  commute?: Partial<Commute>;
  addAreas?: string[];
  addAssumptions?: string[];
  removeAssumptions?: string[];
  sources?: Partial<SourceScope>;
  seeds?: string[];
  removeSeeds?: string[];
  queries?: string[];
  note?: string;
}

export const DEFAULT_BUDGETS: Budgets = {
  maxListings: 300,
  maxUsd: 15,
  maxMinutes: 120,
  visionMax: 60,
  textMax: 50,
  htmlMax: 25,
};
