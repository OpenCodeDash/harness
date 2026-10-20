import { carsPack } from "./cars.ts";
import { genericPack } from "./generic.ts";
import { laptopsPack } from "./laptops.ts";
import { propertyPack } from "./property.ts";
import type { DomainPack } from "./types.ts";

const packs: DomainPack[] = [genericPack, propertyPack, carsPack, laptopsPack];

export function findPack(id: string): DomainPack | undefined {
  return packs.find((candidate) => candidate.id === id);
}

/** Resolve a pack preset; unknown ids fall back to the generic vocabulary. */
export function getPack(id?: string): DomainPack {
  return findPack(id ?? genericPack.id) ?? genericPack;
}

export function listPacks(): DomainPack[] {
  return [...packs];
}
