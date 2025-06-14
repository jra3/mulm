-- Up
CREATE TABLE submission_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('photo', 'link')),
    handle TEXT NOT NULL,
    created_on DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE INDEX idx_submission_attachments_submission_id ON submission_attachments(submission_id);

-- Down
DROP TABLE submission_attachments;