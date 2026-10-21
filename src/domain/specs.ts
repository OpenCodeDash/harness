const UNIT_SUFFIX = /_(gb|tb|mb|mm|cm|inch|in|kg|kw|hz|mah|w)$/;

const ALIASES: Record<string, string[]> = {
  ram_gb: ["ram", "memory", "ram_size", "memory_size", "installed_memory"],
  storage_gb: [
    "storage",
    "ssd",
    "hdd",
    "hard_drive",
    "hard_drive_size",
    "disk_size",
    "capacity",
  ],
  battery_health: [
    "battery_health",
    "battery",
    "battery_capacity",
    "maximum_capacity",
  ],
  screen_size: ["screen_size", "display_size", "screen"],
  mileage: ["mileage", "odometer", "kilometres", "km"],
  price: ["price", "cost", "asking_price"],
};

export function normaliseSpecKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function baseKey(value: string): string {
  return normaliseSpecKey(value).replace(UNIT_SUFFIX, "");
}

/**
 * Map a criterion field key onto a key present in a listing's specs.
 * Exact matches win; then known unit aliases; then a conservative fuzzy match
 * on the unit-stripped names.
 */
export function resolveSpecKey(
  field: string,
  available: string[],
): string | null {
  const target = normaliseSpecKey(field);
  if (!target) return null;
  const normalised = available.map((key) => ({ key, value: normaliseSpecKey(key) }));
  const exact = normalised.find((entry) => entry.value === target);
  if (exact) return exact.key;

  const aliases = ALIASES[target] ?? [];
  for (const alias of aliases) {
    const match = normalised.find((entry) => entry.value === alias);
    if (match) return match.key;
  }
  for (const alias of aliases) {
    const match = normalised.find(
      (entry) =>
        entry.value.includes(alias) || alias.includes(entry.value),
    );
    if (match) return match.key;
  }

  const base = baseKey(field);
  if (base.length >= 3) {
    const match = normalised.find((entry) => {
      const candidate = baseKey(entry.value);
      return (
        candidate.length >= 3 &&
        (candidate.includes(base) || base.includes(candidate))
      );
    });
    if (match) return match.key;
  }
  return null;
}

/** Flatten a `specs` field value into individual evidence keys. */
export function flattenSpecs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const flattened: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || entry === "") continue;
    const normalised = normaliseSpecKey(key);
    if (!normalised) continue;
    flattened[normalised] = entry;
  }
  return flattened;
}
