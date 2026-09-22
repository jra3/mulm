import { z } from "zod";
import { isPointClass, pointClasses } from "@/species";

/**
 * A form's Point class field: blank means unset, anything else must be one of
 * the tally keys. The catalogue refuses the same values; this check only gives
 * the form a friendlier message.
 */
export const pointClassField = z
  .string()
  .optional()
  .transform((val) => (val === undefined || val === "" ? null : Number(val)))
  .refine((val) => val === null || isPointClass(val), {
    message: `Point class must be ${pointClasses.slice(0, -1).join(", ")}, or ${pointClasses[pointClasses.length - 1]}`,
  });
