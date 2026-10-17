import {
  hasFoods,
  hasLighting,
  hasSpawnLocations,
  hasSupplements,
  isLivestock,
} from "@/forms/submission";
import type { Submission, SubmissionSupplement } from "@/db/submissions";
import { formatShortDate } from "@/utils/dateFormat";

/**
 * One line of the report: a label and what the member recorded, or null
 * when they recorded nothing. Null is not "No" and not "0": a member who
 * answered "No" to CO₂ or counted 0 fry recorded something.
 */
export type ReportRow = {
  id: string;
  label: string;
  value: string | null;
  /** Free text that may run long, given the full width rather than a column */
  wide?: boolean;
};

export type ReportSupplement = { type: string | null; regimen: string | null };

/**
 * What a Submission's report shows about the breeding and the tank (#559),
 * worked out here once from the Species type so the template carries no copy
 * of the form's applicability rules (`src/forms/submission.ts`).
 *
 * A field the form asks for on this Species type is always shown, unset or
 * not, so a reader can tell an older or incomplete report from a field that
 * does not apply. A field the form does not ask for is shown only when the
 * row holds a value anyway: older forms and the backfill asked every Program
 * everything, and what a member recorded is not hidden for being out of place.
 */
export type SubmissionReport = {
  species: ReportRow[];
  tank: ReportRow[];
  /** The Supplements section, or null when it neither applies nor holds anything */
  supplements: { co2: ReportRow[]; rows: ReportSupplement[] } | null;
};

/** A stored text column, trimmed, with blank read as unset. */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** A JSON string-array column as a list, or unset when empty or unreadable. */
function list(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const items = parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
      return items.length > 0 ? items.join(", ") : null;
    }
  } catch {
    // Not JSON: an older row may hold the plain text
  }
  return text(value);
}

function co2Answer(value: string | null | undefined): string | null {
  if (value === "yes") return "Yes";
  if (value === "no") return "No";
  return text(value);
}

/**
 * Keep a row when the form asks for it on this Species type, or when it holds
 * a value regardless.
 */
function keep(rows: Array<ReportRow & { applies: boolean }>): ReportRow[] {
  return rows
    .filter(({ applies, value }) => applies || value !== null)
    .map(({ id, label, value, wide }) => ({ id, label, value, wide }));
}

export function submissionReport(
  submission: Submission,
  supplements: SubmissionSupplement[]
): SubmissionReport {
  const type = submission.species_type;
  const livestock = isLivestock(type);
  const lighting = hasLighting(type);
  const supplementsApply = hasSupplements(type);

  const countLabel = livestock ? "# of Fry" : type === "Coral" ? "# of Frags" : "# of Plants";

  const species = keep([
    { id: "species_common_name", label: "Common Name", value: text(submission.species_common_name), applies: true },
    { id: "species_latin_name", label: "Latin Name", value: text(submission.species_latin_name), applies: true },
    {
      id: "reproduction_date",
      label: livestock ? "Date Spawned" : "Date Propagated",
      value: text(formatShortDate(submission.reproduction_date)),
      applies: true,
    },
    { id: "count", label: countLabel, value: text(submission.count), applies: livestock },
    { id: "species_type", label: "Species Type", value: text(type), applies: true },
    { id: "species_class", label: "Species Class", value: text(submission.species_class), applies: true },
    { id: "water_type", label: "Water Type", value: text(submission.water_type), applies: true },
    { id: "foods", label: "Foods", value: list(submission.foods), applies: hasFoods(type) },
    {
      id: "spawn_locations",
      label: "Spawn Locations",
      value: list(submission.spawn_locations),
      applies: hasSpawnLocations(type),
    },
    {
      id: "propagation_method",
      label: livestock ? "Breeding Method" : "Propagation Method",
      value: text(submission.propagation_method),
      applies: !livestock,
      wide: true,
    },
  ]);

  const tank = keep([
    { id: "tank_size", label: "Tank Size", value: text(submission.tank_size), applies: true },
    { id: "filter_type", label: "Filter Type", value: text(submission.filter_type), applies: true },
    {
      id: "water_change_volume",
      label: "Water Change Volume (%)",
      value: text(submission.water_change_volume),
      applies: true,
    },
    {
      id: "water_change_frequency",
      label: "Water Change Frequency",
      value: text(submission.water_change_frequency),
      applies: true,
    },
    { id: "temperature", label: "Temperature", value: text(submission.temperature), applies: true },
    { id: "ph", label: "pH", value: text(submission.ph), applies: true },
    { id: "gh", label: "Hardness (GH)", value: text(submission.gh), applies: true },
    { id: "specific_gravity", label: "Specific Gravity", value: text(submission.specific_gravity), applies: true },
    { id: "substrate_type", label: "Substrate Type", value: text(submission.substrate_type), applies: true },
    { id: "substrate_depth", label: "Substrate Depth", value: text(submission.substrate_depth), applies: true },
    { id: "substrate_color", label: "Substrate Color", value: text(submission.substrate_color), applies: true },
    { id: "light_type", label: "Lighting Type", value: text(submission.light_type), applies: lighting },
    { id: "light_strength", label: "Light Strength", value: text(submission.light_strength), applies: lighting },
    { id: "light_hours", label: "Light Hours", value: text(submission.light_hours), applies: lighting },
  ]);

  // "No" is the CO₂ default the old forms stored for every Program, so out of
  // place it says nothing; "Yes" does
  const co2 = co2Answer(submission.co2);
  const co2Rows = keep([
    {
      id: "co2",
      label: "CO₂",
      value: co2,
      applies: supplementsApply,
    },
    {
      id: "co2_description",
      label: "CO₂ Details",
      value: text(submission.co2_description),
      applies: supplementsApply && submission.co2 === "yes",
      wide: true,
    },
  ]).filter((row) => supplementsApply || !(row.id === "co2" && row.value === "No"));

  const rows = supplements
    .map((s) => ({ type: text(s.supplement_type), regimen: text(s.supplement_regimen) }))
    .filter((s) => s.type !== null || s.regimen !== null);

  return {
    species,
    tank,
    supplements:
      supplementsApply || co2Rows.length > 0 || rows.length > 0 ? { co2: co2Rows, rows } : null,
  };
}
