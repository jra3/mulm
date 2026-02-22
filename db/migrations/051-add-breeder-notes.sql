-- Add optional breeder notes field to submissions
-- Freeform text for collection data, breeding notes, lineage info, etc.

ALTER TABLE submissions ADD COLUMN notes TEXT;
