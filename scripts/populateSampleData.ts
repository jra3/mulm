import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname));

import fs from "fs";
import Papa from "papaparse";
import { createSubmission, getSubmissionById } from "./db/submissions.js";
import { parse } from "date-fns";
import { getMember } from "./db/members.js";

const csvFilePath = "./sample.csv";
const csvData = fs.readFileSync(csvFilePath, "utf8");
const result = Papa.parse<any>(csvData, {
  header: true,
  skipEmptyLines: true,
});

Promise.resolve(getMember(13)).then((m) => console.log("Member:", m));
//console.log("Member:", member);

result.data.map((data) => {
  try {
    const transformed = {
      count: "",
      tank_size: "",
      filter_type: "",
      water_change_volume: "",
      water_change_frequency: "",
      temperature: "",
      ph: "",

      substrate_type: "",
      substrate_color: "",
      substrate_depth: "",

      ...data,

      reproduction_date: parse(data.reproduction_date, "dd-MMM-yy", new Date()).toISOString(),
      water_type: data.freshwater != "" ? "Fresh" : data.saltwater != "" ? "Salt" : "Brackish",
      co2: data.co2 != "" ? "yes" : "no",
      freshwater: undefined,
      saltwater: undefined,
      brackish: undefined,
      points: parseInt(data.points),

      approved_on: new Date().toISOString(),
      approved_by: 1, // // DAVID //admins.get(String(data.approved_by)) ?? 0,
      article_submitted: undefined,
      flowered: undefined,
      first_time_spawn: undefined,
    }(async function () {
      //console.log(member, transformed);
    })();

    //const sub = createSubmission(membersByName[data.member_name] ?? 0, transformed, true);
    //console.log(getSubmissionById(sub as number ?? 0));
  } catch (err: any) {
    console.log(JSON.stringify(err, null, 2));
    //console.log(data);
  }
});
