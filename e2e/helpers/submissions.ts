import { getTestDatabase } from "./testData";

/**
 * Submission helper functions for e2e tests
 * Create test submissions directly in database to speed up admin workflow tests
 */

export interface TestSubmissionOptions {
	memberId: number;
	submitted?: boolean;
	witnessed?: boolean;
	witnessedBy?: number;
	witnessedDaysAgo?: number; // How many days ago witnessing occurred (default: 0 - today)
	reproductionDaysAgo?: number; // How many days ago reproduction occurred (default: 70 for old spawns)
	approved?: boolean;
	approvedBy?: number;
	points?: number;

	// Species identification (defaults to Fish: Guppy)
	speciesType?: "Fish" | "Invert" | "Plant" | "Coral";
	speciesClass?: string;
	speciesCommonName?: string;
	speciesLatinName?: string;
	waterType?: string;

	// Fish/Invert-specific fields
	count?: string;
	foods?: string[];
	spawnLocations?: string[];

	// Plant-specific fields
	propagationMethod?: string;

	// Plant/Coral-specific fields
	lightType?: string;
	lightStrength?: string;
	lightHours?: string;
	co2?: "yes" | "no";
	co2Description?: string;
	supplementTypes?: string[];
	supplementRegimens?: string[];
}

/**
 * Create a test submission directly in the database
 * Much faster and more reliable than filling out the form
 *
 * @param options - Submission configuration
 * @returns The created submission ID
 */
export async function createTestSubmission(options: TestSubmissionOptions): Promise<number> {
	const db = await getTestDatabase();

	try {
		const now = new Date().toISOString();
		const submittedOn = options.submitted ? now : null;
		// Set witnessed_on based on witnessedDaysAgo parameter (default 0 = today)
		// For waiting period tests, use 0 (today). For approval tests, use 70+ days to satisfy 60-day requirement
		const witnessedDaysAgo = options.witnessedDaysAgo !== undefined ? options.witnessedDaysAgo : 0;
		const witnessedOn = options.witnessed ? new Date(Date.now() - witnessedDaysAgo * 24 * 60 * 60 * 1000).toISOString() : null;

		// Set reproduction_date based on reproductionDaysAgo parameter (default 70 for mature spawns)
		const reproductionDaysAgo = options.reproductionDaysAgo !== undefined ? options.reproductionDaysAgo : 70;
		const reproductionDate = new Date(Date.now() - reproductionDaysAgo * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

		const approvedOn = options.approved ? now : null;

		// Set defaults based on species type
		const speciesType = options.speciesType || "Fish";
		const isLivestock = speciesType === "Fish" || speciesType === "Invert";
		const isPlant = speciesType === "Plant";
		const isCoral = speciesType === "Coral";

		// Species defaults
		const programMap: Record<string, string> = { Fish: "fish", Invert: "fish", Plant: "plant", Coral: "coral" };
		const program = programMap[speciesType];
		const speciesClass = options.speciesClass || (isPlant ? "Cryptocoryne" : isCoral ? "Hard" : "Livebearers");
		const speciesCommonName = options.speciesCommonName || (isPlant ? "Wendt's Cryptocoryne" : isCoral ? "Small Polyp Stony Coral" : "Guppy");
		const speciesLatinName = options.speciesLatinName || (isPlant ? "Cryptocoryne wendtii" : isCoral ? "Acropora millepora" : "Poecilia reticulata");
		const waterType = options.waterType || (isCoral ? "Salt" : "Fresh");

		// Fish/Invert-specific fields
		const count = options.count !== undefined ? options.count : (isLivestock ? "20" : null);
		const foods = options.foods !== undefined ? JSON.stringify(options.foods) : (isLivestock || isCoral ? JSON.stringify(["Live"]) : "[]");
		const spawnLocations = options.spawnLocations !== undefined ? JSON.stringify(options.spawnLocations) : (isLivestock ? JSON.stringify(["Plant"]) : "[]");

		// Plant-specific fields
		const propagationMethod = options.propagationMethod !== undefined ? options.propagationMethod : (isPlant ? "Cuttings" : null);

		// Plant/Coral-specific fields
		const lightType = options.lightType !== undefined ? options.lightType : (isPlant || isCoral ? "LED" : null);
		const lightStrength = options.lightStrength !== undefined ? options.lightStrength : (isPlant || isCoral ? "200W" : null);
		const lightHours = options.lightHours !== undefined ? options.lightHours : (isPlant || isCoral ? "16" : null);
		const co2 = options.co2 !== undefined ? options.co2 : (isPlant || isCoral ? "no" : null);
		const co2Description = options.co2Description || null;
		const supplementTypes = options.supplementTypes !== undefined ? JSON.stringify(options.supplementTypes) : "[]";
		const supplementRegimens = options.supplementRegimens !== undefined ? JSON.stringify(options.supplementRegimens) : "[]";

		const result = await db.run(
			`INSERT INTO submissions (
				member_id,
				program,
				species_type,
				species_class,
				species_common_name,
				species_latin_name,
				water_type,
				count,
				reproduction_date,
				foods,
				spawn_locations,
				propagation_method,
				light_type,
				light_strength,
				light_hours,
				co2,
				co2_description,
				supplement_type,
				supplement_regimen,
				tank_size,
				filter_type,
				water_change_volume,
				water_change_frequency,
				temperature,
				ph,
				gh,
				substrate_type,
				substrate_depth,
				substrate_color,
				submitted_on,
				witnessed_by,
				witnessed_on,
				witness_verification_status,
				approved_on,
				approved_by,
				points
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			options.memberId,
			program,
			speciesType,
			speciesClass,
			speciesCommonName,
			speciesLatinName,
			waterType,
			count,
			reproductionDate,
			foods,
			spawnLocations,
			propagationMethod,
			lightType,
			lightStrength,
			lightHours,
			co2,
			co2Description,
			supplementTypes,
			supplementRegimens,
			"10 gallon",
			"Sponge",
			"25%",
			"Weekly",
			"75",
			"7.0",
			"150",
			"Gravel",
			"1 inch",
			"Natural",
			submittedOn,
			options.witnessedBy || null,
			witnessedOn,
			options.witnessed ? "confirmed" : "pending",
			approvedOn,
			options.approvedBy || null,
			options.points || null
		);

		return result.lastID!;
	} finally {
		await db.close();
	}
}

/**
 * Delete all submissions for a member (cleanup)
 */
export async function deleteSubmissionsForMember(memberId: number): Promise<void> {
	const db = await getTestDatabase();
	try {
		await db.run("DELETE FROM submissions WHERE member_id = ?", memberId);
	} finally {
		await db.close();
	}
}
