import { getOrCreateMember } from "../db/members";
import { addSubmission } from "../db/submissions";
import { bapSchema, FormValues } from "../submissionSchema";


const members = ["John Allen", "David Manuel", "Rusty Shackleford"];
const fish = ["Guppy", "Molly", "Swordtail", "Platy", "Endler", "Mosquito Fish", "Gambusia", "Halfbeak", "Goodeid", "Pupfish", "Livebearer", "Other"];

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
	const data: FormValues = {
		memberName: getRandomElement(members),
		waterType: "Fresh",
		speciesType: "Fish",
		date: getSpawnDate().toDateString(),
		speciesClass: "Livebearers",
		speciesLatinName: getRandomElement(fish),
		speciesCommonName: getRandomElement(fish),
		count: String(6 + Math.floor(100 * Math.random())),
		foods: ["Live", "Frozen", "Flake"],
		spawnLocations: ["Livebearer"],
		propagationMethod: "",

		tankSize: "20 Long",
		filterType: "Sponge",
		changeVolume: "20%",
		changeFrequency: "Daily",
		temperature: "75-78F",
		pH: "6.8",
		GH: "200 ppm",
		specificGravity: "",
		substrateType: "Bare Bottom",
		substrateDepth: "N/A",
		substrateColor: "N/A",

		lightType: "",
		lightStrength: "",
		lightHours: "",
	};
	return data;
}


const parsed = bapSchema.safeParse(generateSubmission());
if (!parsed.success) {
	console.error(parsed.error.issues);
	throw new Error("Invalid data");
}
const member = getOrCreateMember(parsed.data!.memberName);
addSubmission(member.id, parsed.data, true);
