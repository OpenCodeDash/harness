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

export interface SoftCriterion {
  key: string;
  weight: number;
}

export type UnknownPolicy = "flag" | "penalize" | "investigate";

export interface Budgets {
  maxListings: number;
  maxUsd: number;
  maxMinutes: number;
  visionMax: number;
}

export interface Brief {
  version: number;
  domain: string;
  prompt: string;
  anchors: { work?: Anchor; commute?: Commute };
  hard: HardConstraints;
  soft: SoftCriterion[];
  unknownPolicy: UnknownPolicy;
  budgets: Budgets;
  assumptions: string[];
}

export type FeedbackAction = "re-score" | "re-extract" | "re-search";

export interface BriefDelta {
  action: FeedbackAction;
  setWeights?: Record<string, number>;
  hard?: Partial<HardConstraints>;
  commute?: Partial<Commute>;
  addAreas?: string[];
  addAssumptions?: string[];
  removeAssumptions?: string[];
  features?: string[];
  queries?: string[];
  note?: string;
}

export const DEFAULT_BUDGETS: Budgets = {
  maxListings: 300,
  maxUsd: 15,
  maxMinutes: 120,
  visionMax: 60,
};
