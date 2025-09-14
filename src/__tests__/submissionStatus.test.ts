import { getSubmissionStatus, SubmissionStatus } from '../utils/submissionStatus';
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
    it('should return draft status for unsubmitted submissions', () => {
      const submission = { ...baseSubmission, submitted_on: null };
      const status = getSubmissionStatus(submission);

      expect(status.status).toBe('draft');
      expect(status.label).toBe('Draft');
      expect(status.color).toBe('text-yellow-800');
      expect(status.bgColor).toBe('bg-yellow-100');
      expect(status.rowColor).toBe('bg-yellow-50');
      expect(status.description).toBe('Not yet submitted for review');
    });
  });

  describe('Approved Status', () => {
    it('should return approved status for approved submissions', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        approved_on: '2024-01-15',
        approved_by: 2,
        points: 10
      };
      const status = getSubmissionStatus(submission);

      expect(status.status).toBe('approved');
      expect(status.label).toBe('Approved');
      expect(status.color).toBe('text-green-800');
      expect(status.bgColor).toBe('bg-green-100');
      expect(status.rowColor).toBe('bg-green-50');
      expect(status.description).toBe('10 points awarded');
    });

    it('should handle approved submissions with 0 points', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        approved_on: '2024-01-15',
        approved_by: 2,
        points: 0
      };
      const status = getSubmissionStatus(submission);

      expect(status.description).toBe('0 points awarded');
    });
  });

  describe('Denied Status', () => {
    it('should return denied status for denied submissions', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        denied_on: '2024-01-10',
        denied_by: 2,
        denied_reason: 'Incorrect species identification'
      };
      const status = getSubmissionStatus(submission);

      expect(status.status).toBe('denied');
      expect(status.label).toBe('Denied');
      expect(status.color).toBe('text-red-800');
      expect(status.bgColor).toBe('bg-red-100');
      expect(status.rowColor).toBe('bg-red-50');
      expect(status.description).toBe('Incorrect species identification');
    });

    it('should handle denied submissions without reason', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        denied_on: '2024-01-10',
        denied_by: 2,
        denied_reason: null
      };
      const status = getSubmissionStatus(submission);

      expect(status.description).toBe('Submission was denied');
    });
  });

  describe('Pending Witness Status', () => {
    it('should return pending-witness status for submissions awaiting witness', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        witness_verification_status: 'pending' as const
      };
      const status = getSubmissionStatus(submission);

      expect(status.status).toBe('pending-witness');
      expect(status.label).toBe('Needs Witness');
      expect(status.color).toBe('text-purple-800');
      expect(status.bgColor).toBe('bg-purple-100');
      expect(status.rowColor).toBe('bg-purple-50');
      expect(status.description).toBe('Awaiting witness verification');
    });
  });

  describe('Waiting Period Status', () => {
    it('should return waiting-period status for witnessed submissions in waiting period', () => {
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

      expect(status.status).toBe('waiting-period');
      expect(status.label).toBe('Waiting Period');
      expect(status.color).toBe('text-orange-800');
      expect(status.bgColor).toBe('bg-orange-100');
      expect(status.rowColor).toBe('bg-orange-50');
      expect(status.daysRemaining).toBeDefined();
      expect(status.daysRemaining).toBeGreaterThan(0);
      expect(status.daysRemaining).toBeLessThanOrEqual(30);
    });
  });

  describe('Pending Approval Status', () => {
    it('should return pending-approval for witnessed submissions past waiting period', () => {
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

      expect(status.status).toBe('pending-approval');
      expect(status.label).toBe('Pending Review');
      expect(status.color).toBe('text-blue-800');
      expect(status.bgColor).toBe('bg-blue-100');
      expect(status.rowColor).toBe('bg-blue-50');
      expect(status.description).toBe('Ready for admin approval');
    });

    it('should return pending-approval for declined witness verification', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        witness_verification_status: 'declined' as const
      };
      const status = getSubmissionStatus(submission);

      expect(status.status).toBe('pending-approval');
      expect(status.label).toBe('Pending Review');
    });
  });

  describe('Priority Order', () => {
    it('should prioritize denied status over all others', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        approved_on: '2024-01-15',
        denied_on: '2024-01-16',
        denied_by: 2
      };
      const status = getSubmissionStatus(submission);

      expect(status.status).toBe('denied');
    });

    it('should prioritize approved status over pending statuses', () => {
      const submission = {
        ...baseSubmission,
        submitted_on: '2024-01-01',
        approved_on: '2024-01-15',
        witness_verification_status: 'pending' as const
      };
      const status = getSubmissionStatus(submission);

      expect(status.status).toBe('approved');
    });
  });
});