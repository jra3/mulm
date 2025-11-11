#!/usr/bin/env ts-node
/**
 * Setup script for E2E tests
 * Creates and migrates the test database before running Playwright tests
 */

import { open } from "sqlite";
import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

async function setupE2EDatabase() {
	const dbPath = path.join(__dirname, "../db/database.db");

	console.log("Setting up E2E test database...");
	console.log(`Database path: ${dbPath}`);

	// Ensure db directory exists
	const dbDir = path.dirname(dbPath);
	if (!fs.existsSync(dbDir)) {
		console.log(`Creating db directory: ${dbDir}`);
		fs.mkdirSync(dbDir, { recursive: true });
	}

	// Open/create database
	const db = await open({
		filename: dbPath,
		driver: sqlite3.Database,
		mode: sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE,
	});

	// Run migrations
	console.log("Running migrations...");
	await db.migrate({
		migrationsPath: path.join(__dirname, "../db/migrations"),
	});

	console.log("Migrations complete");

	// Seed test species data
	console.log("Seeding test species...");
	await seedTestSpecies(db);

	// Close the connection
	await db.close();

	console.log("E2E database setup complete ✓");
}

async function seedTestSpecies(db: any) {
	// Species needed by E2E tests
	const testSpecies = [
		{
			group: { canonical_genus: "Poecilia", canonical_species_name: "reticulata", program_class: "Livebearers", species_type: "Fish" },
			commonNames: ["Guppy", "Fancy Guppy"],
			scientificNames: ["Poecilia reticulata"]
		},
		{
			group: { canonical_genus: "Xiphophorus", canonical_species_name: "hellerii", program_class: "Livebearers", species_type: "Fish" },
			commonNames: ["Swordtail", "Green Swordtail"],
			scientificNames: ["Xiphophorus hellerii"]
		},
		{
			group: { canonical_genus: "Xiphophorus", canonical_species_name: "maculatus", program_class: "Livebearers", species_type: "Fish" },
			commonNames: ["Platy", "Southern Platyfish"],
			scientificNames: ["Xiphophorus maculatus"]
		},
		// Plant species for E2E testing
		{
			group: { canonical_genus: "Cryptocoryne", canonical_species_name: "wendtii", program_class: "Cryptocoryne", species_type: "Plant" },
			commonNames: ["Wendt's Cryptocoryne", "Wendt's Water Trumpet"],
			scientificNames: ["Cryptocoryne wendtii"]
		},
		{
			group: { canonical_genus: "Anubias", canonical_species_name: "barteri", program_class: "Anubias & Lagenandra", species_type: "Plant" },
			commonNames: ["Anubias", "Anubias Barteri"],
			scientificNames: ["Anubias barteri"]
		},
		// Coral species for E2E testing
		{
			group: { canonical_genus: "Acropora", canonical_species_name: "millepora", program_class: "Hard", species_type: "Coral" },
			commonNames: ["Small Polyp Stony Coral", "Staghorn Coral"],
			scientificNames: ["Acropora millepora"]
		},
		{
			group: { canonical_genus: "Sinularia", canonical_species_name: "flexibilis", program_class: "Soft", species_type: "Coral" },
			commonNames: ["Flexible Leather Coral", "Soft Coral"],
			scientificNames: ["Sinularia flexibilis"]
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

setupE2EDatabase().catch((error) => {
	console.error("Failed to setup E2E database:", error);
	process.exit(1);
});
