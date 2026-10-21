export interface RawListing {
  source: string;
  externalId: string;
  url: string;
  fields: Record<string, unknown>;
  media: string[];
  raw?: unknown;
}

export interface RecipePage {
  waitFor(script: string, timeoutMs?: number): Promise<void>;
  evaluate<T>(script: string): Promise<T>;
}

export interface Recipe {
  id: string;
  domain: string;
  version: number;
  /** Higher wins when several recipes match the same URL. Defaults to 0. */
  priority?: number;
  matches(url: string): boolean;
  isListing(url: string): boolean;
  searchReady: string;
  listingReady: string;
  searchScript: string;
  listingScript: string;
}

export class RecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeError";
  }
}

function absoluteUrl(value: string, base: string): string | null {
  if (!value.trim()) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

export function validateRawListing(
  value: unknown,
  recipe: Recipe,
  baseUrl: string,
  index?: number,
): RawListing {
  const label = index === undefined ? recipe.id : `${recipe.id}[${index}]`;
  if (!value || typeof value !== "object") {
    throw new RecipeError(`${label}: expected an object`);
  }
  const item = value as Record<string, unknown>;
  const externalId =
    typeof item.externalId === "number"
      ? String(item.externalId)
      : typeof item.externalId === "string"
        ? item.externalId
        : null;
  if (!externalId) throw new RecipeError(`${label}: missing externalId`);

  const rawUrl = typeof item.url === "string" ? item.url : "";
  const url = absoluteUrl(rawUrl, baseUrl);
  if (!url) throw new RecipeError(`${label}: missing or invalid url`);

  const fields =
    item.fields && typeof item.fields === "object"
      ? (item.fields as Record<string, unknown>)
      : {};

  const media = Array.isArray(item.media)
    ? item.media
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => absoluteUrl(entry, baseUrl))
        .filter((entry): entry is string => Boolean(entry))
    : [];

  return {
    source: recipe.id,
    externalId,
    url,
    fields,
    media,
    raw: item.raw,
  };
}

export function validateSearchResults(
  value: unknown,
  recipe: Recipe,
  baseUrl: string,
): RawListing[] {
  if (!Array.isArray(value)) {
    throw new RecipeError(`${recipe.id}: search did not return an array`);
  }
  const seen = new Set<string>();
  const listings: RawListing[] = [];
  for (const [index, entry] of value.entries()) {
    const listing = validateRawListing(entry, recipe, baseUrl, index);
    if (seen.has(listing.externalId)) continue;
    seen.add(listing.externalId);
    listings.push(listing);
  }
  return listings;
}

export async function runSearch(
  page: RecipePage,
  recipe: Recipe,
  baseUrl: string,
): Promise<RawListing[]> {
  await page.waitFor(recipe.searchReady);
  const raw = await page.evaluate<unknown>(recipe.searchScript);
  return validateSearchResults(raw, recipe, baseUrl);
}

export async function runListing(
  page: RecipePage,
  recipe: Recipe,
  url: string,
): Promise<RawListing> {
  await page.waitFor(recipe.listingReady);
  const raw = await page.evaluate<unknown>(recipe.listingScript);
  const listing = validateRawListing(raw, recipe, url);
  return { ...listing, url };
}

const registry: Recipe[] = [];

export function registerRecipe(recipe: Recipe): void {
  const existing = registry.findIndex((item) => item.id === recipe.id);
  if (existing >= 0) registry.splice(existing, 1);
  registry.push(recipe);
}

export function getRecipeFor(url: string): Recipe | null {
  const matches = registry.filter((recipe) => recipe.matches(url));
  matches.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return matches[0] ?? null;
}

export function listRecipes(): Recipe[] {
  return [...registry];
}
