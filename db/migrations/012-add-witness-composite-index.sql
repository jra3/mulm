-- Up

-- Add composite index to optimize witness queue queries
-- This index helps with queries that filter by witness_verification_status and program,
-- then order by witnessed_on
CREATE INDEX idx_submissions_witness_program ON submissions (
    witness_verification_status,
    program,
    witnessed_on
);

-- Down

DROP INDEX IF EXISTS idx_submissions_witness_program;