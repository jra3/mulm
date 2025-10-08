-- Up

-- Add species_type column to species_name_group
ALTER TABLE species_name_group ADD COLUMN species_type TEXT;

-- Populate species_type based on program_class

-- Fish species (BAP fish classes)
UPDATE species_name_group SET species_type = 'Fish'
WHERE program_class IN (
    'Anabantoids',
    'Brackish Water',
    'Catfish & Loaches',
    'Characins',
    'Cichlids',
    'Cyprinids',
    'Fish',
    'Killifish',
    'Livebearers',
    'Marine',
    'Miscellaneous',
    'Native'
);

-- Invert species
UPDATE species_name_group SET species_type = 'Invert'
WHERE program_class IN (
    'Shrimp',
    'Snail',
    'Other'
);

-- Plant species (HAP classes)
UPDATE species_name_group SET species_type = 'Plant'
WHERE program_class IN (
    'Apongetons & Criniums',
    'Anubias & Lagenandra',
    'Cryptocoryne',
    'Floating Plants',
    'Primative Plants',
    'Rosette Plants',
    'Stem Plants',
    'Sword Plants',
    'Water Lilles'
);

-- Coral species (CAP classes)
UPDATE species_name_group SET species_type = 'Coral'
WHERE program_class IN (
    'Hard',
    'Soft'
);

-- Verify all species have a type
-- Any species without a type will be set to Fish as fallback
UPDATE species_name_group SET species_type = 'Fish'
WHERE species_type IS NULL;

-- Make column NOT NULL now that it's populated
-- Note: SQLite doesn't support ALTER COLUMN, so we document the constraint
-- The column should always have a value after this migration

-- Down
-- SQLite doesn't support DROP COLUMN
-- Column can remain if migration is rolled back
