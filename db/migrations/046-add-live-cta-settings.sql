-- Add settings table for configurable application settings
-- Starting with live CTA message for /live display page

-- Up

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default CTA message
INSERT INTO settings (key, value) VALUES
('live_cta_message', '# Join Our Breeder Awards Program!

Share your breeding successes and earn recognition in our community.

**Track your achievements • Earn points • Connect with fellow breeders**');

-- Down

DROP TABLE IF EXISTS settings;
