import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { overrideConnection } from '../db/conn';
import { confirmWitness, declineWitness, getSubmissionById } from '../db/submissions';
import { createMember, getMember } from '../db/members';
import { getWaitingPeriodStatus } from '../utils/waitingPeriod';

// Mock the email notifications to prevent actual emails during tests
jest.mock('../notifications', () => ({
	onWitnessConfirmed: jest.fn(),
	onWitnessDeclined: jest.fn(),
}));

interface TestSubmission {
	id: number;
	member_id: number;
	species_class: string;
	species_type: string;
	witness_verification_status: string;
}

interface TestMember {
	id: number;
	display_name: string;
	contact_email: string;
}

describe('Witness Workflow Integration Tests', () => {
	let db: Database;
	let testMember: TestMember;
	let admin1: TestMember;
	let admin2: TestMember;
	let admin3: TestMember;

	// Helper function to create a test submission
	async function createTestSubmission(
		memberId: number, 
		speciesType: string = 'Fish', 
		speciesClass: string = 'New World',
		status: string = 'pending'
	): Promise<number> {
		const result = await db.run(`
			INSERT INTO submissions (
				member_id, species_class, species_type, species_common_name,
				species_latin_name, reproduction_date, temperature, ph, gh,
				specific_gravity, water_type, witness_verification_status,
				program, submitted_on
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, [
			memberId, speciesClass, speciesType, 'Test Fish', 'Testus fishus',
			new Date().toISOString(), '75', '7.0', '10', '1.000', 'Fresh',
			status, speciesType.toLowerCase(), new Date().toISOString()
		]);
		
		return result.lastID as number;
	}

	// Helper to get submission details
	async function getSubmissionDetails(submissionId: number): Promise<TestSubmission> {
		const result = await db.get<TestSubmission>(`
			SELECT id, member_id, species_class, species_type, witness_verification_status
			FROM submissions WHERE id = ?
		`, submissionId);
		return result as TestSubmission;
	}

	// Helper to create multiple submissions for testing
	async function createMultipleSubmissions(count: number, memberId: number): Promise<number[]> {
		const submissions: number[] = [];
		for (let i = 0; i < count; i++) {
			const id = await createTestSubmission(memberId, 'Fish', 'New World');
			submissions.push(id);
		}
		return submissions;
	}

	beforeEach(async () => {
		// Create fresh in-memory database for each test
		db = await open({
			filename: ':memory:',
			driver: sqlite3.Database,
		});
		
		// Enable foreign key constraints
		await db.exec('PRAGMA foreign_keys = ON;');
		
		// Run migrations
		await db.migrate({
			migrationsPath: './db/migrations',
		});
		
		// Override the global connection
		overrideConnection(db);

		// Create test users
		const memberEmail = `member-${Date.now()}@test.com`;
		const admin1Email = `admin1-${Date.now()}@test.com`;
		const admin2Email = `admin2-${Date.now()}@test.com`;
		const admin3Email = `admin3-${Date.now()}@test.com`;

		const memberId = await createMember(memberEmail, 'Test Member');
		const admin1Id = await createMember(admin1Email, 'Admin One');
		const admin2Id = await createMember(admin2Email, 'Admin Two');
		const admin3Id = await createMember(admin3Email, 'Admin Three');

		testMember = await getMember(memberId) as TestMember;
		admin1 = await getMember(admin1Id) as TestMember;
		admin2 = await getMember(admin2Id) as TestMember;
		admin3 = await getMember(admin3Id) as TestMember;
	});

	afterEach(async () => {
		try {
			await db.close();
		} catch {
			// Ignore close errors in tests
		}
	});

	describe('Basic Witness Operations', () => {
		it('should successfully confirm witness', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			await confirmWitness(submissionId, admin1.id);
			
			const submission = await getSubmissionDetails(submissionId);
			expect(submission.witness_verification_status).toBe('confirmed');
			
			const fullSubmission = await getSubmissionById(submissionId);
			expect(fullSubmission?.witnessed_by).toBe(admin1.id);
			expect(fullSubmission?.witnessed_on).toBeDefined();
		});

		it('should successfully decline witness', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			await declineWitness(submissionId, admin1.id);
			
			const submission = await getSubmissionDetails(submissionId);
			expect(submission.witness_verification_status).toBe('declined');
			
			const fullSubmission = await getSubmissionById(submissionId);
			expect(fullSubmission?.witnessed_by).toBe(admin1.id);
			expect(fullSubmission?.witnessed_on).toBeDefined();
		});

		it('should prevent self-witnessing on confirm', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			await expect(confirmWitness(submissionId, testMember.id))
				.rejects.toThrow('Cannot witness your own submission');
			
			const submission = await getSubmissionDetails(submissionId);
			expect(submission.witness_verification_status).toBe('pending');
		});

		it('should prevent self-witnessing on decline', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			await expect(declineWitness(submissionId, testMember.id))
				.rejects.toThrow('Cannot witness your own submission');
			
			const submission = await getSubmissionDetails(submissionId);
			expect(submission.witness_verification_status).toBe('pending');
		});

		it('should reject non-existent submission', async () => {
			const nonExistentId = 99999;
			
			await expect(confirmWitness(nonExistentId, admin1.id))
				.rejects.toThrow('Submission not found');
			
			await expect(declineWitness(nonExistentId, admin1.id))
				.rejects.toThrow('Submission not found');
		});

		it('should reject non-existent admin', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			const nonExistentAdminId = 99999;
			
			// These should fail at the database level due to foreign key constraints
			await expect(confirmWitness(submissionId, nonExistentAdminId))
				.rejects.toThrow();
			
			await expect(declineWitness(submissionId, nonExistentAdminId))
				.rejects.toThrow();
		});
	});

	describe('State Transition Validation', () => {
		it('should prevent confirming already confirmed submission', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			await confirmWitness(submissionId, admin1.id);
			
			await expect(confirmWitness(submissionId, admin2.id))
				.rejects.toThrow('Submission not in pending witness state');
		});

		it('should prevent declining already confirmed submission', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			await confirmWitness(submissionId, admin1.id);
			
			await expect(declineWitness(submissionId, admin2.id))
				.rejects.toThrow('Submission not in pending witness state');
		});

		it('should prevent confirming already declined submission', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			await declineWitness(submissionId, admin1.id);
			
			await expect(confirmWitness(submissionId, admin2.id))
				.rejects.toThrow('Submission not in pending witness state');
		});

		it('should prevent declining already declined submission', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			await declineWitness(submissionId, admin1.id);
			
			await expect(declineWitness(submissionId, admin2.id))
				.rejects.toThrow('Submission not in pending witness state');
		});

		it('should only allow witnessing submissions in pending state', async () => {
			// Test with pre-confirmed submission
			const confirmedId = await createTestSubmission(testMember.id, 'Fish', 'New World', 'confirmed');
			
			await expect(confirmWitness(confirmedId, admin1.id))
				.rejects.toThrow('Submission not in pending witness state');
			
			await expect(declineWitness(confirmedId, admin1.id))
				.rejects.toThrow('Submission not in pending witness state');
			
			// Test with pre-declined submission
			const declinedId = await createTestSubmission(testMember.id, 'Fish', 'New World', 'declined');
			
			await expect(confirmWitness(declinedId, admin1.id))
				.rejects.toThrow('Submission not in pending witness state');
			
			await expect(declineWitness(declinedId, admin1.id))
				.rejects.toThrow('Submission not in pending witness state');
		});
	});

	describe('Race Condition & Concurrency Tests', () => {
		it('should handle concurrent confirm attempts correctly', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			// Start both operations simultaneously
			const promise1 = confirmWitness(submissionId, admin1.id);
			const promise2 = confirmWitness(submissionId, admin2.id);
			
			const results = await Promise.allSettled([promise1, promise2]);
			
			// Exactly one should succeed, one should fail
			const succeeded = results.filter(r => r.status === 'fulfilled');
			const failed = results.filter(r => r.status === 'rejected');
			
			expect(succeeded).toHaveLength(1);
			expect(failed).toHaveLength(1);
			
			// Check final state
			const submission = await getSubmissionDetails(submissionId);
			expect(submission.witness_verification_status).toBe('confirmed');
			
			const fullSubmission = await getSubmissionById(submissionId);
			expect([admin1.id, admin2.id]).toContain(fullSubmission?.witnessed_by);
		});

		it('should handle concurrent decline attempts correctly', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			const promise1 = declineWitness(submissionId, admin1.id);
			const promise2 = declineWitness(submissionId, admin2.id);
			
			const results = await Promise.allSettled([promise1, promise2]);
			
			const succeeded = results.filter(r => r.status === 'fulfilled');
			const failed = results.filter(r => r.status === 'rejected');
			
			expect(succeeded).toHaveLength(1);
			expect(failed).toHaveLength(1);
			
			const submission = await getSubmissionDetails(submissionId);
			expect(submission.witness_verification_status).toBe('declined');
		});

		it('should handle mixed concurrent operations (confirm vs decline)', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			const confirmPromise = confirmWitness(submissionId, admin1.id);
			const declinePromise = declineWitness(submissionId, admin2.id);
			
			const results = await Promise.allSettled([confirmPromise, declinePromise]);
			
			const succeeded = results.filter(r => r.status === 'fulfilled');
			const failed = results.filter(r => r.status === 'rejected');
			
			expect(succeeded).toHaveLength(1);
			expect(failed).toHaveLength(1);
			
			const submission = await getSubmissionDetails(submissionId);
			expect(['confirmed', 'declined']).toContain(submission.witness_verification_status);
		});

		it('should handle high concurrency scenarios', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			// Create 10 concurrent operations
			const promises = Array.from({ length: 10 }, (_, i) => {
				const adminId = i % 2 === 0 ? admin1.id : admin2.id;
				const operation = i % 3 === 0 ? declineWitness : confirmWitness;
				return operation(submissionId, adminId);
			});
			
			const results = await Promise.allSettled(promises);
			
			// Exactly one should succeed
			const succeeded = results.filter(r => r.status === 'fulfilled');
			const failed = results.filter(r => r.status === 'rejected');
			
			expect(succeeded).toHaveLength(1);
			expect(failed).toHaveLength(9);
			
			// Check final state is valid
			const submission = await getSubmissionDetails(submissionId);
			expect(['confirmed', 'declined']).toContain(submission.witness_verification_status);
		});

		it.skip('should handle concurrent operations on multiple submissions', async () => {
			const submission1 = await createTestSubmission(testMember.id);
			const submission2 = await createTestSubmission(testMember.id);
			const submission3 = await createTestSubmission(testMember.id);
			
			// Each admin witnesses a different submission simultaneously
			const promise1 = confirmWitness(submission1, admin1.id);
			const promise2 = confirmWitness(submission2, admin2.id);
			const promise3 = declineWitness(submission3, admin3.id);
			
			await Promise.all([promise1, promise2, promise3]);
			
			// All should succeed since they're different submissions
			const sub1 = await getSubmissionDetails(submission1);
			const sub2 = await getSubmissionDetails(submission2);
			const sub3 = await getSubmissionDetails(submission3);
			
			expect(sub1.witness_verification_status).toBe('confirmed');
			expect(sub2.witness_verification_status).toBe('confirmed');
			expect(sub3.witness_verification_status).toBe('declined');
		});
	});

	describe('Data Integrity & Foreign Key Tests', () => {
		it('should maintain referential integrity for witnessed_by', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			await confirmWitness(submissionId, admin1.id);
			
			// Verify the foreign key relationship
			const result = await db.get<{ id: number; witnessed_by: number; display_name: string }>(`
				SELECT s.id, s.witnessed_by, m.display_name 
				FROM submissions s 
				JOIN members m ON s.witnessed_by = m.id 
				WHERE s.id = ?
			`, submissionId);
			
			expect(result?.witnessed_by).toBe(admin1.id);
			expect(result?.display_name).toBe(admin1.display_name);
		});

		it('should handle member deletion with ON DELETE SET NULL', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			await confirmWitness(submissionId, admin1.id);
			
			// Delete the admin (this should set witnessed_by to NULL due to ON DELETE SET NULL)
			await db.run('DELETE FROM members WHERE id = ?', admin1.id);
			
			const submission = await getSubmissionById(submissionId);
			expect(submission?.witnessed_by).toBeNull();
			expect(submission?.witness_verification_status).toBe('confirmed'); // Status should remain
		});

		it('should maintain transaction atomicity on failure', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			// Mock a database error during the transaction
			const originalPrepare = db.prepare.bind(db);
			let callCount = 0;
			
			db.prepare = jest.fn().mockImplementation((sql: string) => {
				callCount++;
				if (callCount === 2 && sql.includes('UPDATE')) {
					throw new Error('Simulated database error');
				}
				return originalPrepare(sql);
			});
			
			await expect(confirmWitness(submissionId, admin1.id)).rejects.toThrow();
			
			// Submission should remain in pending state
			const submission = await getSubmissionDetails(submissionId);
			expect(submission.witness_verification_status).toBe('pending');
			
			// Restore original function
			db.prepare = originalPrepare;
		});
	});

	describe('Waiting Period Integration', () => {
		it('should integrate with waiting period calculations for freshwater fish', async () => {
			const submissionId = await createTestSubmission(testMember.id, 'Fish', 'New World');
			
			await confirmWitness(submissionId, admin1.id);
			
			const submission = await getSubmissionById(submissionId);
			expect(submission).toBeDefined();
			
			const waitingStatus = getWaitingPeriodStatus(submission!);
			expect(waitingStatus.requiredDays).toBe(60); // Non-marine fish should be 60 days
			expect(waitingStatus.eligible).toBe(false); // Should not be eligible yet
		});

		it('should integrate with waiting period calculations for marine fish', async () => {
			const submissionId = await createTestSubmission(testMember.id, 'Fish', 'Marine');
			
			await confirmWitness(submissionId, admin1.id);
			
			const submission = await getSubmissionById(submissionId);
			expect(submission).toBeDefined();
			
			const waitingStatus = getWaitingPeriodStatus(submission!);
			expect(waitingStatus.requiredDays).toBe(30); // Marine fish should be 30 days
		});

		it('should integrate with waiting period calculations for plants', async () => {
			const submissionId = await createTestSubmission(testMember.id, 'Plant', 'Anubius');
			
			await confirmWitness(submissionId, admin1.id);
			
			const submission = await getSubmissionById(submissionId);
			expect(submission).toBeDefined();
			
			const waitingStatus = getWaitingPeriodStatus(submission!);
			expect(waitingStatus.requiredDays).toBe(60); // Plants should be 60 days
		});

		it('should not affect waiting period for declined submissions', async () => {
			const submissionId = await createTestSubmission(testMember.id, 'Fish', 'New World');
			
			await declineWitness(submissionId, admin1.id);
			
			const submission = await getSubmissionById(submissionId);
			expect(submission).toBeDefined();
			
			const waitingStatus = getWaitingPeriodStatus(submission!);
			expect(waitingStatus.eligible).toBe(false); // Declined submissions should not be eligible
		});
	});

	describe('Bulk Operations & Performance', () => {
		it.skip('should handle witnessing multiple submissions efficiently', async () => {
			const submissionIds = await createMultipleSubmissions(20, testMember.id);
			
			const startTime = Date.now();
			
			// Witness all submissions
			const promises = submissionIds.map((id, index) => {
				const adminId = index % 2 === 0 ? admin1.id : admin2.id;
				return confirmWitness(id, adminId);
			});
			
			await Promise.all(promises);
			
			const endTime = Date.now();
			const duration = endTime - startTime;
			
			// Should complete within reasonable time (adjust threshold as needed)
			expect(duration).toBeLessThan(5000); // 5 seconds
			
			// Verify all submissions were witnessed
			for (const submissionId of submissionIds) {
				const submission = await getSubmissionDetails(submissionId);
				expect(submission.witness_verification_status).toBe('confirmed');
			}
		});

		it.skip('should handle mixed bulk operations without interference', async () => {
			const submissionIds = await createMultipleSubmissions(10, testMember.id);
			
			// Mix of confirm and decline operations
			const promises = submissionIds.map((id, index) => {
				const adminId = admin1.id;
				return index % 2 === 0 
					? confirmWitness(id, adminId)
					: declineWitness(id, adminId);
			});
			
			await Promise.all(promises);
			
			// Verify results
			for (let i = 0; i < submissionIds.length; i++) {
				const submission = await getSubmissionDetails(submissionIds[i]);
				const expectedStatus = i % 2 === 0 ? 'confirmed' : 'declined';
				expect(submission.witness_verification_status).toBe(expectedStatus);
			}
		});
	});

	describe('Error Handling & Edge Cases', () => {
		it('should handle zero and negative submission IDs gracefully', async () => {
			await expect(confirmWitness(0, admin1.id))
				.rejects.toThrow('Submission not found');
			
			await expect(confirmWitness(-1, admin1.id))
				.rejects.toThrow('Submission not found');
			
			await expect(declineWitness(0, admin1.id))
				.rejects.toThrow('Submission not found');
			
			await expect(declineWitness(-1, admin1.id))
				.rejects.toThrow('Submission not found');
		});

		it('should handle extremely large IDs gracefully', async () => {
			const largeId = Number.MAX_SAFE_INTEGER;
			
			await expect(confirmWitness(largeId, admin1.id))
				.rejects.toThrow('Submission not found');
			
			await expect(declineWitness(largeId, admin1.id))
				.rejects.toThrow('Submission not found');
		});

		it('should preserve original error messages', async () => {
			const submissionId = await createTestSubmission(testMember.id);
			
			// Self-witnessing should preserve specific error message
			try {
				await confirmWitness(submissionId, testMember.id);
				fail('Should have thrown an error');
			} catch (error) {
				expect((error as Error).message).toBe('Cannot witness your own submission');
			}
			
			// Already witnessed should preserve specific error message
			await confirmWitness(submissionId, admin1.id);
			
			try {
				await confirmWitness(submissionId, admin2.id);
				fail('Should have thrown an error');
			} catch (error) {
				expect((error as Error).message).toBe('Submission not in pending witness state');
			}
		});

		it.skip('should handle concurrent operations with same admin', async () => {
			const submission1 = await createTestSubmission(testMember.id);
			const submission2 = await createTestSubmission(testMember.id);
			
			// Same admin witnessing multiple submissions simultaneously
			const promise1 = confirmWitness(submission1, admin1.id);
			const promise2 = declineWitness(submission2, admin1.id);
			
			await Promise.all([promise1, promise2]);
			
			const sub1 = await getSubmissionDetails(submission1);
			const sub2 = await getSubmissionDetails(submission2);
			
			expect(sub1.witness_verification_status).toBe('confirmed');
			expect(sub2.witness_verification_status).toBe('declined');
		});
	});

	describe('Real-world Workflow Scenarios', () => {
		it('should handle complete workflow: submission → witness → waiting period', async () => {
			// Create submission
			const submissionId = await createTestSubmission(testMember.id, 'Fish', 'Marine');
			
			// Initial state check
			let submission = await getSubmissionDetails(submissionId);
			expect(submission.witness_verification_status).toBe('pending');
			
			// Witness confirmation
			await confirmWitness(submissionId, admin1.id);
			
			// Check witnessed state
			submission = await getSubmissionDetails(submissionId);
			expect(submission.witness_verification_status).toBe('confirmed');
			
			// Check waiting period integration
			const fullSubmission = await getSubmissionById(submissionId);
			const waitingStatus = getWaitingPeriodStatus(fullSubmission!);
			expect(waitingStatus.requiredDays).toBe(30); // Marine fish
			expect(waitingStatus.elapsedDays).toBeGreaterThanOrEqual(0);
		});

		it('should handle admin managing multiple member submissions', async () => {
			// Create second member
			const member2Id = await createMember('member2@test.com', 'Member Two');
			
			// Create submissions from different members
			const submission1 = await createTestSubmission(testMember.id);
			const submission2 = await createTestSubmission(member2Id);
			const submission3 = await createTestSubmission(testMember.id);
			
			// Admin witnesses all submissions
			await confirmWitness(submission1, admin1.id);
			await confirmWitness(submission2, admin1.id);
			await declineWitness(submission3, admin1.id);
			
			// Verify all operations completed correctly
			const sub1 = await getSubmissionDetails(submission1);
			const sub2 = await getSubmissionDetails(submission2);
			const sub3 = await getSubmissionDetails(submission3);
			
			expect(sub1.witness_verification_status).toBe('confirmed');
			expect(sub2.witness_verification_status).toBe('confirmed');
			expect(sub3.witness_verification_status).toBe('declined');
		});

		it.skip('should handle multiple admins in the system efficiently', async () => {
			const submissions = await createMultipleSubmissions(15, testMember.id);
			
			// Distribute witnessing across admins
			const promises = submissions.map((submissionId, index) => {
				const adminId = [admin1.id, admin2.id, admin3.id][index % 3];
				const operation = index % 4 === 0 ? declineWitness : confirmWitness;
				return operation(submissionId, adminId);
			});
			
			await Promise.all(promises);
			
			// Verify distribution worked correctly
			const results = await Promise.all(
				submissions.map(id => getSubmissionDetails(id))
			);
			
			const confirmedCount = results.filter(r => r.witness_verification_status === 'confirmed').length;
			const declinedCount = results.filter(r => r.witness_verification_status === 'declined').length;
			
			expect(confirmedCount + declinedCount).toBe(submissions.length);
			expect(declinedCount).toBeGreaterThan(0); // Some should be declined
			expect(confirmedCount).toBeGreaterThan(0); // Some should be confirmed
		});
	});
});