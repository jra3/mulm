import * as path from 'path';
import moduleAlias from 'module-alias';
moduleAlias.addAlias('@', path.join(__dirname, '../src'));

import { db } from '@/db/conn';
import { createMember } from '@/db/members';
import { logger } from '@/utils/logger';

async function createTestStatusData() {
  try {
    // Create a test user
    const testEmail = `baptest+status_${Date.now()}@porcnick.com`;
    const memberId = await createMember(testEmail, 'Status Test User');

    logger.info(`Created test user with ID: ${memberId}`);

    // Get current date for various status calculations
    const now = new Date();
    const database = db(true);

    // 1. DRAFT submission (not submitted)
    await database.run(`
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        water_type, count, reproduction_date, created_on, updated_on
      ) VALUES (?, 'fish', 'Fish', 'A', 'Draft Guppy', 'Poecilia reticulata',
        'Fresh', '20', date('now', '-10 days'), datetime('now'), datetime('now'))
    `, [memberId]);
    logger.info('Created DRAFT submission');

    // 2. PENDING WITNESS submission (submitted, needs witness)
    await database.run(`
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        water_type, count, reproduction_date, submitted_on, witness_verification_status,
        created_on, updated_on
      ) VALUES (?, 'fish', 'Fish', 'C', 'Witness Needed Angelfish', 'Pterophyllum scalare',
        'Fresh', '50', date('now', '-7 days'), datetime('now', '-5 days'), 'pending',
        datetime('now'), datetime('now'))
    `, [memberId]);
    logger.info('Created PENDING WITNESS submission');

    // 3. WAITING PERIOD submission (witnessed 30 days ago, still in 60-day waiting period)
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    await database.run(`
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        water_type, count, reproduction_date, submitted_on,
        witness_verification_status, witnessed_on, witnessed_by,
        created_on, updated_on
      ) VALUES (?, 'fish', 'Fish', 'B', 'Waiting Period Tetra', 'Paracheirodon innesi',
        'Fresh', '30', ?, ?,
        'confirmed', ?, 1,
        datetime('now'), datetime('now'))
    `, [memberId, thirtyDaysAgo.toISOString(), thirtyDaysAgo.toISOString(), thirtyDaysAgo.toISOString()]);
    logger.info('Created WAITING PERIOD submission (30 days into 60-day period)');

    // 4. PENDING APPROVAL submission (witnessed 65 days ago, past waiting period)
    const sixtyFiveDaysAgo = new Date(now);
    sixtyFiveDaysAgo.setDate(sixtyFiveDaysAgo.getDate() - 65);

    await database.run(`
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        water_type, count, reproduction_date, submitted_on,
        witness_verification_status, witnessed_on, witnessed_by,
        created_on, updated_on
      ) VALUES (?, 'fish', 'Fish', 'B', 'Ready for Approval Barb', 'Puntius titteya',
        'Fresh', '40', ?, ?,
        'confirmed', ?, 1,
        datetime('now'), datetime('now'))
    `, [memberId, sixtyFiveDaysAgo.toISOString(), sixtyFiveDaysAgo.toISOString(), sixtyFiveDaysAgo.toISOString()]);
    logger.info('Created PENDING APPROVAL submission');

    // 5. APPROVED submission
    await database.run(`
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        water_type, count, reproduction_date, submitted_on,
        witness_verification_status, witnessed_on, witnessed_by,
        approved_on, approved_by, points,
        created_on, updated_on
      ) VALUES (?, 'fish', 'Fish', 'A', 'Approved Molly', 'Poecilia sphenops',
        'Fresh', '50', date('now', '-90 days'), datetime('now', '-85 days'),
        'confirmed', datetime('now', '-85 days'), 1,
        datetime('now', '-20 days'), 1, 5,
        datetime('now'), datetime('now'))
    `, [memberId]);
    logger.info('Created APPROVED submission');

    // 6. DENIED submission
    await database.run(`
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        water_type, count, reproduction_date, submitted_on,
        witness_verification_status, witnessed_on, witnessed_by,
        denied_on, denied_by, denied_reason,
        created_on, updated_on
      ) VALUES (?, 'fish', 'Fish', 'B', 'Denied Cichlid', 'Apistogramma cacatuoides',
        'Fresh', '15', date('now', '-45 days'), datetime('now', '-40 days'),
        'confirmed', datetime('now', '-40 days'), 1,
        datetime('now', '-10 days'), 1, 'Incorrect species identification - these appear to be A. agassizii',
        datetime('now'), datetime('now'))
    `, [memberId]);
    logger.info('Created DENIED submission');

    // Add some variety with plant submissions

    // 7. WAITING PERIOD plant (propagated 45 days ago)
    const fortyFiveDaysAgo = new Date(now);
    fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);

    await database.run(`
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        water_type, count, reproduction_date, submitted_on,
        witness_verification_status, witnessed_on, witnessed_by,
        created_on, updated_on
      ) VALUES (?, 'plant', 'Plant', '10', 'Java Fern (Waiting)', 'Microsorum pteropus',
        'Fresh', '3', ?, ?,
        'confirmed', ?, 1,
        datetime('now'), datetime('now'))
    `, [memberId, fortyFiveDaysAgo.toISOString(), fortyFiveDaysAgo.toISOString(), fortyFiveDaysAgo.toISOString()]);
    logger.info('Created PLANT WAITING PERIOD submission');

    // 8. APPROVED plant
    await database.run(`
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        water_type, count, reproduction_date, submitted_on,
        witness_verification_status, witnessed_on, witnessed_by,
        approved_on, approved_by, points,
        created_on, updated_on
      ) VALUES (?, 'plant', 'Plant', '5', 'Amazon Sword', 'Echinodorus amazonicus',
        'Fresh', '5', date('now', '-100 days'), datetime('now', '-95 days'),
        'confirmed', datetime('now', '-95 days'), 1,
        datetime('now', '-30 days'), 1, 5,
        datetime('now'), datetime('now'))
    `, [memberId]);
    logger.info('Created APPROVED PLANT submission');

    // 9. PENDING WITNESS coral
    await database.run(`
      INSERT INTO submissions (
        member_id, program, species_type, species_class, species_common_name, species_latin_name,
        water_type, count, reproduction_date, submitted_on,
        witness_verification_status,
        created_on, updated_on
      ) VALUES (?, 'coral', 'Coral', '15', 'Green Star Polyps', 'Pachyclavularia violacea',
        'Salt', '1', date('now', '-14 days'), datetime('now', '-10 days'),
        'pending',
        datetime('now'), datetime('now'))
    `, [memberId]);
    logger.info('Created CORAL PENDING WITNESS submission');

    logger.info(`\nTest data created successfully!`);
    logger.info(`Test user email: ${testEmail}`);
    logger.info(`Test user ID: ${memberId}`);
    logger.info(`\nYou can view the submissions at: http://localhost:4200/member/${memberId}`);

  } catch (error) {
    logger.error('Error creating test data:', error);
    process.exit(1);
  }
}

// Run the script
createTestStatusData().then(() => {
  logger.info('Script completed successfully');
  process.exit(0);
}).catch(error => {
  logger.error('Script failed:', error);
  process.exit(1);
});