
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
