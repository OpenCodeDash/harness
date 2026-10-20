import type { DomainPack } from "../domain/types.ts";

export interface TextFact {
  key: string;
  value: unknown;
  confidence: number;
}

const escape = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const termRegex = (term: string) =>
  new RegExp(`\\b${escape(term)}(?:s|es)?\\b`, "i");

export function extractDescriptionFacts(
  description: string,
  pack: DomainPack,
): TextFact[] {
  if (!description.trim()) return [];

  const lower = ` ${description.toLowerCase().replace(/\s+/g, " ")} `;
  const facts = new Map<string, TextFact>();

  const add = (key: string, value: unknown, confidence = 0.6) => {
    if (!facts.has(key)) facts.set(key, { key, value, confidence });
  };

  const negated = (index: number) =>
    /(?:^| )(?:no|not|without|doesn'?t have|does not have)\s+(?:a\s+|an\s+)?$/.test(
      lower.slice(Math.max(0, index - 24), index),
    );

  const special = new Set(["furnished", "pets"]);
  for (const item of [...pack.imageFeatures, ...pack.fields]) {
    if (item.kind !== "boolean" || special.has(item.key)) continue;
    const terms = [item.label, ...(item.aliases ?? [])];
    for (const term of terms) {
      const match = termRegex(term).exec(lower);
      if (!match) continue;
      add(item.key, !negated(match.index));
      break;
    }
  }

  if (/no pets|pets (are )?not (allowed|permitted)|sorry,? no pets/.test(lower)) {
    add("pets", "no", 0.7);
  } else if (/pets negotiable/.test(lower)) {
    add("pets", "negotiable", 0.6);
  } else if (/pets (ok|allowed|welcome|permitted|considered)/.test(lower)) {
    add("pets", "yes", 0.6);
  }

  if (/unfurnished/.test(lower)) add("furnished", false, 0.7);
  else if (/furnished/.test(lower)) add("furnished", true, 0.6);

  return [...facts.values()];
}
