import { getOrCreateMember, updateMemberData } from "../db/members";
import { createSubmission } from "../db/submissions";
import { bapSchema, FormValues } from "../submissionSchema";

const members = [
	["John Allen", "theactualjohnallen@gmail.com"],
	["David Manuel", "deefrombrooklyn@gmail.com"],
	["Rusty Shackleford", "giddyup@lavabit.com"],
	["Alice Morgan", "alice.morgan@example.com"],
	["Ben Thompson", "ben.thompson@example.com"],
	["Clara Nguyen", "clara.nguyen@example.com"],
	["David Patel", "david.patel@example.com"],
	["Elena Ruiz", "elena.ruiz@example.com"],
	["Frank Zhao", "frank.zhao@example.com"],
	["Grace Kim", "grace.kim@example.com"],
	["Henry O’Connor", "henry.oconnor@example.com"],
	["Isabel Rossi", "isabel.rossi@example.com"],
	["Jack Mehta", "jack.mehta@example.com"]
];

const fish = [
	"Guppy",
	"Molly",
	"Swordtail",
	"Platy",
	"Endler",
	"Mosquito Fish",
	"Gambusia",
	"Halfbeak",
	"Goodeid",
	"Pupfish",
	"Livebearer",
	"Other",
];
const plant = [
  "Water Lily",
  "Duckweed",
  "Hornwort",
  "Water Hyacinth",
  "Amazon Frogbit",
  "Java Moss",
  "Anacharis",
  "Cabomba",
  "Water Wisteria",
  "Hydrilla",
];
const coral = [
  "Staghorn Coral",
  "Elkhorn Coral",
  "Brain Coral",
  "Pillar Coral",
  "Star Coral",
  "Lettuce Coral",
  "Fire Coral",
  "Table Coral",
  "Finger Coral",
  "Mushroom Coral",
];

const species: {
	speciesType: "Fish" | "Plant" | "Coral",
	speciesList: string[];
}[] = [
	{ speciesType: "Fish", speciesList: fish },
	{ speciesType: "Plant", speciesList: plant },
	{ speciesType: "Coral", speciesList: coral },
]

function getRandomElement<T>(arr: T[]) {
	return arr[Math.floor(Math.random() * arr.length)];
}

function getSpawnDate() {
	const offsetInDays = 30 + Math.random() * 60;
	const newDate = new Date();
	newDate.setDate(newDate.getDate() + offsetInDays);
	return newDate;
}

function generateSubmission() {
	const member = getRandomElement(members);
	const { speciesType, speciesList } = getRandomElement(species);
	const sp = getRandomElement(speciesList);

	const data: FormValues = {
		member_name: member[0],
		member_email: member[1],
		water_type: "Fresh",
		species_type: speciesType,
		reproduction_date: getSpawnDate().toDateString(),
		species_class: "Livebearers",
		species_latin_name: sp,
		species_common_name: sp,
		count: String(6 + Math.floor(100 * Math.random())),
		foods: ["Live", "Frozen", "Flake"],
		spawn_locations: ["Livebearer"],
		propagation_method: "Tacos",

		tank_size: "20 Long",
		filter_type: "Sponge",
		water_change_volume: "20%",
		water_change_frequency: "Daily",
		temperature: "75-78F",
		ph: "6.8",
		gh: "200 ppm",
		specific_gravity: "",
		substrate_type: "Bare Bottom",
		substrate_depth: "N/A",
		substrate_color: "N/A",

		light_type: "LED",
		light_strength: "Strong",
		light_hours: "16",
	};
	return data;
}

const parsed = bapSchema.safeParse(generateSubmission());
if (!parsed.success) {
	console.error(parsed.error.issues);
	throw new Error("Invalid data");
}
const member = getOrCreateMember(parsed.data.member_email, parsed.data.member_name);
createSubmission(member.id, parsed.data, true);

const john = getOrCreateMember("theactualjohnallen@gmail.com", "John Allen");
updateMemberData(john.id, { is_admin: 1 });
