import type { Database } from "sqlite";

// Immutable catalogue shared by E2E tests; never removed by member teardown.
export async function seedTestSpecies(db: Database) {
  // Species needed by E2E tests
  const testSpecies = [
    {
      group: {
        canonical_genus: "Poecilia",
        canonical_species_name: "reticulata",
        program_class: "Livebearers",
        species_type: "Fish",
      },
      commonNames: ["Guppy", "Fancy Guppy"],
      scientificNames: ["Poecilia reticulata"],
    },
    {
      group: {
        canonical_genus: "Xiphophorus",
        canonical_species_name: "hellerii",
        program_class: "Livebearers",
        species_type: "Fish",
      },
      commonNames: ["Swordtail", "Green Swordtail"],
      scientificNames: ["Xiphophorus hellerii"],
    },
    {
      group: {
        canonical_genus: "Xiphophorus",
        canonical_species_name: "maculatus",
        program_class: "Livebearers",
        species_type: "Fish",
      },
      commonNames: ["Platy", "Southern Platyfish"],
      scientificNames: ["Xiphophorus maculatus"],
    },
    // A Species with no common Name: it goes by a scientific Name (#421)
    {
      group: {
        canonical_genus: "Poeciliopsis",
        canonical_species_name: "nocommonus",
        program_class: "Livebearers",
        species_type: "Fish",
      },
      commonNames: [],
      scientificNames: ["Poeciliopsis nocommonus"],
    },
    // Plant species for E2E testing
    {
      group: {
        canonical_genus: "Cryptocoryne",
        canonical_species_name: "wendtii",
        program_class: "Cryptocoryne",
        species_type: "Plant",
      },
      commonNames: ["Wendt's Cryptocoryne", "Wendt's Water Trumpet"],
      scientificNames: ["Cryptocoryne wendtii"],
    },
    {
      group: {
        canonical_genus: "Anubias",
        canonical_species_name: "barteri",
        program_class: "Anubias & Lagenandra",
        species_type: "Plant",
      },
      commonNames: ["Anubias", "Anubias Barteri"],
      scientificNames: ["Anubias barteri"],
    },
    // Coral species for E2E testing
    {
      group: {
        canonical_genus: "Acropora",
        canonical_species_name: "millepora",
        program_class: "Hard",
        species_type: "Coral",
      },
      commonNames: ["Small Polyp Stony Coral", "Staghorn Coral"],
      scientificNames: ["Acropora millepora"],
    },
    {
      group: {
        canonical_genus: "Sinularia",
        canonical_species_name: "flexibilis",
        program_class: "Soft",
        species_type: "Coral",
      },
      commonNames: ["Flexible Leather Coral", "Soft Coral"],
      scientificNames: ["Sinularia flexibilis"],
    },
  ];

  for (const species of testSpecies) {
    // Check if group exists
    const existing = await db.get(
      `SELECT group_id FROM species_name_group WHERE canonical_genus = ? AND canonical_species_name = ?`,
      species.group.canonical_genus,
      species.group.canonical_species_name
    );

    let groupId: number;

    if (existing) {
      groupId = existing.group_id;
    } else {
      // Create species group
      const result = await db.run(
        `INSERT INTO species_name_group (canonical_genus, canonical_species_name, program_class, species_type)
				 VALUES (?, ?, ?, ?)`,
        species.group.canonical_genus,
        species.group.canonical_species_name,
        species.group.program_class,
        species.group.species_type
      );
      groupId = result.lastID as number;

      // Its Canonical name is its one flagged scientific Name (ADR-0002);
      // Species that already existed got theirs from migration 057.
      await db.run(
        `INSERT INTO species_scientific_name (group_id, scientific_name, is_canonical) VALUES (?, ?, 1)`,
        groupId,
        `${species.group.canonical_genus} ${species.group.canonical_species_name}`
      );
    }

    // Add common name variants (new schema has separate tables)
    for (const commonName of species.commonNames) {
      const existingCommon = await db.get(
        `SELECT common_name_id FROM species_common_name WHERE group_id = ? AND common_name = ?`,
        groupId,
        commonName
      );

      if (!existingCommon) {
        await db.run(
          `INSERT INTO species_common_name (group_id, common_name) VALUES (?, ?)`,
          groupId,
          commonName
        );
      }
    }

    // Add scientific name variants
    for (const scientificName of species.scientificNames) {
      const existingScientific = await db.get(
        `SELECT scientific_name_id FROM species_scientific_name WHERE group_id = ? AND scientific_name = ?`,
        groupId,
        scientificName
      );

      if (!existingScientific) {
        await db.run(
          `INSERT INTO species_scientific_name (group_id, scientific_name) VALUES (?, ?)`,
          groupId,
          scientificName
        );
      }
    }
  }

  console.log("Test species seeded ✓");
}
