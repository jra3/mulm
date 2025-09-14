#!/bin/bash

# Create a test user
echo "Creating test user..."
USER_EMAIL="baptest+status_$(date +%s)@porcnick.com"
USER_NAME="Status Test User"

# Insert user and get the ID
sqlite3 db/database.db <<EOF
INSERT INTO members (display_name, contact_email, is_admin)
VALUES ('$USER_NAME', '$USER_EMAIL', 0);
EOF

# Get the member ID (using -line format to get just the value)
MEMBER_ID=$(sqlite3 -line db/database.db "SELECT id FROM members WHERE contact_email = '$USER_EMAIL';" | grep "id =" | cut -d'=' -f2 | tr -d ' ')

echo "Created user with ID: $MEMBER_ID"
echo "User email: $USER_EMAIL"

# Create submissions with various statuses

# 1. DRAFT submission (not submitted)
echo "Creating DRAFT submission..."
sqlite3 db/database.db <<EOF
INSERT INTO submissions (
  member_id, program, species_type, species_class, species_common_name, species_latin_name,
  water_type, count, reproduction_date, created_on, updated_on
) VALUES (
  $MEMBER_ID, 'fish', 'Fish', 'A', 'Draft Guppy', 'Poecilia reticulata',
  'Fresh', '20', date('now', '-10 days'), datetime('now'), datetime('now')
);
EOF

# 2. PENDING WITNESS submission
echo "Creating PENDING WITNESS submission..."
sqlite3 db/database.db <<EOF
INSERT INTO submissions (
  member_id, program, species_type, species_class, species_common_name, species_latin_name,
  water_type, count, reproduction_date, submitted_on, witness_verification_status,
  created_on, updated_on
) VALUES (
  $MEMBER_ID, 'fish', 'Fish', 'C', 'Witness Needed Angelfish', 'Pterophyllum scalare',
  'Fresh', '50', date('now', '-7 days'), datetime('now', '-5 days'), 'pending',
  datetime('now'), datetime('now')
);
EOF

# 3. WAITING PERIOD submission (30 days into 60-day period)
echo "Creating WAITING PERIOD submission..."
sqlite3 db/database.db <<EOF
INSERT INTO submissions (
  member_id, program, species_type, species_class, species_common_name, species_latin_name,
  water_type, count, reproduction_date, submitted_on,
  witness_verification_status, witnessed_on, witnessed_by,
  created_on, updated_on
) VALUES (
  $MEMBER_ID, 'fish', 'Fish', 'B', 'Waiting Period Tetra', 'Paracheirodon innesi',
  'Fresh', '30', date('now', '-30 days'), datetime('now', '-30 days'),
  'confirmed', datetime('now', '-30 days'), 1,
  datetime('now'), datetime('now')
);
EOF

# 4. PENDING APPROVAL (past waiting period)
echo "Creating PENDING APPROVAL submission..."
sqlite3 db/database.db <<EOF
INSERT INTO submissions (
  member_id, program, species_type, species_class, species_common_name, species_latin_name,
  water_type, count, reproduction_date, submitted_on,
  witness_verification_status, witnessed_on, witnessed_by,
  created_on, updated_on
) VALUES (
  $MEMBER_ID, 'fish', 'Fish', 'B', 'Ready for Approval Barb', 'Puntius titteya',
  'Fresh', '40', date('now', '-65 days'), datetime('now', '-65 days'),
  'confirmed', datetime('now', '-65 days'), 1,
  datetime('now'), datetime('now')
);
EOF

# 5. APPROVED submission
echo "Creating APPROVED submission..."
sqlite3 db/database.db <<EOF
INSERT INTO submissions (
  member_id, program, species_type, species_class, species_common_name, species_latin_name,
  water_type, count, reproduction_date, submitted_on,
  witness_verification_status, witnessed_on, witnessed_by,
  approved_on, approved_by, points,
  created_on, updated_on
) VALUES (
  $MEMBER_ID, 'fish', 'Fish', 'A', 'Approved Molly', 'Poecilia sphenops',
  'Fresh', '50', date('now', '-90 days'), datetime('now', '-85 days'),
  'confirmed', datetime('now', '-85 days'), 1,
  datetime('now', '-20 days'), 1, 5,
  datetime('now'), datetime('now')
);
EOF

# 6. DENIED submission
echo "Creating DENIED submission..."
sqlite3 db/database.db <<EOF
INSERT INTO submissions (
  member_id, program, species_type, species_class, species_common_name, species_latin_name,
  water_type, count, reproduction_date, submitted_on,
  witness_verification_status, witnessed_on, witnessed_by,
  denied_on, denied_by, denied_reason,
  created_on, updated_on
) VALUES (
  $MEMBER_ID, 'fish', 'Fish', 'B', 'Denied Cichlid', 'Apistogramma cacatuoides',
  'Fresh', '15', date('now', '-45 days'), datetime('now', '-40 days'),
  'confirmed', datetime('now', '-40 days'), 1,
  datetime('now', '-10 days'), 1, 'Incorrect species identification - these appear to be A. agassizii',
  datetime('now'), datetime('now')
);
EOF

# 7. PLANT WAITING PERIOD (45 days into 60-day period)
echo "Creating PLANT WAITING PERIOD submission..."
sqlite3 db/database.db <<EOF
INSERT INTO submissions (
  member_id, program, species_type, species_class, species_common_name, species_latin_name,
  water_type, count, reproduction_date, submitted_on,
  witness_verification_status, witnessed_on, witnessed_by,
  created_on, updated_on
) VALUES (
  $MEMBER_ID, 'plant', 'Plant', '10', 'Java Fern (Waiting)', 'Microsorum pteropus',
  'Fresh', '3', date('now', '-45 days'), datetime('now', '-45 days'),
  'confirmed', datetime('now', '-45 days'), 1,
  datetime('now'), datetime('now')
);
EOF

# 8. APPROVED PLANT
echo "Creating APPROVED PLANT submission..."
sqlite3 db/database.db <<EOF
INSERT INTO submissions (
  member_id, program, species_type, species_class, species_common_name, species_latin_name,
  water_type, count, reproduction_date, submitted_on,
  witness_verification_status, witnessed_on, witnessed_by,
  approved_on, approved_by, points,
  created_on, updated_on
) VALUES (
  $MEMBER_ID, 'plant', 'Plant', '5', 'Amazon Sword', 'Echinodorus amazonicus',
  'Fresh', '5', date('now', '-100 days'), datetime('now', '-95 days'),
  'confirmed', datetime('now', '-95 days'), 1,
  datetime('now', '-30 days'), 1, 5,
  datetime('now'), datetime('now')
);
EOF

# 9. CORAL PENDING WITNESS
echo "Creating CORAL PENDING WITNESS submission..."
sqlite3 db/database.db <<EOF
INSERT INTO submissions (
  member_id, program, species_type, species_class, species_common_name, species_latin_name,
  water_type, count, reproduction_date, submitted_on,
  witness_verification_status,
  created_on, updated_on
) VALUES (
  $MEMBER_ID, 'coral', 'Coral', '15', 'Green Star Polyps', 'Pachyclavularia violacea',
  'Salt', '1', date('now', '-14 days'), datetime('now', '-10 days'),
  'pending',
  datetime('now'), datetime('now')
);
EOF

echo ""
echo "✅ Test data created successfully!"
echo "Test user email: $USER_EMAIL"
echo "Test user ID: $MEMBER_ID"
echo ""
echo "View the submissions at: http://localhost:4200/member/$MEMBER_ID"