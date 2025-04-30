export const minYear = 1978;

export const programs = ["fish", "plant", "coral"];
type LevelRules = [
	name: string,
	points: number,
	extraRules?: (tally: PointsTally) => boolean,
];
type PointsTally = {
	total: number;
	5: number;
	10: number;
	15: number;
	20: number;
};

/**
 * returns the total points for each point category (5, 10, 15, 20)
 */
function pointsByCategory(awards: number[]) {
	const tally: PointsTally = {
		total: 0,
		5: 0,
		10: 0,
		15: 0,
		20: 0,
	};
	for (const value of awards) {
		if (value == 5 || value == 10 || value == 15 || value == 20) {
			tally.total += value;
			tally[value] += value;
		} else {
			throw new Error(`Invalid award value: ${value}`);
		}
	}
	return tally;
}

function classSum(tally: PointsTally, classes: (keyof PointsTally)[]) {
	return classes.map((c) => tally[c]).reduce((a, b) => a + b, 0);
}

export const levelRules: Record<string, LevelRules[]> = {
	fish: [
		["Participant", 0],
		["Hobbyist", 25],
		[
			"Breeder",
			50,
			(tally) => {
				// At least 20 points must be from the 10, 15 or 20 point category.
				return classSum(tally, [10, 15, 20]) >= 20;
			},
		],
		[
			"Advanced Breeder",
			100,
			(tally) => {
				// At least 40 points must be from the 15, or 20 point category.
				return classSum(tally, [15, 20]) >= 40;
			},
		],
		[
			"Master Breeder",
			300,
			(tally) => {
				// At least 30 points must be from each of the 5, 10, 15 point
				// categories, 40 points must be from a 20 point category.
				// The remaining points could be obtained from any category.
				return (
					tally[5] >= 30 &&
					tally[10]! >= 30 &&
					tally[15]! >= 30 &&
					tally[20]! >= 40
				);
			},
		],
		["Grand Master Breeder", 500],
		[
			"Advanced Grand Master Breeder",
			750,
			(tally) => {
				// 60 points must be from 5, 10, 15 point category and 80 points
				// must be from a 20 point category.
				return classSum(tally, [5, 10, 15]) >= 60 && tally[20]! >= 80;
			},
		],
		[
			"Senior Grand Master Breeder",
			1000,
			(tally) => {
				// 80 points must be from 5, 10, 15 point category and 100 points
				// must be from a 20 point category.
				return classSum(tally, [5, 10, 15]) >= 80 && tally[20]! >= 100;
			},
		],
		["Premier Breeder", 1500],
		["Senior Premier Breeder", 2000],
		["Grand Poobah Yoda Breeder", 4000],
	],
	// • Extra points will be awarded for plants that flower, equal to the point value of plant.
	plant: [
		["Participant", 0],
		["Beginner Aquatic Horticulturist", 25],
		[
			"Aquatic Horticulturist",
			50,
			(tally) => {
				// At least 20 points must be from the 10, 15 or 20 point category.
				return classSum(tally, [10, 15, 20]) >= 20;
			},
		],
		[
			"Senior Aquatic Horticulturist",
			100,
			(tally) => {
				//At least 40 points must be from the 15, or 20 point category.
				return classSum(tally, [15, 20]) >= 40;
			},
		],
		[
			"Expert Aquatic Horticulturist",
			300,
			(tally) => {
				// At least 30 points must be from each of the 5, 10, 15 point categories; a minimum of
				// 40 points must be from a 20 point category. The remaining points can be from any category.
				return (
					tally[5] >= 30 &&
					tally[10]! >= 30 &&
					tally[15]! >= 30 &&
					tally[20]! >= 40
				);
			},
		],
		["Master Aquatic Horticulturist", 500],
		[
			"Grand Master Aquatic Horticulturist",
			750,
			(tally) => {
				// 60 points must be from 5, 10, 15 point category and 80 points
				// must be from a 20 point category.
				return classSum(tally, [5, 10, 15]) >= 60 && tally[20]! >= 80;
			},
		],
		[
			"Senior Grand Master Aquatic Horticulturist",
			1000,
			(tally) => {
				// 80 points must be from 5, 10, 15 point category and 100 points
				// must be from a 20 point category.
				return classSum(tally, [5, 10, 15]) >= 80 && tally[20]! >= 100;
			},
		],
		["Premier Aquatic Horticulturist", 1500],
		["Senior Premier Aquatic Horticulturist", 2000],
	],
	coral: [
		["Participant", 0],
		["Beginner Coral Propagator", 25],
		["Coral Propagator", 50],
		["Senior Coral Propagator", 100],
		["Expert Coral Propagator", 300],
		["Master Coral Propagator", 500],
		["Grand Master Coral Propagator", 750],
		["Senior Grand Master Coral Propagator", 1000],
	],
};

export function calculateLevel(rules: LevelRules[], submissions: number[]) {
	const tally = pointsByCategory(submissions);
	let levelAchieved = "Participant";
	// Apply level rules in order to find the hightest level achieved
	for (const [level, points, extraRules] of rules) {
		if (tally.total >= points && (!extraRules || extraRules(tally))) {
			levelAchieved = level;
		} else {
			break;
		}
	}
	return levelAchieved;
}
