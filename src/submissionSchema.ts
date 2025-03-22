
import * as z from "zod"

export const isLivestock = (speciesType: string) => speciesType === "Fish" || speciesType === "Invert";

export function getClassOptions(speciesType: string) {
	const options = speciesTypesAndClasses[speciesType] ?? [];
	return options.map((option) => ({ value: option, text: option }));
}

const waterTypeEnum = z.enum(["Fresh", "Brackish", "Salt"]);
const speciesTypeEnum = z.enum(["Fish", "Invert", "Plant", "Coral"]);

export const bapSchema = z.object({
	memberName: z.string().nonempty({ message: "Required" }),
	memberEmail: z.string().email("Valid address required"),
	waterType: waterTypeEnum,
	speciesType: speciesTypeEnum,
	date: z
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
	speciesClass: z.string().nonempty({ message: "Required" }),
	speciesLatinName: z.string().nonempty({ message: "Required" }),
	speciesCommonName: z.string().nonempty({ message: "Required" }),
	count: z.string().optional(),
	foods: z.array(z.string()).optional(),
	spawnLocations: z.array(z.string()).optional(),
	propagationMethod: z.string().optional(),

	tankSize: z.string().nonempty({ message: "Required" }),
	filterType: z.string().nonempty({ message: "Required" }),
	changeVolume: z.string().nonempty({ message: "Required" }),
	changeFrequency: z.string().nonempty({ message: "Required" }),
	temperature: z.string().nonempty({ message: "Required" }),
	pH: z.string().nonempty({ message: "Required" }),
	GH: z.string().nonempty({ message: "Required" }),
	specificGravity: z.string().optional(),
	substrateType: z.string().nonempty({ message: "Required" }),
	substrateDepth: z.string().nonempty({ message: "Required" }),
	substrateColor: z.string().nonempty({ message: "Required" }),

	lightType: z.string().optional(),
	lightStrength: z.string().optional(),
	lightHours: z.string().optional(),

	ferts: z.array(
		z.object({
			substance: z.string(),
			regimen: z.string(),
		})
	).optional(),

	CO2: z.enum(["NO", "YES"]).optional(),
	CO2Description: z.string().optional(),

// Fields required only for fish / inverts VVV
}).refine(
	(data) => !isLivestock(data.speciesType) || Boolean(data.count),
	{ message: "Requied", path: ["count"], }
).refine(
	(data) => !isLivestock(data.speciesType) || (data.foods ?? []).length > 0,
	{ message: "Requied", path: ["foods"], }
).refine(
	(data) => !isLivestock(data.speciesType) || (data.spawnLocations ?? []).length > 0,
	{ message: "Requied", path: ["spawnLocations"], }
// Fields required only for plants / corals VVV
).refine(
	(data) => isLivestock(data.speciesType) || Boolean(data.propagationMethod),
	{ message: "Requied", path: ["propagationMethod"], }
).refine(
	(data) => isLivestock(data.speciesType) || Boolean(data.lightType),
	{ message: "Requied", path: ["lightType"], }
).refine(
	(data) => isLivestock(data.speciesType) || Boolean(data.lightStrength),
	{ message: "Requied", path: ["lightStrength"], }
).refine(
	(data) => isLivestock(data.speciesType) || Boolean(data.lightHours),
	{ message: "Requied", path: ["lightHours"], }
).refine(
	(data) => isLivestock(data.speciesType) || data.CO2 !== "YES" || Boolean(data.CO2Description),
	{ message: "Requied", path: ["CO2Description"], }
)

export const approvalSchema = z.object({
	id: z.string(),
	points: z.string(),
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
