import type { SourceScope } from "../brief/types.ts";
import type { DiscoverySource } from "./discovery.ts";

export interface SourceSkip {
  id: string;
  label: string;
  reason: string;
}

export interface SourceSelection {
  active: DiscoverySource[];
  skipped: SourceSkip[];
  warnings: string[];
}

function normalise(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function sourceNames(source: DiscoverySource): string[] {
  return [source.id, ...(source.discovery?.sites ?? [])].map(normalise);
}

function matchesSource(entry: string, source: DiscoverySource): boolean {
  const target = normalise(entry);
  if (!target) return false;
  return sourceNames(source).some(
    (name) =>
      name === target ||
      name.endsWith(`.${target}`) ||
      target.endsWith(`.${name}`),
  );
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function matchesHost(entry: string, url: string): boolean {
  const host = hostOf(url);
  const target = normalise(entry);
  if (!host || !target) return false;
  return host === target || host.endsWith(`.${target}`);
}

function sourceKind(source: DiscoverySource): "structured" | "html" {
  return source.discovery?.kind ?? "structured";
}

export function selectSources(
  sources: DiscoverySource[],
  scope: SourceScope,
): SourceSelection {
  const skipped: SourceSkip[] = [];
  const warnings: string[] = [];

  const active = sources.filter((source) => {
    const label = source.discovery?.label ?? source.id;
    const skip = (reason: string): boolean => {
      skipped.push({ id: source.id, label, reason });
      return false;
    };

    if (scope.deny?.some((entry) => matchesSource(entry, source))) {
      return skip("denied");
    }
    if (scope.web === "off" && !scope.allow?.length) {
      return skip("open web is off");
    }
    if (
      scope.allow?.length &&
      !scope.allow.some((entry) => matchesSource(entry, source))
    ) {
      return skip("not allowed");
    }
    if (scope.web === "structured-only" && sourceKind(source) === "html") {
      return skip("structured sources only");
    }
    return true;
  });

  for (const entry of scope.allow ?? []) {
    if (!sources.some((source) => matchesSource(entry, source))) {
      warnings.push(`allowed source "${entry}" is not registered`);
    }
  }
  for (const entry of scope.deny ?? []) {
    if (!sources.some((source) => matchesSource(entry, source))) {
      warnings.push(`denied source "${entry}" is not registered`);
    }
  }

  const rank = (source: DiscoverySource): number => {
    const index = (scope.prefer ?? []).findIndex((entry) =>
      matchesSource(entry, source),
    );
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  active.sort((a, b) => rank(a) - rank(b));

  return { active, skipped, warnings };
}

export function isUrlAllowed(
  url: string,
  scope: SourceScope,
  sources: DiscoverySource[],
  recipeId?: string,
): boolean {
  const hostMatches = (entry: string): boolean => matchesHost(entry, url);
  const sourceOwnsUrl = (entry: string): boolean =>
    sources.some(
      (source) =>
        matchesSource(entry, source) &&
        (source.discovery?.sites ?? []).some(hostMatches),
    );
  const recipeMatches = (entry: string): boolean => {
    if (!recipeId) return false;
    const recipe = sources.find((candidate) => candidate.id === recipeId);
    return recipe ? matchesSource(entry, recipe) : false;
  };
  const matched = (entry: string): boolean =>
    hostMatches(entry) || sourceOwnsUrl(entry) || recipeMatches(entry);

  if ((scope.deny ?? []).some(matched)) {
    return false;
  }
  if (scope.web === "off" && !scope.allow?.length) return false;
  if (scope.allow?.length && !scope.allow.some(matched)) {
    return false;
  }
  if (scope.web === "structured-only") {
    const source = sources.find((candidate) => candidate.id === recipeId);
    if ((source?.discovery?.kind ?? "structured") === "html") return false;
  }
  return true;
}
