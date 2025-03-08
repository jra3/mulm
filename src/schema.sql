-- # Create your table with this file
-- > cd ~/mulm
-- > sqlite3 database.db < src/schema.sql

-- # test data
-- > sqlite3 database.sqlite ".mode csv" ".import src/MOCK_DATA.csv submissions"

CREATE TABLE submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    submission_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    member_name TEXT NOT NULL,
    species_name TEXT NOT NULL,

    date_approved DATETIME DEFAULT NULL,
    approved_by TEXT DEFAULT NULL,
    points INTEGER DEFAULT NULL
);

CREATE INDEX idx_member_name ON submissions (member_name);
CREATE INDEX idx_date_approved ON submissions (date_approved);
