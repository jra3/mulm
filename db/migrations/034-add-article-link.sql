-- Add article_link column to submissions table
-- Migration 034: Add article_link field for members to provide links to breeding articles

ALTER TABLE submissions ADD COLUMN article_link TEXT;
