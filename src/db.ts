import { Database, OPEN_READWRITE, OPEN_CREATE } from 'sqlite3';

const db = new Database('./database.sqlite', OPEN_READWRITE | OPEN_CREATE, (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to SQLite database.');
});

const submissions = `
CREATE TABLE submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time DATETIME DEFAULT CURRENT_TIMESTAMP,
    member_name TEXT NOT NULL,
    date_approved TEXT NOT NULL
);

CREATE INDEX idx_member_name ON submissions (member_name);
CREATE INDEX idx_date_approved ON submissions (date_approved);
`;

db.run(submissions);
