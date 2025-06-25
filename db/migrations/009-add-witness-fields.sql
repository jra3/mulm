-- Up

-- Add witness fields to submissions table
ALTER TABLE submissions ADD COLUMN witnessed_by INTEGER REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE submissions ADD COLUMN witnessed_on DATETIME;
ALTER TABLE submissions ADD COLUMN witness_verification_status TEXT 
    CHECK (witness_verification_status IN ('pending', 'confirmed', 'declined')) 
    DEFAULT 'pending';

-- Add indexes for witness queries
CREATE INDEX idx_submissions_witness_status ON submissions (witness_verification_status);
CREATE INDEX idx_submissions_witnessed_by ON submissions (witnessed_by);

-- Down

DROP INDEX IF EXISTS idx_submissions_witness_status;
DROP INDEX IF EXISTS idx_submissions_witnessed_by;
ALTER TABLE submissions DROP COLUMN witness_verification_status;
ALTER TABLE submissions DROP COLUMN witnessed_on;
ALTER TABLE submissions DROP COLUMN witnessed_by;