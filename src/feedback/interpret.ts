import { applyBriefDelta } from "../brief/brief.ts";
import type {
  Brief,
  BriefDelta,
  Commute,
  FeedbackAction,
  HardConstraints,
} from "../brief/types.ts";
import type { DomainPack } from "../domain/types.ts";
import { findField, findImageFeature } from "../domain/types.ts";
import { resolveKey } from "../brief/brief.ts";

export interface Interpretation {
  delta: BriefDelta;
  summary: string;
  changed: boolean;
  unparsed: string[];
}

const escape = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const termRegex = (term: string) =>
  new RegExp(`\\b${escape(term)}(?:s|es)?\\b`, "i");

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function labelFor(pack: DomainPack, key: string): string {
  return (
    pack.defaultCriteria.find((criterion) => criterion.key === key)?.label ??
    findField(pack, key)?.label ??
    findImageFeature(pack, key)?.label ??
    key
  );
}

function termsForKey(pack: DomainPack, key: string): string[] {
  const source = findField(pack, key) ?? findImageFeature(pack, key);
  const criterion = pack.defaultCriteria.find((item) => item.key === key);
  const terms = [
    key,
    criterion?.label,
    source?.label,
    ...(source?.aliases ?? []),
  ].filter((term): term is string => Boolean(term));
  return [...new Set(terms.map((term) => term.toLowerCase()))];
}

function mention(
  text: string,
  terms: string[],
): { index: number; window: string } | null {
  let best: { index: number; window: string } | null = null;
  for (const term of terms) {
    const match = termRegex(term).exec(text);
    if (!match) continue;
    const start = match.index;
    const window = text
      .slice(Math.max(0, start - 40), start + match[0].length + 40)
      .toLowerCase();
    if (!best || start < best.index) best = { index: start, window };
  }
  return best;
}

export function interpretFeedback(
  text: string,
  brief: Brief,
  pack: DomainPack,
): Interpretation {
  const lower = text.toLowerCase();
  const summary: string[] = [];
  const setWeights: Record<string, number> = {};

  for (const criterion of brief.criteria) {
    const found = mention(text, [
      ...termsForKey(pack, criterion.key),
      criterion.label.toLowerCase(),
    ]);
    if (!found) continue;
    const window = found.window;
    let weight: number | null = null;
    if (
      /(don'?t care|do not care|not important|ignore|drop|no longer|doesn'?t matter)/.test(
        window,
      )
    ) {
      weight = 0;
    } else if (
      /(prioriti[sz]e|most important|really want|must have|care about)/.test(
        window,
      )
    ) {
      weight = 1;
    } else if (/more important/.test(window)) {
      weight = clamp01(criterion.weight + 0.2);
    } else if (/less important/.test(window)) {
      weight = clamp01(criterion.weight - 0.2);
    }
    if (weight !== null) {
      setWeights[criterion.key] = weight;
      summary.push(`${criterion.label} ${weight.toFixed(2)}`);
    }
  }

  let commute: Partial<Commute> | undefined;
  if (/\b(commute|drive|travel|far|work)\b/.test(lower)) {
    const matches = [...lower.matchAll(/(\d{1,3})\s*(?:min|mins|minutes)\b/g)];
    const makeIt = /make it\s+(\d{1,3})/.exec(lower);
    const minutes = makeIt?.[1]
      ? Number(makeIt[1])
      : matches.at(-1)?.[1]
        ? Number(matches.at(-1)![1])
        : null;
    if (minutes !== null && Number.isFinite(minutes)) {
      const hard = /(too far|max|within|no more than|must|limit)/.test(lower);
      commute = { maxMinutes: minutes, hard };
      summary.push(`commute <= ${minutes} min${hard ? " (hard)" : ""}`);
    }
  }

  let rentMax: number | undefined;
  const rentMatches = [
    ...lower.matchAll(
      /(?:under|below|max(?:imum)?|up to|no more than|limit(?:ed)?(?: to)?|\$)\s*\$?\s*(\d{2,5})/g,
    ),
  ];
  if (/(rent|price|week)/.test(lower)) {
    const last = rentMatches.at(-1);
    if (last?.[1]) {
      rentMax = Number(last[1]);
      summary.push(`rent <= ${rentMax}`);
    }
  }

  let bedrooms: { min?: number; max?: number } | undefined;
  const range = /(\d)\s*(?:-|to)\s*(\d)\s*(?:bed|bedroom)/.exec(lower);
  const atLeast = /(?:at least|min(?:imum)?)\s*(\d)\s*(?:bed|bedroom)/.exec(lower);
  const single = /(\d)\s*(?:bed|bedroom)/.exec(lower);
  if (range?.[1] && range[2]) {
    bedrooms = { min: Number(range[1]), max: Number(range[2]) };
    summary.push(`bedrooms ${bedrooms.min}-${bedrooms.max}`);
  } else if (atLeast?.[1]) {
    bedrooms = { min: Number(atLeast[1]) };
    summary.push(`bedrooms >= ${bedrooms.min}`);
  } else if (single?.[1]) {
    bedrooms = { min: Number(single[1]), max: Number(single[1]) };
    summary.push(`bedrooms ${bedrooms.min}-${bedrooms.max}`);
  }

  const addAreas: string[] = [];
  const areaPattern =
    /(?:look at|consider|include|add|expand to|search in)\s+([A-Z][\p{L}]+(?:\s+[A-Z][\p{L}]+)*)/gu;
  for (const match of text.matchAll(areaPattern)) {
    const area = match[1]?.trim();
    if (area) addAreas.push(area);
  }
  if (addAreas.length) {
    summary.push(`areas +${[...new Set(addAreas)].join(", ")}`);
  }

  const required: Record<string, unknown> = {};
  for (const match of lower.matchAll(/must have\s+(?:a\s+|an\s+)?([a-z ]{3,30})/g)) {
    const key = resolveKey(pack, match[1]!.trim());
    if (key) {
      required[key] = true;
      summary.push(`${labelFor(pack, key)}=yes`);
    }
  }
  for (const match of lower.matchAll(/(?:no|without)\s+(?:a\s+|an\s+)?([a-z ]{3,30})/g)) {
    const phrase = match[1]!.trim();
    if (/^more than/.test(phrase)) continue;
    const key = resolveKey(pack, phrase);
    if (key) {
      required[key] = false;
      summary.push(`${labelFor(pack, key)}=no`);
    }
  }

  const typeField = findField(pack, "property_type");
  let propertyType: string | undefined;
  if (typeField?.options && /(missed|include|also|only|want|prefer|look)/.test(lower)) {
    for (const option of typeField.options) {
      if (new RegExp(`\\b${escape(option)}s?\\b`, "i").test(lower)) {
        propertyType = option;
        summary.push(`property_type=${option}`);
        break;
      }
    }
  }

  const features = new Set<string>();
  if (/(check|look|inspect|detect|find|see|photo|image)/.test(lower)) {
    for (const feature of pack.imageFeatures) {
      const terms = [
        feature.key,
        feature.label,
        ...(feature.aliases ?? []),
      ];
      if (terms.some((term) => termRegex(term).test(text))) {
        features.add(feature.key);
      }
    }
  }
  for (const feature of features) {
    summary.push(`re-extract ${labelFor(pack, feature).toLowerCase()}`);
  }

  let action: FeedbackAction = "re-score";
  if (addAreas.length || propertyType) action = "re-search";
  else if (features.size) action = "re-extract";

  const hard: Partial<HardConstraints> = {};
  if (rentMax !== undefined) hard.rentMax = rentMax;
  if (bedrooms) hard.bedrooms = bedrooms;
  if (Object.keys(required).length) hard.required = required;
  if (propertyType) hard.required = { ...(hard.required ?? {}), property_type: propertyType };

  const delta: BriefDelta = { action };
  if (Object.keys(setWeights).length) delta.setWeights = setWeights;
  if (commute) delta.commute = commute;
  if (Object.keys(hard).length) delta.hard = hard;
  if (addAreas.length) delta.addAreas = [...new Set(addAreas)];
  if (features.size) delta.features = [...features];

  if (summary.length === 0) {
    return {
      delta: { action: "re-score" },
      summary: "No change understood.",
      changed: false,
      unparsed: [text],
    };
  }

  return {
    delta,
    summary: `Understood: ${summary.join(" · ")} [${action}]`,
    changed: true,
    unparsed: [],
  };
}

export function applyFeedback(
  brief: Brief,
  text: string,
  pack: DomainPack,
): Interpretation & { brief: Brief } {
  const interpretation = interpretFeedback(text, brief, pack);
  if (!interpretation.changed) {
    return { ...interpretation, brief };
  }
  return {
    ...interpretation,
    brief: applyBriefDelta(brief, interpretation.delta, pack),
  };
}
