import type { PointsTally } from "@/programs";
import { CatalogueRefusal } from "./errors";

/**
 * A Species' Point class: the difficulty bucket its Submissions earn as base
 * points. The type is the Points tally's keys, so the catalogue and the Level
 * calculation cannot disagree on what a Point class is.
 */
export type PointClass = Exclude<keyof PointsTally, "total">;

export const pointClasses = [5, 10, 15, 20] as const satisfies readonly PointClass[];

// If the tally gains a key this list lacks, this line stops compiling.
const everyTallyKeyListed: Exclude<PointClass, (typeof pointClasses)[number]> extends never
  ? true
  : never = true;
void everyTallyKeyListed;

export function isPointClass(value: unknown): value is PointClass {
  return pointClasses.some((pc) => pc === value);
}

/**
 * Admit a Point class or unset, refuse anything else. Every catalogue writer
 * of `base_points` goes through this; forms keep their own check only for a
 * friendlier message.
 */
export function admitPointClass(value: number | null): PointClass | null {
  if (value === null) return null;
  if (!isPointClass(value)) {
    throw new CatalogueRefusal(
      `Point class must be one of ${pointClasses.join(", ")} or unset, not ${value}`,
      "point_class"
    );
  }
  return value;
}
