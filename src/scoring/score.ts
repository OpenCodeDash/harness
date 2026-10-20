import type { Brief } from "../brief/types.ts";
import type {
  CriterionSpec,
  DomainPack,
  HardPredicate,
  Normalizer,
} from "../domain/types.ts";
import { criterionFactKey } from "../domain/types.ts";

export interface Fact {
  key: string;
  value: unknown;
  sourceType: "page" | "image" | "inference" | "user";
  sourceRef: string;
  confidence: number;
  observedAt: string;
}

export type Facts = Map<string, Fact>;

export interface Gap {
  key: string;
  label: string;
  reason: string;
  investigate: boolean;
}

export interface CriterionBreakdown {
  key: string;
  label: string;
  weight: number;
  known: boolean;
  penalized: boolean;
  normalized: number | null;
  contribution: number;
  policy: "flag" | "penalize" | "ignored";
  origin: "explicit" | "suggested";
  sourceType: string;
  reason?: string;
}

export interface ScoreResult {
  score: number;
  coverage: number;
  hardPass: boolean;
  hardFailures: string[];
  breakdown: CriterionBreakdown[];
  gaps: Gap[];
  questions: string[];
  notes: string[];
}

export interface ScoreOptions {
  minConfidence?: number;
}

export const TIE_BAND = 0.03;
export const DEFAULT_MIN_CONFIDENCE = 0.5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function selectFacts(evidence: Fact[]): Facts {
  const best = new Map<string, Fact>();
  for (const fact of evidence) {
    const current = best.get(fact.key);
    if (!current) {
      best.set(fact.key, fact);
      continue;
    }
    const currentIsUser = current.sourceType === "user";
    const factIsUser = fact.sourceType === "user";
    if (!currentIsUser && factIsUser) {
      best.set(fact.key, fact);
      continue;
    }
    if (currentIsUser && !factIsUser) continue;
    if (fact.observedAt >= current.observedAt) best.set(fact.key, fact);
  }
  return best;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/[^0-9.+-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "present", "available", "has"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "n", "0", "absent", "none", "unavailable"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

export function normalizeValue(
  normalizer: Normalizer,
  value: unknown,
): number | null {
  switch (normalizer.type) {
    case "boolean": {
      const parsed = toBoolean(value);
      if (parsed === null) return null;
      return parsed === (normalizer.prefer ?? true) ? 1 : 0;
    }
    case "lower-is-better": {
      const parsed = toNumber(value);
      if (parsed === null) return null;
      if (normalizer.max <= 0) return parsed <= 0 ? 1 : 0;
      return clamp01(1 - parsed / normalizer.max);
    }
    case "higher-is-better": {
      const parsed = toNumber(value);
      if (parsed === null || normalizer.max <= 0) return null;
      return clamp01(parsed / normalizer.max);
    }
    case "range": {
      const parsed = toNumber(value);
      if (parsed === null) return null;
      if (parsed >= normalizer.min && parsed <= normalizer.max) return 1;
      const distance =
        parsed < normalizer.min
          ? normalizer.min - parsed
          : parsed - normalizer.max;
      const width = Math.max(1, normalizer.max - normalizer.min + 1);
      return clamp01(1 - distance / width);
    }
    case "enum": {
      if (typeof value !== "string") return null;
      const score = normalizer.scores[value.trim().toLowerCase()];
      return score === undefined ? null : clamp01(score);
    }
  }
}

export function scoreListing(
  brief: Brief,
  pack: DomainPack,
  facts: Facts,
  options: ScoreOptions = {},
): ScoreResult {
  void pack;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const hardFailures = checkHardConstraints(brief, facts, minConfidence);
  const breakdown: CriterionBreakdown[] = [];
  const gaps: Gap[] = [];
  const notes: string[] = [];

  let weightedSum = 0;
  let scoredMass = 0;
  let coveredMass = 0;
  let totalMass = 0;

  for (const criterion of brief.criteria) {
    const weight = criterion.weight;
    if (weight <= 0) {
      breakdown.push(ignored(criterion, weight));
      continue;
    }

    totalMass += weight;
    const fact = facts.get(criterionFactKey(criterion));
    const configured = criterion.unknown ?? brief.unknownPolicy;
    const policy = configured === "investigate" ? "flag" : configured;
    const lowConfidence =
      fact !== undefined && fact.confidence < minConfidence;
    const normalized =
      fact && !lowConfidence
        ? normalizeValue(criterion.normalizer, fact.value)
        : null;

    if (fact && !lowConfidence && normalized !== null) {
      const contribution = normalized * weight;
      weightedSum += contribution;
      scoredMass += weight;
      coveredMass += weight;
      breakdown.push({
        key: criterion.key,
        label: criterion.label,
        weight,
        known: true,
        penalized: false,
        normalized,
        contribution,
        policy,
        origin: criterion.origin,
        sourceType: criterion.source.type,
      });
      continue;
    }

    const reason = !fact
      ? "missing"
      : lowConfidence
        ? `low confidence (${fact.confidence})`
        : "unrecognised value";
    const penalized = policy === "penalize";
    if (penalized) scoredMass += weight;
    breakdown.push({
      key: criterion.key,
      label: criterion.label,
      weight,
      known: false,
      penalized,
      normalized: null,
      contribution: 0,
      policy,
      origin: criterion.origin,
      sourceType: criterion.source.type,
      reason,
    });
    gaps.push({
      key: criterion.key,
      label: criterion.label,
      reason,
      investigate: configured === "investigate",
    });
  }

  return {
    score: scoredMass > 0 ? weightedSum / scoredMass : 0,
    coverage: totalMass > 0 ? coveredMass / totalMass : 0,
    hardPass: hardFailures.length === 0,
    hardFailures,
    breakdown,
    gaps,
    questions: gaps.map((gap) => `Can you confirm ${gap.label.toLowerCase()}?`),
    notes,
  };
}

function ignored(
  criterion: CriterionSpec,
  weight: number,
): CriterionBreakdown {
  return {
    key: criterion.key,
    label: criterion.label,
    weight,
    known: false,
    penalized: false,
    normalized: null,
    contribution: 0,
    policy: "ignored",
    origin: criterion.origin,
    sourceType: criterion.source.type,
    reason: "weight is zero",
  };
}

function numberFact(
  facts: Facts,
  key: string,
  minConfidence: number,
): number | null {
  const fact = facts.get(key);
  if (!fact || fact.confidence < minConfidence) return null;
  return toNumber(fact.value);
}

function stringFact(facts: Facts, key: string): string | null {
  const fact = facts.get(key);
  if (!fact || typeof fact.value !== "string") return null;
  return fact.value;
}

function matches(value: unknown, expected: unknown): boolean {
  if (typeof expected === "boolean") return toBoolean(value) === expected;
  if (typeof expected === "number") return toNumber(value) === expected;
  return (
    String(value).trim().toLowerCase() ===
    String(expected).trim().toLowerCase()
  );
}

export function matchesHard(value: unknown, hard: HardPredicate): boolean {
  switch (hard.op) {
    case "eq":
      return matches(value, hard.value);
    case "in":
      return hard.values.some((candidate) => matches(value, candidate));
    case "lte": {
      const number = toNumber(value);
      return number !== null && number <= hard.value;
    }
    case "gte": {
      const number = toNumber(value);
      return number !== null && number >= hard.value;
    }
    case "range": {
      const number = toNumber(value);
      if (number === null) return false;
      if (hard.min !== undefined && number < hard.min) return false;
      if (hard.max !== undefined && number > hard.max) return false;
      return true;
    }
  }
}

export function checkHardConstraints(
  brief: Brief,
  facts: Facts,
  minConfidence: number = DEFAULT_MIN_CONFIDENCE,
): string[] {
  const failures: string[] = [];

  if (brief.hard.rentMax !== undefined) {
    const rent = numberFact(facts, "rent", minConfidence);
    if (rent === null) failures.push("rent unknown");
    else if (rent > brief.hard.rentMax) {
      failures.push(`rent ${rent} > ${brief.hard.rentMax}`);
    }
  }

  if (brief.hard.bedrooms) {
    const bedrooms = numberFact(facts, "bedrooms", minConfidence);
    if (bedrooms === null) failures.push("bedrooms unknown");
    else {
      const { min, max } = brief.hard.bedrooms;
      if (min !== undefined && bedrooms < min) {
        failures.push(`bedrooms ${bedrooms} < ${min}`);
      }
      if (max !== undefined && bedrooms > max) {
        failures.push(`bedrooms ${bedrooms} > ${max}`);
      }
    }
  }

  if (brief.hard.areas?.length) {
    const location = [
      stringFact(facts, "suburb"),
      stringFact(facts, "address"),
      stringFact(facts, "area"),
      stringFact(facts, "district"),
    ]
      .filter((part): part is string => Boolean(part))
      .join(" ")
      .toLowerCase();
    if (!location) failures.push("area unknown");
    else if (
      !brief.hard.areas.some((area) => location.includes(area.toLowerCase()))
    ) {
      failures.push(`outside areas: ${brief.hard.areas.join(", ")}`);
    }
  }

  if (brief.hard.required) {
    for (const [key, expected] of Object.entries(brief.hard.required)) {
      const fact = facts.get(key);
      if (!fact) failures.push(`${key} unknown`);
      else if (!matches(fact.value, expected)) {
        failures.push(`${key} != ${JSON.stringify(expected)}`);
      }
    }
  }

  const commute = brief.anchors.commute;
  if (commute?.hard) {
    const commuteCriterion = brief.criteria.find(
      (criterion) =>
        criterion.source.type === "derived" &&
        criterion.source.evaluator === "commute",
    );
    const commuteKey = commuteCriterion
      ? criterionFactKey(commuteCriterion)
      : "commute";
    const minutes = numberFact(facts, commuteKey, minConfidence);
    if (minutes === null) failures.push("commute unknown");
    else if (minutes > commute.maxMinutes) {
      failures.push(`commute ${minutes} min > ${commute.maxMinutes}`);
    }
  }

  for (const criterion of brief.criteria) {
    if (!criterion.hard) continue;
    const fact = facts.get(criterionFactKey(criterion));
    if (!fact || fact.confidence < minConfidence) {
      failures.push(`${criterion.label} unknown`);
      continue;
    }
    if (!matchesHard(fact.value, criterion.hard)) {
      failures.push(`${criterion.label} fails ${criterion.hard.op}`);
    }
  }

  return failures;
}

export function isTie(a: number, b: number): boolean {
  return Math.abs(a - b) <= TIE_BAND;
}
