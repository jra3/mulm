import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { overrideConnection } from "../db/conn";
import { getSpeciesForExplorer, recordName, getSpeciesDetail, SpeciesFilters } from "../db/species";
import { createMember } from "../db/members";

beforeAll(() => {
	fs.mkdirSync("/tmp/mulm", { recursive: true });
});

let instance = 1;
let testDb: Database;

beforeEach(async () => {
	const filename = `/tmp/mulm/database-species-${instance++}.sqlite`;
	const tmpConn = await open({
		filename,
		driver: sqlite3.Database,
		mode: sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE,
	});
	await tmpConn.migrate({
    	migrationsPath: './db/migrations',
	});

	const writeConn = await open({
		filename,
		driver: sqlite3.Database,
		mode: sqlite3.OPEN_READWRITE,
	});

	testDb = writeConn;
	overrideConnection(writeConn);

	await setupTestData();
});

afterAll(() => {
	fs.rmSync("/tmp/mulm", { recursive: true, force: true });
});

async function setupTestData() {
	const member1 = await createMember("breeder1@test.com", "Test Breeder 1");
	const member2 = await createMember("breeder2@test.com", "Test Breeder 2");

	const species1Id = await recordName({
		program_class: "Cichlids",
		canonical_genus: "Apistogramma",
		canonical_species_name: "cacatuoides",
		common_name: "Cockatoo Dwarf Cichlid",
		latin_name: "Apistogramma cacatuoides"
	});

	const species2Id = await recordName({
		program_class: "Characins",
		canonical_genus: "Neon",
		canonical_species_name: "tetra",
		common_name: "Neon Tetra",
		latin_name: "Paracheirodon innesi"
	});

	const species3Id = await recordName({
		program_class: "Livebearers",
		canonical_genus: "Guppy",
		canonical_species_name: "fancy",
		common_name: "Fancy Guppy",
		latin_name: "Poecilia reticulata"
	});

	const speciesNames = await testDb.all<Array<{ name_id: number; group_id: number }>>(`
		SELECT name_id, group_id FROM species_name
		WHERE group_id IN (?, ?, ?)
	`, [species1Id, species2Id, species3Id]);

	const findSpeciesNameId = (groupId: number): number => {
		const species = speciesNames.find(s => s.group_id === groupId);
		if (!species) {
			throw new Error(`Species with group_id ${groupId} not found`);
		}
		return species.name_id;
	};

	const submissions = [
		{
			member_id: member1,
			species_name_id: findSpeciesNameId(species1Id),
			program: "fish",
			species_type: "Fish",
			species_class: "Cichlids",
			species_common_name: "Cockatoo Dwarf Cichlid",
			species_latin_name: "Apistogramma cacatuoides",
			approved_on: "2024-01-01",
			points: 15
		},
		{
			member_id: member1,
			species_name_id: findSpeciesNameId(species2Id),
			program: "fish",
			species_type: "Fish",
			species_class: "Characins",
			species_common_name: "Neon Tetra",
			species_latin_name: "Paracheirodon innesi",
			approved_on: "2024-01-15",
			points: 10
		},
		{
			member_id: member2,
			species_name_id: findSpeciesNameId(species1Id),
			program: "fish",
			species_type: "Fish",
			species_class: "Cichlids",
			species_common_name: "Cockatoo Dwarf Cichlid",
			species_latin_name: "Apistogramma cacatuoides",
			approved_on: "2024-02-01",
			points: 15
		},
		{
			member_id: member2,
			species_name_id: findSpeciesNameId(species3Id),
			program: "fish",
			species_type: "Fish",
			species_class: "Livebearers",
			species_common_name: "Fancy Guppy",
			species_latin_name: "Poecilia reticulata",
			approved_on: "2024-02-15",
			points: 5
		}
	];

	for (const submission of submissions) {
		await testDb.run(
			`INSERT INTO submissions (
				member_id, species_name_id, program, species_type, species_class,
				species_common_name, species_latin_name, approved_on, points
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				submission.member_id, submission.species_name_id, submission.program, submission.species_type,
				submission.species_class, submission.species_common_name, submission.species_latin_name,
				submission.approved_on, submission.points
			]
		);
	}
}

describe('Species Explorer Search Functionality', () => {

	test('Returns all species with no filters', async () => {
		const species = await getSpeciesForExplorer();
		expect(species.length).toBe(3);
	});

	test('Filters by species type correctly', async () => {
		const filters: SpeciesFilters = { species_type: "Fish" };
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(3);

		const filters2: SpeciesFilters = { species_type: "Plant" };
		const species2 = await getSpeciesForExplorer(filters2);
		expect(species2.length).toBe(0);
	});

	test('Filters by species class correctly', async () => {
		const filters: SpeciesFilters = { species_class: "Cichlids" };
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(1);
		expect(species[0].canonical_genus).toBe("Apistogramma");
	});

	test('Search by genus works correctly', async () => {
		const filters: SpeciesFilters = { search: "Apisto" };
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(1);
		expect(species[0].canonical_genus).toBe("Apistogramma");
	});

	test('Search by common name works correctly', async () => {
		const filters: SpeciesFilters = { search: "Neon" };
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(1);
		expect(species[0].canonical_genus).toBe("Neon");
	});

	test('Search by scientific name works correctly', async () => {
		const filters: SpeciesFilters = { search: "Paracheirodon" };
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(1);
		expect(species[0].canonical_genus).toBe("Neon");
	});

	test('Case insensitive search works', async () => {
		const filters: SpeciesFilters = { search: "APISTO" };
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(1);
		expect(species[0].canonical_genus).toBe("Apistogramma");
	});

	test('Partial name search works', async () => {
		const filters: SpeciesFilters = { search: "caca" };
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(1);
		expect(species[0].canonical_species_name).toBe("cacatuoides");
	});

	test('Sorting by name works correctly', async () => {
		const filters: SpeciesFilters = { sort: "name" };
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(3);
		expect(species[0].canonical_genus).toBe("Apistogramma");
		expect(species[1].canonical_genus).toBe("Guppy");
		expect(species[2].canonical_genus).toBe("Neon");
	});

	test('Sorting by reports works correctly', async () => {
		const filters: SpeciesFilters = { sort: "reports" };
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(3);
		// Should be ordered by total_breeds DESC - Apistogramma has 2 breeds
		expect(species[0].canonical_genus).toBe("Apistogramma");
		expect(species[0].total_breeds).toBe(2);
	});

	test('Sorting by breeders works correctly', async () => {
		const filters: SpeciesFilters = { sort: "breeders" };
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(3);
		// Should be ordered by total_breeders DESC - Apistogramma has 2 breeders
		expect(species[0].canonical_genus).toBe("Apistogramma");
		expect(species[0].total_breeders).toBe(2);
	});

	test('Combined filters work correctly', async () => {
		const filters: SpeciesFilters = {
			species_type: "Fish",
			species_class: "Cichlids",
			search: "Apisto"
		};
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(1);
		expect(species[0].canonical_genus).toBe("Apistogramma");
	});

	test('No results when filters match nothing', async () => {
		const filters: SpeciesFilters = { search: "NonExistentSpecies" };
		const species = await getSpeciesForExplorer(filters);
		expect(species.length).toBe(0);
	});

	test('Species counts are accurate', async () => {
		const species = await getSpeciesForExplorer();
		const apisto = species.find(s => s.canonical_genus === "Apistogramma");
		const neon = species.find(s => s.canonical_genus === "Neon");
		const guppy = species.find(s => s.canonical_genus === "Guppy");

		expect(apisto?.total_breeds).toBe(2);
		expect(apisto?.total_breeders).toBe(2);
		expect(neon?.total_breeds).toBe(1);
		expect(neon?.total_breeders).toBe(1);
		expect(guppy?.total_breeds).toBe(1);
		expect(guppy?.total_breeders).toBe(1);
	});
});

describe('Species Detail Functionality', () => {
	test('Returns species detail correctly', async () => {
		const species = await getSpeciesForExplorer();
		const apisto = species.find(s => s.canonical_genus === "Apistogramma");

		expect(apisto).toBeDefined();
		const detail = await getSpeciesDetail(apisto!.group_id);

		expect(detail).toBeDefined();
		expect(detail!.canonical_genus).toBe("Apistogramma");
		expect(detail!.canonical_species_name).toBe("cacatuoides");
		expect(detail!.synonyms.length).toBeGreaterThan(0);
	});

	test('Returns null for non-existent species', async () => {
		const detail = await getSpeciesDetail(99999);
		expect(detail).toBeNull();
	});
});
