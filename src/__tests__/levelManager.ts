import { calculateLevel, levelRules } from '../programs';

describe('Level Manager', () => {
	test('calculateLevel works with fish program', () => {
		// Test basic level calculation
		const result = calculateLevel(levelRules.fish, [20, 15, 10]);
		expect(result).toBe('Hobbyist'); // Should have 45 points total, qualifying for Hobbyist (25 points)
	});

	test('calculateLevel works with empty submissions', () => {
		const result = calculateLevel(levelRules.fish, []);
		expect(result).toBe('Participant'); // Default level with 0 points
	});

	test('calculateLevel works with high points', () => {
		// Create array with enough points for higher level
		const highPoints: number[] = new Array(20).fill(20) as number[]; // 400 points total
		const result = calculateLevel(levelRules.fish, highPoints);
		// Just check that it's not the base level anymore
		expect(result).not.toBe('Participant');
		expect(typeof result).toBe('string');
	});
});