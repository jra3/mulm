import { describe, test } from 'node:test';
import assert from 'node:assert';
import { getSubmissionStatus } from '../utils/submissionStatus';
import { Submission } from '../db/submissions';

describe('Submission Status Calculation', () => {
  const baseSubmission: Partial<Submission> = {
    id: 1,
    species_type: 'Fish',
    species_common_name: 'Guppy',
    reproduction_date: '2024-01-01',
    submitted_on: null,
    approved_on: null,
    approved_by: null,
    points: null,
    witness_verification_status: 'pending',
    witnessed_on: null,
    denied_on: null,
    denied_by: null,
    denied_reason: null
  };

  describe('Draft Status', () => {
    test('should return draft status for unsubmitted submissions', () => {
      const submission = { ...baseSubmission, submitted_on: null };
      const status = getSubmissionStatus(submission);

      assert.strictEqual(status.status, 'draft');
      assert.strictEqual(status.label, 'Draft');
      assert.strictEqual(status.color, 'text-yellow-800');
      assert.strictEqual(status.bgColor, 'bg-yellow-100');
      assert.strictEqual(status.rowColor, 'bg-yellow-50');
      assert.strictEqual(status.description, 'Not yet submitted for review');
    });
  });

  describe('Approved Status', () => {
    test('should return approved status for approved submissions', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        approved_on: '2024-01-15',
        approved_by: 2,
        points: 10
      };
      const status = getSubmissionStatus(submission);

      assert.strictEqual(status.status, 'approved');
      assert.strictEqual(status.label, 'Approved');
      assert.strictEqual(status.color, 'text-green-800');
      assert.strictEqual(status.bgColor, 'bg-green-100');
      assert.strictEqual(status.rowColor, 'bg-green-50');
      assert.strictEqual(status.description, '10 points awarded');
    });

    test('should handle approved submissions with 0 points', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        approved_on: '2024-01-15',
        approved_by: 2,
        points: 0
      };
      const status = getSubmissionStatus(submission);

      assert.strictEqual(status.description, '0 points awarded');
    });
  });

  describe('Denied Status', () => {
    test('should return denied status for denied submissions', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        denied_on: '2024-01-10',
        denied_by: 2,
        denied_reason: 'Incorrect species identification'
      };
      const status = getSubmissionStatus(submission);

      assert.strictEqual(status.status, 'denied');
      assert.strictEqual(status.label, 'Denied');
      assert.strictEqual(status.color, 'text-red-800');
      assert.strictEqual(status.bgColor, 'bg-red-100');
      assert.strictEqual(status.rowColor, 'bg-red-50');
      assert.strictEqual(status.description, 'Incorrect species identification');
    });

    test('should handle denied submissions without reason', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        denied_on: '2024-01-10',
        denied_by: 2,
        denied_reason: null
      };
      const status = getSubmissionStatus(submission);

      assert.strictEqual(status.description, 'Submission was denied');
    });
  });

  describe('Pending Witness Status', () => {
    test('should return pending-witness status for submissions awaiting witness', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        witness_verification_status: 'pending' as const
      };
      const status = getSubmissionStatus(submission);

      assert.strictEqual(status.status, 'pending-witness');
      assert.strictEqual(status.label, 'Needs Witness');
      assert.strictEqual(status.color, 'text-purple-800');
      assert.strictEqual(status.bgColor, 'bg-purple-100');
      assert.strictEqual(status.rowColor, 'bg-purple-50');
      assert.strictEqual(status.description, 'Awaiting witness verification');
    });
  });

  describe('Waiting Period Status', () => {
    test('should return waiting-period status for witnessed submissions in waiting period', () => {
      // Mock a submission that's been witnessed but is still in waiting period
      const witnessedDate = new Date();
      witnessedDate.setDate(witnessedDate.getDate() - 30); // 30 days ago

      const submission: Partial<Submission> = {
        ...baseSubmission,
        submitted_on: witnessedDate.toISOString(),
        witness_verification_status: 'confirmed' as const,
        witnessed_on: witnessedDate.toISOString(),
        species_type: 'Fish',
        reproduction_date: witnessedDate.toISOString()
      };

      const status = getSubmissionStatus(submission);

      assert.strictEqual(status.status, 'waiting-period');
      assert.strictEqual(status.label, 'Waiting Period');
      assert.strictEqual(status.color, 'text-orange-800');
      assert.strictEqual(status.bgColor, 'bg-orange-100');
      assert.strictEqual(status.rowColor, 'bg-orange-50');
      assert.ok(status.daysRemaining !== undefined);
      assert.ok(status.daysRemaining > 0);
      assert.ok(status.daysRemaining <= 30);
    });
  });

  describe('Pending Approval Status', () => {
    test('should return pending-approval for witnessed submissions past waiting period', () => {
      // Mock a submission that's been witnessed and past waiting period
      const witnessedDate = new Date();
      witnessedDate.setDate(witnessedDate.getDate() - 65); // 65 days ago (past 60-day waiting period)

      const submission: Partial<Submission> = {
        ...baseSubmission,
        submitted_on: witnessedDate.toISOString(),
        witness_verification_status: 'confirmed' as const,
        witnessed_on: witnessedDate.toISOString(),
        species_type: 'Fish',
        reproduction_date: witnessedDate.toISOString()
      };

      const status = getSubmissionStatus(submission);

      assert.strictEqual(status.status, 'pending-approval');
      assert.strictEqual(status.label, 'Pending Review');
      assert.strictEqual(status.color, 'text-blue-800');
      assert.strictEqual(status.bgColor, 'bg-blue-100');
      assert.strictEqual(status.rowColor, 'bg-blue-50');
      assert.strictEqual(status.description, 'Ready for admin approval');
    });

    test('should return pending-approval for declined witness verification', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        witness_verification_status: 'declined' as const
      };
      const status = getSubmissionStatus(submission);

      assert.strictEqual(status.status, 'pending-approval');
      assert.strictEqual(status.label, 'Pending Review');
    });
  });

  describe('Priority Order', () => {
    test('should prioritize denied status over all others', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        approved_on: '2024-01-15',
        denied_on: '2024-01-16',
        denied_by: 2
      };
      const status = getSubmissionStatus(submission);

      assert.strictEqual(status.status, 'denied');
    });

    test('should prioritize approved status over pending statuses', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        approved_on: '2024-01-15',
        witness_verification_status: 'pending' as const
      };
      const status = getSubmissionStatus(submission);

      assert.strictEqual(status.status, 'approved');
    });
  });
});