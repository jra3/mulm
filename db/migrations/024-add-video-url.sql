-- Up
-- Add video URL field to submissions table for linking to external videos

ALTER TABLE submissions ADD COLUMN video_url TEXT DEFAULT NULL;

-- Down
ALTER TABLE submissions DROP COLUMN video_url;
