-- Up

CREATE TABLE activity_feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('submission_approved', 'award_granted')),
    member_id INTEGER NOT NULL
        REFERENCES members(id)
        ON DELETE CASCADE,
    related_id TEXT NOT NULL, -- submission_id for approvals, award_name for grants
    activity_data TEXT, -- JSON data specific to activity type
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_created_at ON activity_feed (created_at DESC);
CREATE INDEX idx_activity_type ON activity_feed (activity_type);
CREATE INDEX idx_activity_member ON activity_feed (member_id);

-- Down

DROP TABLE IF EXISTS activity_feed;