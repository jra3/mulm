-- Add admin notes for submissions
-- Private notes visible only to program admins for tracking submission history

CREATE TABLE submission_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL
        REFERENCES submissions(id)
        ON DELETE CASCADE,
    admin_id INTEGER
        REFERENCES members(id)
        ON DELETE SET NULL,
    note_text TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_submission_notes_submission ON submission_notes(submission_id, created_at DESC);
CREATE INDEX idx_submission_notes_admin ON submission_notes(admin_id);
