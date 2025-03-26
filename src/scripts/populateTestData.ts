//import { getOrCreateMember, updateMemberData } from "../db/members";
//import { approveSubmission, createSubmission } from "../db/submissions";
import { bapSchema, FormValues } from "../submissionSchema";
import fs from 'fs';
import Papa from 'papaparse';
import { getOrCreateMember, updateMemberData } from "../db/members";
import { approveSubmission, createSubmission, Submission } from "../db/submissions";

[
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
].map(([name, email]) => getOrCreateMember(email, name))
const john = getOrCreateMember("theactualjohnallen@gmail.com", "John Allen");
updateMemberData(john.id, { is_admin: 1 });

const csvFilePath = './fish_breeding_test_data_poisson.csv';

const csvData = fs.readFileSync(csvFilePath, 'utf8');
const result = Papa.parse<FormValues & Submission>(csvData, {
  header: true,
  skipEmptyLines: true,
});

result.data.map(data => {
	try {
		const parsed = bapSchema.parse({ ...data, member_name: "Test", member_email: "test@example.com" });
		const sub = createSubmission(data.member_id, parsed, true);
		if (data.points) {
			approveSubmission(sub as number, data.points, 1);
		}
	} catch {
		console.log('skip');
		console.log(data);
	}
});
