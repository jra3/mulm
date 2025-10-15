-- Up
-- Split Cichlids into New World (American) and Old World (African/Asian) classes
-- This enables proper specialty award tracking per BAP manual requirements

-- Update species_name_group for New World (American) cichlids
UPDATE species_name_group
SET program_class = 'Cichlids - New World'
WHERE program_class = 'Cichlids'
AND canonical_genus IN (
    -- Central/South American cichlids
    'Amatitlania',
    'Amphilophus',
    'Apistogramma',
    'Archocentrus',
    'Biotodoma',
    'Biotoecus',
    'Caquetaia',
    'Chiapaheros',
    'Cichlasoma',
    'Cincelichthys',
    'Cleithracara',
    'Crenicara',
    'Crenicichla',
    'Cribroheros',
    'Cryptoheros',
    'Dicrossus',
    'Geophagus',
    'Guianacara',
    'Herichthys',
    'Hericythys',
    'Herotilapia',
    'Hoplarchus',
    'Hypselecara',
    'Hypsophrys',
    'Kronoheros',
    'Laetacara',
    'Maskaheros',
    'Mayaheros',
    'Mesoheros',
    'Mesonauta',
    'Mikrogeophagus',
    'Nandopsis',
    'Nannacara',
    'Parachromis',
    'Pterophyllum',
    'Rocio',
    'Thorichthys',
    'Trichromis',
    'Vieja'
);

-- Update species_name_group for Old World (African/Asian) cichlids
UPDATE species_name_group
SET program_class = 'Cichlids - Old World'
WHERE program_class = 'Cichlids'
AND canonical_genus IN (
    -- African & Asian cichlids
    'Allochromis',
    'Anomalochromis',
    'Astatotilapia',
    'Aulonocara',
    'Benitochromis',
    'Cardiopharynx',
    'Chetia',
    'Chindongo',
    'Coelotilapia',
    'Copadichromis',
    'Coptodon',
    'Corematodus',
    'Cyathopharynx',
    'Cyclopharynx',
    'Cynotilapia',
    'Cyprichromis',
    'Cyrtocara',
    'Dimidiochromis',
    'Docimodus',
    'Ectodus',
    'Enigmatochromis',
    'Enterochromis',
    'Eretmodus',
    'Etia',
    'Gaurochromis',
    'Gobiocichla',
    'Haplochromis',
    'Harpagochromis',
    'Hemichromis',
    'Heterochromis',
    'Hoplotilapia',
    'Iodotropheus',
    'Katria',
    'Konia',
    'Labeotropheus',
    'Labidochromis',
    'Labrochromis',
    'Lethrinops',
    'Limbochromis',
    'Lipochromis',
    'Lithochromis',
    'Macropleurodus',
    'Maylandia',
    'Mbipia',
    'Mchenga',
    'Melanochromis',
    'Metriaclima',
    'Myaka',
    'Mylochromis',
    'Nanochromis',
    'Neochromis',
    'Neolamprologus',
    'Nimbochromis',
    'Nyassachromis',
    'Oreochromis',
    'Otopharynx',
    'Paralabidochromis',
    'Paratilapia',
    'Paretroplus',
    'Pelvicachromis',
    'Placidochromis',
    'Platytaeniodus',
    'Prognathochromis',
    'Protomelas',
    'Psammochromis',
    'Pseudotropheus',
    'Ptychochromis',
    'Ptychochromoides',
    'Ptyochromis',
    'Pundamilia',
    'Pungu',
    'Pyxichromis',
    'Rubricatochromis',
    'Sarotherodon',
    'Sciaenochromis',
    'Schwetzochromis',
    'Serranochromis',
    'Steatocranus',
    'Stomatepia',
    'Teleogramma',
    'Thoracochromis',
    'Tilapia',
    'Tramitichromis',
    'Trematocranus',
    'Tropheops',
    'Xenotilapia',
    'Xystichromis',
    'Yssichromis'
);

-- Catch-all: Any remaining 'Cichlids' entries are assumed to be Old World
-- (defensive measure for any genera not explicitly listed above)
UPDATE species_name_group
SET program_class = 'Cichlids - Old World'
WHERE program_class = 'Cichlids';

-- Update existing submissions where species_class is 'Cichlids'
-- Match with species_name_group to get the new class name
UPDATE submissions
SET species_class = (
    SELECT sng.program_class
    FROM species_name_group sng
    LEFT JOIN species_common_name scn ON sng.group_id = scn.group_id
    LEFT JOIN species_scientific_name ssn ON sng.group_id = ssn.group_id
    WHERE (submissions.common_name_id = scn.common_name_id
           OR submissions.scientific_name_id = ssn.scientific_name_id)
    AND sng.program_class LIKE 'Cichlids -%'
    LIMIT 1
)
WHERE submissions.species_class = 'Cichlids'
AND EXISTS (
    SELECT 1
    FROM species_name_group sng
    LEFT JOIN species_common_name scn ON sng.group_id = scn.group_id
    LEFT JOIN species_scientific_name ssn ON sng.group_id = ssn.group_id
    WHERE (submissions.common_name_id = scn.common_name_id
           OR submissions.scientific_name_id = ssn.scientific_name_id)
    AND sng.program_class LIKE 'Cichlids -%'
);

-- Down
-- Revert species_name_group back to 'Cichlids'
UPDATE species_name_group
SET program_class = 'Cichlids'
WHERE program_class IN ('Cichlids - New World', 'Cichlids - Old World');

-- Revert submissions back to 'Cichlids'
UPDATE submissions
SET species_class = 'Cichlids'
WHERE species_class IN ('Cichlids - New World', 'Cichlids - Old World');
