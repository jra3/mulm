import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname, "..", "src"));

import { init, query, writeConn, withTransaction } from "@/db/conn";
import {
  createSubmission,
  approveSubmission,
  confirmWitness,
} from "@/db/submissions";
import { FormValues } from "@/forms/submission";
import { recordName } from "@/db/species";
import { logger } from "@/utils/logger";

const MEMBER_ID = 14; // James Longo
const ADMIN_ID = 1; // John Allen

interface SubmissionData {
  common_name: string;
  latin_name: string;
  species_type: "Fish" | "Invert" | "Plant";
  species_class: string;
  group_id: number;
  base_points: number;
  reproduction_date: string | null;
  is_cares: boolean;
  form: FormValues;
}

const submissions: SubmissionData[] = [
  {
    common_name: "Odessa Barb",
    latin_name: "Pethia padamya",
    species_type: "Fish",
    species_class: "Cyprinids",
    group_id: 59,
    base_points: 10,
    reproduction_date: "2024-12-15",
    is_cares: false,
    form: {
      water_type: "Fresh",
      species_type: "Fish",
      species_class: "Cyprinids",
      species_latin_name: "Pethia padamya",
      species_common_name: "Odessa Barb",
      reproduction_date: "2024-12-15",
      tank_size: "20 gal",
      filter_type: "sponge",
      water_change_volume: "50%",
      water_change_frequency: "Just to spawn them",
      temperature: "76",
      ph: "n/a",
      gh: "n/a",
      substrate_type: "none",
      substrate_depth: "n/a",
      substrate_color: "none",
      count: "15-20",
      foods: ["Live", "Flake"],
      spawn_locations: ["Plant"],
    },
  },
  {
    common_name: "Ameca Splendens",
    latin_name: "Ameca splendens",
    species_type: "Fish",
    species_class: "Livebearers",
    group_id: 2175,
    base_points: 15,
    reproduction_date: "2024-04-15",
    is_cares: true,
    form: {
      water_type: "Fresh",
      species_type: "Fish",
      species_class: "Livebearers",
      species_latin_name: "Ameca splendens",
      species_common_name: "Ameca Splendens",
      reproduction_date: "2024-04-15",
      tank_size: "20g",
      filter_type: "sponge",
      water_change_volume: "top off only",
      water_change_frequency: "n/a",
      temperature: "76-78",
      ph: "7",
      gh: "",
      substrate_type: "planted",
      substrate_depth: "1 in",
      substrate_color: "black",
      count: "8",
      foods: ["Flake"],
      spawn_locations: ["Livebearer"],
    },
  },
  {
    common_name: "Blue Shrimp",
    latin_name: "Neocaridina davidi",
    species_type: "Invert",
    species_class: "Shrimp",
    group_id: 17,
    base_points: 15,
    reproduction_date: null,
    is_cares: false,
    form: {
      water_type: "Fresh",
      species_type: "Invert",
      species_class: "Shrimp",
      species_latin_name: "Neocaridina davidi",
      species_common_name: "Blue Shrimp",
      reproduction_date: "2024-01-01", // placeholder, will be cleared after creation
      tank_size: "40g",
      filter_type: "",
      water_change_volume: "top off only",
      water_change_frequency: "n/a",
      temperature: "76-78",
      ph: "7",
      gh: "",
      substrate_type: "planted",
      substrate_depth: "1 in",
      substrate_color: "black",
      count: "a lot",
      foods: ["Flake"],
      spawn_locations: ["Earth"],
    },
  },
  {
    common_name: "Honduran Red Points",
    latin_name: "Amatitlania siquia",
    species_type: "Fish",
    species_class: "Cichlids - New World",
    group_id: 2375,
    base_points: 15,
    reproduction_date: "2025-06-15",
    is_cares: false,
    form: {
      water_type: "Fresh",
      species_type: "Fish",
      species_class: "Cichlids - New World",
      species_latin_name: "Amatitlania siquia",
      species_common_name: "Honduran Red Points",
      reproduction_date: "2025-06-15",
      tank_size: "20g",
      filter_type: "",
      water_change_volume: "top off only",
      water_change_frequency: "n/a",
      temperature: "76-78",
      ph: "7",
      gh: "",
      substrate_type: "planted",
      substrate_depth: "1 in",
      substrate_color: "black",
      count: "30",
      foods: ["Flake"],
      spawn_locations: ["Earth"],
    },
  },
  {
    common_name: "Platinum Rice Fish",
    latin_name: "Oryzias latipes",
    species_type: "Fish",
    species_class: "Killifish",
    group_id: 57,
    base_points: 15,
    reproduction_date: "2025-06-15",
    is_cares: false,
    form: {
      water_type: "Fresh",
      species_type: "Fish",
      species_class: "Killifish",
      species_latin_name: "Oryzias latipes",
      species_common_name: "Platinum Rice Fish",
      reproduction_date: "2025-06-15",
      tank_size: "5g bucket",
      filter_type: "",
      water_change_volume: "rain only",
      water_change_frequency: "n/a",
      temperature: "Outside summer temp",
      ph: "?",
      gh: "",
      substrate_type: "planted",
      substrate_depth: "",
      substrate_color: "",
      count: "30+",
      foods: ["Flake"],
      spawn_locations: ["Earth"],
    },
  },
  {
    common_name: "Redtail Goodeid",
    latin_name: "Xenotoca eiseni",
    species_type: "Fish",
    species_class: "Livebearers",
    group_id: 1221,
    base_points: 15,
    reproduction_date: "2025-01-15",
    is_cares: true,
    form: {
      water_type: "Fresh",
      species_type: "Fish",
      species_class: "Livebearers",
      species_latin_name: "Xenotoca eiseni",
      species_common_name: "Redtail Goodeid",
      reproduction_date: "2025-01-15",
      tank_size: "20 gal",
      filter_type: "sponge",
      water_change_volume: "Top off only",
      water_change_frequency: "Top off only",
      temperature: "76",
      ph: "n/a",
      gh: "n/a",
      substrate_type: "course rock",
      substrate_depth: "n/a",
      substrate_color: "browns",
      count: "6-8",
      foods: ["Live", "Flake"],
      spawn_locations: ["Earth", "Livebearer"],
    },
  },
  {
    common_name: "Java Fern",
    latin_name: "Microsorum pteropus",
    species_type: "Plant",
    species_class: "Primative Plants",
    group_id: 1627,
    base_points: 5,
    reproduction_date: "2024-09-15",
    is_cares: false,
    form: {
      water_type: "Fresh",
      species_type: "Plant",
      species_class: "Primative Plants",
      species_latin_name: "Microsorum pteropus",
      species_common_name: "Java Fern",
      reproduction_date: "2024-09-15",
      tank_size: "20 gal",
      filter_type: "sponge",
      water_change_volume: "none",
      water_change_frequency: "Top off only",
      temperature: "76",
      ph: "dont test",
      gh: "dont test",
      substrate_type: "sand",
      substrate_depth: "2 inch",
      substrate_color: "black",
      propagation_method: "Cut when new root and replant",
      light_type: "shop light",
      light_strength: "LED shop light",
      light_hours: "6",
      supplement_type: ["Root tabs", "easy green"],
      supplement_regimen: ["", ""],
    },
  },
  {
    common_name: "Super Red Bristlenose Plecos",
    latin_name: "Ancistrus sp.",
    species_type: "Fish",
    species_class: "Catfish & Loaches",
    group_id: 28,
    base_points: 20,
    reproduction_date: "2024-06-15",
    is_cares: false,
    form: {
      water_type: "Fresh",
      species_type: "Fish",
      species_class: "Catfish & Loaches",
      species_latin_name: "Ancistrus sp.",
      species_common_name: "Super Red Bristlenose Plecos",
      reproduction_date: "2024-06-15",
      tank_size: "20 gal",
      filter_type: "sponge",
      water_change_volume: "none",
      water_change_frequency: "Top off only",
      temperature: "76",
      ph: "dont test",
      gh: "dont test",
      substrate_type: "sand",
      substrate_depth: "1-2 inch",
      substrate_color: "Black",
      count: "30",
      foods: ["Live", "Flake"],
      spawn_locations: ["Cave"],
    },
  },
  {
    common_name: "Water Sprite",
    latin_name: "Ceratopteris pteridioides",
    species_type: "Plant",
    species_class: "Primative Plants",
    group_id: 1808,
    base_points: 10,
    reproduction_date: "2024-09-15",
    is_cares: false,
    form: {
      water_type: "Fresh",
      species_type: "Plant",
      species_class: "Primative Plants",
      species_latin_name: "Ceratopteris pteridioides",
      species_common_name: "Water Sprite",
      reproduction_date: "2024-09-15",
      tank_size: "20 gal",
      filter_type: "sponge",
      water_change_volume: "None",
      water_change_frequency: "Top off only",
      temperature: "76",
      ph: "dont test",
      gh: "dont test",
      substrate_type: "sand",
      substrate_depth: "2 inch",
      substrate_color: "black",
      propagation_method: "When it grows and roots cut it",
      light_type: "shop light",
      light_strength: "LED shop light",
      light_hours: "6",
      supplement_type: ["Root tabs", "easy green"],
      supplement_regimen: ["", ""],
    },
  },
  {
    common_name: "Zebra Danio Longfin",
    latin_name: "Danio rerio",
    species_type: "Fish",
    species_class: "Cyprinids",
    group_id: 43,
    base_points: 10,
    reproduction_date: "2024-06-15",
    is_cares: false,
    form: {
      water_type: "Fresh",
      species_type: "Fish",
      species_class: "Cyprinids",
      species_latin_name: "Danio rerio",
      species_common_name: "Zebra Danio Longfin",
      reproduction_date: "2024-06-15",
      tank_size: "20 gal",
      filter_type: "sponge",
      water_change_volume: "None",
      water_change_frequency: "Top off only",
      temperature: "76",
      ph: "dont test",
      gh: "Dont test",
      substrate_type: "None",
      substrate_depth: "None",
      substrate_color: "none",
      count: "100s",
      foods: ["Live", "Flake"],
      spawn_locations: ["Plant"],
    },
  },
];

async function fixSpecies() {
  logger.info("Fixing species_name_group records...");

  await withTransaction(async (db) => {
    // Fix Xenotoca eiseni: Miscellaneous -> Livebearers, add points and CARES
    await db.run(
      `UPDATE species_name_group
       SET program_class = 'Livebearers', base_points = 15, is_cares_species = 1
       WHERE group_id = 1221`
    );
    logger.info("Fixed group 1221 (Xenotoca eiseni): Livebearers, 15pts, CARES");

    // Fix Ameca splendens: add points and CARES
    await db.run(
      `UPDATE species_name_group
       SET base_points = 15, is_cares_species = 1
       WHERE group_id = 2175`
    );
    logger.info("Fixed group 2175 (Ameca splendens): 15pts, CARES");

    // Fix Java fern: use existing group 1627 (Microsorum pteropus), fix class and points
    await db.run(
      `UPDATE species_name_group
       SET program_class = 'Primative Plants', base_points = 5
       WHERE group_id = 1627`
    );
    logger.info("Fixed group 1627 (Microsorum pteropus): Primative Plants, 5pts");

    // Fix Water sprite: Floating Plants -> Primitive Plants, add points, fix canonical
    await db.run(
      `UPDATE species_name_group
       SET program_class = 'Primative Plants', base_points = 10,
           canonical_genus = 'Ceratopteris', canonical_species_name = 'pteridioides'
       WHERE group_id = 1808`
    );
    await db.run(
      `UPDATE species_scientific_name
       SET scientific_name = 'Ceratopteris pteridioides'
       WHERE group_id = 1808`
    );
    logger.info("Fixed group 1808 (Water sprite): Primative Plants, 10pts, canonical=Ceratopteris pteridioides");
  });
}

async function importSubmissions() {
  logger.info(`Importing ${submissions.length} submissions for James Longo (member ${MEMBER_ID})...`);

  for (const sub of submissions) {
    // Split latin name into genus + species for recordName
    const parts = sub.latin_name.split(" ");
    const genus = parts[0];
    const speciesName = parts.slice(1).join(" ");

    // 1. Create and submit
    const submissionId = await createSubmission(MEMBER_ID, sub.form, true);
    logger.info(`Created submission ${submissionId}: ${sub.common_name}`);

    // 2. Clear reproduction_date if null (Blue Shrimp)
    if (sub.reproduction_date === null) {
      await writeConn.run(
        `UPDATE submissions SET reproduction_date = NULL WHERE id = ?`,
        submissionId
      );
    }

    // 3. Witness
    await confirmWitness(submissionId, ADMIN_ID);
    logger.info(`Witnessed submission ${submissionId}`);

    // 4. Record species name to get IDs
    const speciesIds = await recordName({
      program_class: sub.species_class,
      canonical_genus: genus,
      canonical_species_name: speciesName,
      common_name: sub.common_name,
      latin_name: sub.latin_name,
    });
    logger.info(`Recorded species: ${sub.latin_name} -> ${JSON.stringify(speciesIds)}`);

    // 5. Approve
    await approveSubmission(ADMIN_ID, submissionId, speciesIds, {
      id: submissionId,
      points: sub.base_points,
      group_id: sub.group_id,
      article_points: 0,
      first_time_species: false,
      cares_species: sub.is_cares,
      flowered: false,
      sexual_reproduction: false,
    });
    logger.info(`Approved submission ${submissionId}: ${sub.common_name} (${sub.base_points} pts)`);
  }
}

async function main() {
  await init();

  await fixSpecies();
  await importSubmissions();

  logger.info("Done! Imported 10 submissions for James Longo.");
}

main().catch((err) => {
  logger.error("Import failed", err);
  process.exit(1);
});
