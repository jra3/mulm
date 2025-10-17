import * as z from "zod";
import { multiSelect } from "./utils";

export const isLivestock = (speciesType: string) =>
  speciesType === "Fish" || speciesType === "Invert";

export const hasFoods = (speciesType: string) =>
  speciesType === "Fish" || speciesType === "Invert" || speciesType === "Coral";

export const hasSpawnLocations = (speciesType: string) =>
  speciesType === "Fish" || speciesType === "Invert";

export const hasLighting = (speciesType: string) =>
  speciesType === "Plant" || speciesType === "Coral";

export const hasSupplements = (speciesType: string) =>
  speciesType === "Plant" || speciesType === "Coral";

export function getBapFormTitle(selectedType: string) {
  switch (selectedType) {
    default:
    case "Fish":
    case "Invert":
      return "Breeder Awards Submission";
    case "Plant":
      return "Horticultural Awards Submission";
    case "Coral":
      return "Coral Awards Submission";
  }
}

export function getClassOptions(speciesType: string) {
  const options = speciesTypesAndClasses[speciesType] ?? [];
  return options.map((option) => ({ value: option, text: option }));
}

const waterTypeEnum = z.enum(["Fresh", "Brackish", "Salt"]);
const speciesTypeEnum = z.enum(["Fish", "Invert", "Plant", "Coral"]);

export const bapFields = z.object({
  id: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : undefined)),
  member_id: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : undefined)),
  member_name: z.string().min(1, "Required").max(100, "Name too long (max 100 characters)").optional(),
  member_email: z
    .string()
    .email("Valid address required")
    .max(100, "Email too long (max 100 characters)")
    .optional(),
  water_type: waterTypeEnum,
  species_type: speciesTypeEnum,
  reproduction_date: z.string().refine(
    (date) => {
      if (date === "") {
        return false;
      }
      const parsed = Date.parse(date);
      if (isNaN(parsed)) {
        return false;
      }
      return true;
    },
    { message: "Required" }
  ),

  species_class: z.string().min(1, "Required").max(100, "Class too long (max 100 characters)"),
  species_latin_name: z
    .string()
    .min(1, "Required")
    .max(200, "Species name too long (max 200 characters)"),
  species_common_name: z
    .string()
    .min(1, "Required")
    .max(200, "Common name too long (max 200 characters)"),
  // species_name_id removed - submissions now use common_name_id/scientific_name_id set during approval

  count: z.string().max(20, "Count too long (max 20 characters)").optional(),
  foods: multiSelect.optional(),
  spawn_locations: multiSelect.optional(),
  propagation_method: z
    .string()
    .max(500, "Method description too long (max 500 characters)")
    .optional(),

  tank_size: z.string().min(1, "Required").max(50, "Tank size too long (max 50 characters)"),
  filter_type: z
    .string()
    .min(1, "Required")
    .max(200, "Filter description too long (max 200 characters)"),
  water_change_volume: z.string().min(1, "Required").max(20, "Volume too long (max 20 characters)"),
  water_change_frequency: z
    .string()
    .min(1, "Required")
    .max(100, "Frequency too long (max 100 characters)"),
  temperature: z.string().min(1, "Required").max(20, "Temperature too long (max 20 characters)"),
  ph: z.string().min(1, "Required").max(10, "pH value too long (max 10 characters)"),
  gh: z.string().max(10, "GH value too long (max 10 characters)").optional(),
  specific_gravity: z.string().max(10, "Specific gravity too long (max 10 characters)").optional(),
  substrate_type: z
    .string()
    .min(1, "Required")
    .max(200, "Substrate description too long (max 200 characters)"),
  substrate_depth: z
    .string()
    .min(1, "Required")
    .max(50, "Substrate depth too long (max 50 characters)"),
  substrate_color: z
    .string()
    .min(1, "Required")
    .max(50, "Substrate color too long (max 50 characters)"),

  light_type: z.string().max(200, "Light type too long (max 200 characters)").optional(),
  light_strength: z.string().max(50, "Light strength too long (max 50 characters)").optional(),
  light_hours: z.string().max(20, "Light hours too long (max 20 characters)").optional(),

  supplement_type: multiSelect.optional(),
  supplement_regimen: multiSelect.optional(),

  co2: z.enum(["no", "yes"]).optional(),
  co2_description: z.string().max(1000, "Description too long (max 1000 characters)").optional(),

  images: z.string().optional(), // JSON string of image metadata
  video_url: z
    .string()
    .url("Must be a valid URL")
    .max(500, "URL too long (max 500 characters)")
    .optional()
    .or(z.literal("")),
  article_link: z
    .string()
    .url("Must be a valid URL")
    .max(500, "URL too long (max 500 characters)")
    .optional()
    .or(z.literal("")),
});

export const bapDraftForm = bapFields.partial();

export const bapForm = bapFields
  .refine((data) => !isLivestock(data.species_type) || Boolean(data.count), {
    message: "Required",
    path: ["count"],
  })
  .refine((data) => !hasFoods(data.species_type) || (data.foods ?? []).length > 0, {
    message: "Required",
    path: ["foods"],
  })
  .refine(
    (data) => !hasSpawnLocations(data.species_type) || (data.spawn_locations ?? []).length > 0,
    { message: "Required", path: ["spawn_locations"] }

    // Fields required only for plants / corals VVV
  )
  .refine(
    (data) =>
      data.species_type === "Coral" ||
      isLivestock(data.species_type) ||
      Boolean(data.propagation_method),
    { message: "Required", path: ["propagation_method"] }
  )
  .refine((data) => !hasLighting(data.species_type) || Boolean(data.light_type), {
    message: "Required",
    path: ["light_type"],
  })
  .refine((data) => !hasLighting(data.species_type) || Boolean(data.light_strength), {
    message: "Required",
    path: ["light_strength"],
  })
  .refine((data) => !hasLighting(data.species_type) || Boolean(data.light_hours), {
    message: "Required",
    path: ["light_hours"],
  })
  .refine(
    (data) =>
      !hasSupplements(data.species_type) || data.co2 !== "yes" || Boolean(data.co2_description),
    { message: "Required", path: ["co2_description"] }
  );

export const foodTypes = [
  "Live",
  "Frozen",
  "Flake",
  "Pellet",
  "Freeze Dried",
  "Vegetable",
  "Gel",
  "Insect",
  "Phytoplankton",
  "Zooplankton",
  "Reef Roids",
  "Coral Food",
  "Amino Acids",
];

export const spawnLocations = [
  "Brooder",
  "Livebearer",
  "Bubblenest",
  "Rock",
  "Log",
  "Cave",
  "Plant",
  "Glass",
  "Peat",
  "Pipe",
  "Mop",
  "Filter Tube",
  "Earth",
];

export const speciesTypesAndClasses: Record<string, string[]> = {
  Fish: [
    "Anabantoids",
    "Brackish Water",
    "Catfish & Loaches",
    "Characins",
    "Cichlids - New World",
    "Cichlids - Old World",
    "Cyprinids",
    "Killifish",
    "Livebearers",
    "Miscellaneous",
    "Marine",
    "Native",
  ],
  Invert: ["Snail", "Shrimp", "Other"],
  Plant: [
    "Apongetons & Criniums",
    "Anubias & Lagenandra",
    "Cryptocoryne",
    "Floating Plants",
    "Primative Plants",
    "Rosette Plants",
    "Stem Plants",
    "Sword Plants",
    "Water Lilles",
  ],
  Coral: ["Hard", "Soft"],
};

export const speciesTypes = speciesTypeEnum.options;
export const waterTypes = waterTypeEnum.options;

export type FormValues = Partial<z.infer<typeof bapFields>>;
