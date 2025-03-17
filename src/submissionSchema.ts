
import * as z from "zod"

export const isLivestock = (speciesType: string) => speciesType === "Fish" || speciesType === "Invert";

export function getClassOptions(speciesType: string) {
  const options = speciesTypesAndClasses[speciesType] ?? [];
  return options.map((option) => ({ value: option, text: option }));
}

const waterTypeEnum = z.enum(["Fresh", "Brackish", "Salt"]);
const speciesTypeEnum = z.enum(["Fish", "Invert", "Plant", "Coral"]);

export const bapSchema = z.object({
  memberName: z.string().min(1),
  waterType: waterTypeEnum,
  speciesType: speciesTypeEnum,
  date: z.date(),
  speciesClass: z.string().min(1),
  speciesLatinName: z.string().min(1),
  speciesCommonName: z.string().min(1),
  count: z.string().optional(),
  foods: z.array(z.string()).optional(),
  spawnLocations: z.array(z.string()).optional(),
  propagationMethod: z.string().optional(),

  tankSize: z.string().min(1),
  filterType: z.string().min(1),
  changeVolume: z.string().min(1),
  changeFrequency: z.string().min(1),
  temperature: z.string().min(1),
  pH: z.string().min(1),
  GH: z.string().min(1),
  specificGravity: z.string().optional(),
  substrateType: z.string().min(1),
  substrateDepth: z.string().min(1),
  substrateColor: z.string().min(1),

  lightType: z.string().optional(),
  lightStrength: z.string().optional(),
  lightHours: z.string().optional(),

  /*

  ferts: z.array(
    z.object({
      substance: z.string(),
      regimen: z.string(),
    })
  ).optional(),
  CO2: z.enum(["NO", "YES"]).optional(),
  CO2Description: z.string().optional(),

  */

  //// Fields required only for fish / inverts VVV
}).refine(
  (data) => !isLivestock(data.speciesType) || Boolean(data.count),
  { message: "Requied", path: ["count"], }
)//.refine(
//  (data) => !isLivestock(data.speciesType) || (data.foods ?? []).length > 0,
//  { message: "Requied", path: ["foods"], }
//).refine(
//  (data) => !isLivestock(data.speciesType) || (data.spawnLocations ?? []).length > 0,
//  { message: "Requied", path: ["spawnLocations"], }
  //// Fields required only for plants / corals VVV
// */).refine(
//  (data) => isLivestock(data.speciesType) || Boolean(data.propagationMethod),
//  { message: "Requied", path: ["propagationMethod"], }
//).refine(
//  (data) => isLivestock(data.speciesType) || Boolean(data.lightType),
//  { message: "Requied", path: ["lightType"], }
//).refine(
//  (data) => isLivestock(data.speciesType) || Boolean(data.lightStrength),
//  { message: "Requied", path: ["lightStrength"], }
//).refine(
//  (data) => isLivestock(data.speciesType) || Boolean(data.lightHours),
//  { message: "Requied", path: ["lightHours"], }
//).refine(
//  (data) => isLivestock(data.speciesType) || data.CO2 !== "YES" || Boolean(data.CO2Description),
//  { message: "Requied", path: ["CO2Description"], }
//)

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
