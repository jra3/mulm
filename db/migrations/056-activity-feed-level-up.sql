-- Up

-- A Level rise now posts to the activity feed, alongside approvals and awards.
-- The feed's activity_type CHECK constraint has to be widened to admit it, and
-- SQLite cannot alter a CHECK in place, so the table is rebuilt.

CREATE TABLE activity_feed_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_type TEXT NOT NULL
        CHECK (activity_type IN ('submission_approved', 'award_granted', 'level_up')),
    member_id INTEGER NOT NULL
        REFERENCES members(id)
        ON DELETE CASCADE,
    related_id TEXT NOT NULL, -- submission_id for approvals, award_name for grants, program for levels
    activity_data TEXT, -- JSON data specific to activity type
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Carry the rows over, keeping only the newest entry per subject: the edit
-- path appended a second approval entry rather than updating the first, so
-- some subjects have duplicates that the unique index below would reject.
INSERT INTO activity_feed_new (id, activity_type, member_id, related_id, activity_data, created_at)
SELECT id, activity_type, member_id, related_id, activity_data, created_at
FROM activity_feed
WHERE id IN (
    SELECT MAX(id) FROM activity_feed GROUP BY activity_type, member_id, related_id
);

DROP TABLE activity_feed;
ALTER TABLE activity_feed_new RENAME TO activity_feed;

CREATE INDEX idx_activity_created_at ON activity_feed (created_at DESC);
CREATE INDEX idx_activity_type ON activity_feed (activity_type);
CREATE INDEX idx_activity_member ON activity_feed (member_id);

-- One entry per thing announced: an approval correction updates its entry
-- rather than appending a second one, and the feed cannot advertise the same
-- approval or award twice.
CREATE UNIQUE INDEX idx_activity_subject ON activity_feed (activity_type, member_id, related_id);

-- Down

DROP INDEX IF EXISTS idx_activity_subject;

CREATE TABLE activity_feed_old (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('submission_approved', 'award_granted')),
    member_id INTEGER NOT NULL
        REFERENCES members(id)
        ON DELETE CASCADE,
    related_id TEXT NOT NULL,
    activity_data TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO activity_feed_old (id, activity_type, member_id, related_id, activity_data, created_at)
SELECT id, activity_type, member_id, related_id, activity_data, created_at
FROM activity_feed
WHERE activity_type != 'level_up';

DROP TABLE activity_feed;
ALTER TABLE activity_feed_old RENAME TO activity_feed;

CREATE INDEX idx_activity_created_at ON activity_feed (created_at DESC);
CREATE INDEX idx_activity_type ON activity_feed (activity_type);
CREATE INDEX idx_activity_member ON activity_feed (member_id);
