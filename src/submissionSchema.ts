
import * as z from "zod"

export const isLivestock = (speciesType: string) => speciesType === "Fish" || speciesType === "Invert";

export function getClassOptions(speciesType: string) {
	const options = speciesTypesAndClasses[speciesType] ?? [];
	return options.map((option) => ({ value: option, text: option }));
}

const multiSelect = z
  .union([z.string(), z.array(z.string())])
  .transform((val) => {
    const arr = typeof val === "string" ? [val] : val;
		return arr;
  });

const waterTypeEnum = z.enum(["Fresh", "Brackish", "Salt"]);
const speciesTypeEnum = z.enum(["Fish", "Invert", "Plant", "Coral"]);

export const bapSchema = z.object({
	member_name: z.string().nonempty({ message: "Required" }),
	member_email: z.string().email("Valid address required"),
	water_type: waterTypeEnum,
	species_type: speciesTypeEnum,
	reproduction_date: z
		.string()
		.refine((date) => {
			if (date === "") {
				return false;
			}
			const parsed = Date.parse(date);
			if (isNaN(parsed)) {
				return false;
			}
			return true;
		}, { message: "Required" }),
	species_class: z.string().nonempty({ message: "Required" }),
	species_latin_name: z.string().nonempty({ message: "Required" }),
	species_common_name: z.string().nonempty({ message: "Required" }),
	count: z.string().optional(),
	foods: multiSelect.optional(),
	spawn_locations: multiSelect.optional(),
	propagation_method: z.string().optional(),

	tank_size: z.string().nonempty({ message: "Required" }),
	filter_type: z.string().nonempty({ message: "Required" }),
	water_change_volume: z.string().nonempty({ message: "Required" }),
	water_change_frequency: z.string().nonempty({ message: "Required" }),
	temperature: z.string().nonempty({ message: "Required" }),
	ph: z.string().nonempty({ message: "Required" }),
	gh: z.string().optional(),
	specific_gravity: z.string().optional(),
	substrate_type: z.string().nonempty({ message: "Required" }),
	substrate_depth: z.string().nonempty({ message: "Required" }),
	substrate_color: z.string().nonempty({ message: "Required" }),

	light_type: z.string().optional(),
	light_strength: z.string().optional(),
	light_hours: z.string().optional(),

	supplement_type: multiSelect.optional(),
	supplement_regimen: multiSelect.optional(),

	co2: z.enum(["no", "yes"]).optional(),
	co2_description: z.string().optional(),

// Fields required only for fish / inverts VVV

}).refine(
	(data) => !isLivestock(data.species_type) || Boolean(data.count),
	{ message: "Requied", path: ["count"], }
).refine(
	(data) => !isLivestock(data.species_type) || (data.foods ?? []).length > 0,
	{ message: "Requied", path: ["foods"], }
).refine(
	(data) => !isLivestock(data.species_type) || (data.spawn_locations ?? []).length > 0,
	{ message: "Requied", path: ["spawn_locations"], }

// Fields required only for plants / corals VVV

).refine(
	(data) => isLivestock(data.species_type) || Boolean(data.propagation_method),
	{ message: "Requied", path: ["propagation_method"], }
).refine(
	(data) => isLivestock(data.species_type) || Boolean(data.light_type),
	{ message: "Requied", path: ["light_type"], }
).refine(
	(data) => isLivestock(data.species_type) || Boolean(data.light_strength),
	{ message: "Requied", path: ["light_strength"], }
).refine(
	(data) => isLivestock(data.species_type) || Boolean(data.light_hours),
	{ message: "Requied", path: ["light_hours"], }
).refine(
	(data) => isLivestock(data.species_type) || data.co2 !== "yes" || Boolean(data.co2_description),
	{ message: "Requied", path: ["co2_description"], }
)

export const approvalSchema = z.object({
	reject: z.string().optional(),
	delete: z.string().optional(),
	id: z.string(),
	points: z.string().optional(),
});

export const speciesTypes = speciesTypeEnum.options;
export const waterTypes = waterTypeEnum.options;

export const foodTypes = [
	"Live",
	"Frozen",
	"Flake",
	"Pellet",
	"Freeze Dried",
	"Vegetable",
	"Gel",
	"Insect",
];

export const spawnLocations = [
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
	"Fish": [
		"Anabantoids",
		"Brackish Water",
		"Catfish & Loaches",
		"Characins",
		"Cichlids",
		"Cyprinids",
		"Killifish",
		"Livebearers",
		"Miscellaneous",
		"Marine",
		"Native",
	],
	"Invert": [
		"Snail",
		"Shrimp",
		"Other",
	],
	"Plant": [
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
	"Coral": [
		"Hard",
		"Soft",
	],
}

export type FormValues = z.infer<typeof bapSchema>;
