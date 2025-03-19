
export type BapLevel =
| "Hobbyist"
| "Breeder"
| "Advanced Breeder"
| "Master Breeder"
| "Grand Master Breeder"
| "Legendary Breeder"
| "Senior Grand Master Breeder"
| "Premier Breeder"
| "Senior Premier Breeder"
| "Grand Poobah Yoda Breeder";

export type MemberDetails = {
	memberName: string;
	totalPoints: number;
	level?: BapLevel;
}

export function getMembersList(): MemberDetails[] {
	return [
		{ memberName: 'John Doe', totalPoints: 10 },
		{ memberName: 'Jane Doe', totalPoints: 30, level: "Hobbyist" },
		{ memberName: 'Alice', totalPoints: 80, level: "Breeder" },
		{ memberName: 'Bob', totalPoints: 130, level: "Advanced Breeder" },
		{ memberName: 'Charlie', totalPoints: 200, level: "Advanced Breeder" },
		{ memberName: 'James', totalPoints: 800, level: "Grand Master Breeder" },
		{ memberName: 'Heather', totalPoints: 2000, level: "Grand Master Breeder" },
	]
}
