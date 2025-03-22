
export function getBapFormTitle(selectedType: string) {
	switch (selectedType) {
		default:
		case "Fish":
		case "Invert":
			return "Breeder Awards Submission";
		case "Plant":
			return "Horticultural Awards Submission";
		case "Coral":
			return "Coral Awards Submission";
	}
}
