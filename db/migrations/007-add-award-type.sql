-- Up

-- Add award_type column to awards table
ALTER TABLE awards ADD COLUMN award_type TEXT DEFAULT 'species' CHECK (award_type IN ('species', 'meta_species', 'manual'));

-- Update existing awards based on their names
UPDATE awards 
SET award_type = 'meta_species' 
WHERE award_name IN ('Senior Specialist Award', 'Expert Specialist Award');

UPDATE awards 
SET award_type = 'species' 
WHERE award_name IN (
    'Anabantoids Specialist',
    'Brackish Water Specialist',
    'Catfish Specialist',
    'Characins Specialist',
    'New World Cichlids Specialist',
    'Old World Cichlids Specialist',
    'Cyprinids Specialist',
    'Killifish Specialist',
    'Livebearers Specialist',
    'Marine Fish Specialist',
    'Marine Invertebrates & Corals Specialist'
);

-- Down

-- Note: SQLite doesn't support DROP COLUMN directly
-- We would need to recreate the table without the column
-- For now, we'll leave this as a comment