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

const CAPACITY = /(\d+(?:\.\d+)?)\s*(TB|GB)\b/gi;

/**
 * Pull common capacity, battery and year facts out of free text such as a
 * listing title ("MacBook Air 16GB 512GB") or description. Domain-agnostic:
 * it only recognises explicit units and explicit labels.
 */
export function parseTextSpecs(text: string): Record<string, number> {
  const specs: Record<string, number> = {};
  if (!text.trim()) return specs;

  const capacities = [...text.matchAll(CAPACITY)].map((match) => {
    const amount = Number(match[1]);
    const unit = match[2]!.toUpperCase();
    const index = match.index ?? 0;
    const after = text.slice(index + match[0].length, index + match[0].length + 14);
    return {
      value: unit === "TB" ? amount * 1024 : amount,
      after,
    };
  });

  for (const capacity of capacities) {
    if (/^\s*(ram|memory|unified)/i.test(capacity.after)) {
      specs.ram_gb = capacity.value;
      break;
    }
  }
  for (const capacity of capacities) {
    if (/^\s*(ssd|hdd|storage|hard\s*drive)/i.test(capacity.after)) {
      specs.storage_gb = capacity.value;
      break;
    }
  }

  // Two bare capacities in a product title are almost always RAM + storage.
  if (capacities.length >= 2) {
    const values = [...new Set(capacities.map((entry) => entry.value))].sort(
      (a, b) => a - b,
    );
    if (specs.ram_gb === undefined && specs.storage_gb === undefined) {
      if (values.length >= 2) {
        specs.ram_gb = values[0]!;
        specs.storage_gb = values[values.length - 1]!;
      }
    } else if (specs.ram_gb === undefined) {
      const other = values.find(
        (value) => value !== specs.storage_gb && value <= 128,
      );
      if (other !== undefined) specs.ram_gb = other;
    } else if (specs.storage_gb === undefined) {
      const other = values.find(
        (value) => value !== specs.ram_gb && value >= specs.ram_gb!,
      );
      if (other !== undefined) specs.storage_gb = other;
    }
  }

  const battery =
    /battery(?:\s+health)?[^0-9]{0,12}(\d{1,3})\s*%/i.exec(text) ??
    /(\d{1,3})\s*%[^.\n]{0,24}battery/i.exec(text);
  if (battery?.[1]) specs.battery_health = Number(battery[1]);

  const year = /\b(20\d{2})\b/.exec(text);
  if (year?.[1]) specs.year = Number(year[1]);

  return specs;
}
