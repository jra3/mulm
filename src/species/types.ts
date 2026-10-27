import type { SpeciesType } from "@/points";
import { admitPointClass, type PointClass } from "./pointClass";

/**
 * A Species as the catalogue returns it: the identity row. `group_id` and the
 * other snake_case names are the schema's (`species_name_group`) and stay until
 * a migration renames them. The IUCN columns ride along read-only; the
 * catalogue never writes them.
 */
export type Species = {
  group_id: number;
  program_class: string;
  species_type: SpeciesType;
  canonical_genus: string;
  canonical_species_name: string;
  /** The Point class, or null when unset. */
  base_points: PointClass | null;
  is_cares_species: boolean;
  iucn_redlist_category?: string | null;
  iucn_population_trend?: string | null;
  iucn_redlist_url?: string | null;
  iucn_redlist_id?: number | null;
  iucn_last_updated?: string | null;
};

export type NameKind = "common" | "scientific";

export const nameKinds: readonly NameKind[] = ["common", "scientific"];

/** One Name of a Species. `name_id` is unique within its kind only. */
export type Name = {
  name_id: number;
  species_id: number;
  kind: NameKind;
  name: string;
  /**
   * Whether this is the Species' Canonical name: true for exactly one
   * scientific Name of each Species (ADR-0002), never for a common Name.
   */
  canonical: boolean;
};

/** A Species' Names, by kind, each list alphabetical. */
export type SpeciesNames = Record<NameKind, Name[]>;

export const speciesTypes = [
  "Fish",
  "Plant",
  "Invert",
  "Coral",
] as const satisfies readonly SpeciesType[];

export function isSpeciesType(value: string): value is SpeciesType {
  return speciesTypes.some((t) => t === value);
}

/** A `species_name_group` row as SQLite returns it. */
export type SpeciesRow = Omit<Species, "species_type" | "base_points" | "is_cares_species"> & {
  species_type: string;
  base_points: number | null;
  is_cares_species: number;
};

/**
 * Parse a `species_name_group` row into a Species. The schema's CHECK and the
 * catalogue's writers keep these columns valid, so a row that fails is
 * corrupt and throws.
 */
export function speciesOfRow(row: SpeciesRow): Species {
  if (!isSpeciesType(row.species_type)) {
    throw new Error(`Species ${row.group_id} has an unknown Species type: ${row.species_type}`);
  }
  return {
    ...row,
    species_type: row.species_type,
    base_points: admitPointClass(row.base_points),
    is_cares_species: row.is_cares_species === 1,
  };
}

/** The Canonical name as one string, genus then epithet. */
export function canonicalName(species: Pick<Species, "canonical_genus" | "canonical_species_name">) {
  return `${species.canonical_genus} ${species.canonical_species_name}`;
}
