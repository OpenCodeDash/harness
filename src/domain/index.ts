import { propertyPack } from "./property.ts";
import type { DomainPack } from "./types.ts";

const packs: DomainPack[] = [propertyPack];

export function getPack(id: string): DomainPack {
  const pack = packs.find((candidate) => candidate.id === id);
  if (!pack) {
    throw new Error(
      `Unknown domain pack "${id}". Available: ${packs.map((p) => p.id).join(", ")}`,
    );
  }
  return pack;
}

export function listPacks(): DomainPack[] {
  return [...packs];
}
