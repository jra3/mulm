import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname, "..", "src"));

import { createMember, getMemberByEmail, updateMember } from '@/db/members';
import { createSubmission, approveSubmission, confirmWitness, declineWitness, updateSubmission, getSubmissionById } from '@/db/submissions';
import { FormValues } from '@/forms/submission';
import { logger } from '@/utils/logger';
import { init } from '@/db/conn';
import { checkAndGrantSpecialtyAwards } from '@/specialtyAwardManager';
import { recordName } from '@/db/species';
import { createActivity } from '@/db/activity';

// Plausible test data
const fishNames = [
    { common: 'Betta', latin: 'Betta splendens', class: 'Anabantoids' },
    { common: 'Neon Tetra', latin: 'Paracheirodon innesi', class: 'Characins' },
    { common: 'Zebra Danio', latin: 'Danio rerio', class: 'Cyprinids' },
    { common: 'Corydoras', latin: 'Corydoras paleatus', class: 'Catfish & Loaches' },
    { common: 'Guppy', latin: 'Poecilia reticulata', class: 'Livebearers' },
    { common: 'Angelfish', latin: 'Pterophyllum scalare', class: 'Cichlids' },
    { common: 'Cherry Barb', latin: 'Puntius titteya', class: 'Cyprinids' },
    { common: 'German Blue Ram', latin: 'Mikrogeophagus ramirezi', class: 'Cichlids' },
];

// Additional catfish species for specialty award
const catfishNames = [
    { common: 'Bronze Corydoras', latin: 'Corydoras aeneus', class: 'Catfish & Loaches' },
    { common: 'Panda Corydoras', latin: 'Corydoras panda', class: 'Catfish & Loaches' },
    { common: 'Peppered Corydoras', latin: 'Corydoras paleatus', class: 'Catfish & Loaches' },
    { common: 'Sterbai Corydoras', latin: 'Corydoras sterbai', class: 'Catfish & Loaches' },
    { common: 'Julii Corydoras', latin: 'Corydoras julii', class: 'Catfish & Loaches' },
    // Non-Corydoras catfish (needed for award requirement)
    { common: 'Bristlenose Pleco', latin: 'Ancistrus cirrhosus', class: 'Catfish & Loaches' },
    { common: 'Otocinclus', latin: 'Otocinclus affinis', class: 'Catfish & Loaches' },
];

// Anabantoids species for specialty award
const anabantoidNames = [
    { common: 'Siamese Fighting Fish', latin: 'Betta splendens', class: 'Anabantoids' },
    { common: 'Paradise Fish', latin: 'Macropodus opercularis', class: 'Anabantoids' },
    { common: 'Dwarf Gourami', latin: 'Trichogaster lalius', class: 'Anabantoids' },
    { common: 'Pearl Gourami', latin: 'Trichopodus leerii', class: 'Anabantoids' },
    { common: 'Honey Gourami', latin: 'Trichogaster chuna', class: 'Anabantoids' },
    { common: 'Three Spot Gourami', latin: 'Trichopodus trichopterus', class: 'Anabantoids' },
    { common: 'Kissing Gourami', latin: 'Helostoma temminckii', class: 'Anabantoids' },
];

// Livebearers species for specialty award
const livebearerNames = [
    { common: 'Guppy', latin: 'Poecilia reticulata', class: 'Livebearers' },
    { common: 'Platy', latin: 'Xiphophorus maculatus', class: 'Livebearers' },
    { common: 'Swordtail', latin: 'Xiphophorus hellerii', class: 'Livebearers' },
    { common: 'Molly', latin: 'Poecilia sphenops', class: 'Livebearers' },
    { common: 'Endlers Livebearer', latin: 'Poecilia wingei', class: 'Livebearers' },
    { common: 'Mosquitofish', latin: 'Gambusia affinis', class: 'Livebearers' },
    { common: 'Green Swordtail', latin: 'Xiphophorus hellerii', class: 'Livebearers' },
    { common: 'Variatus Platy', latin: 'Xiphophorus variatus', class: 'Livebearers' },
    { common: 'Sailfin Molly', latin: 'Poecilia velifera', class: 'Livebearers' },
];

const plantNames = [
    { common: 'Java Fern', latin: 'Microsorum pteropus', class: 'Fern' },
    { common: 'Amazon Sword', latin: 'Echinodorus amazonicus', class: 'Rosette' },
    { common: 'Java Moss', latin: 'Taxiphyllum barbieri', class: 'Moss' },
    { common: 'Anubias', latin: 'Anubias barteri', class: 'Rosette' },
    { common: 'Water Wisteria', latin: 'Hygrophila difformis', class: 'Stem' },
    { common: 'Cryptocoryne', latin: 'Cryptocoryne wendtii', class: 'Rosette' },
];

const coralNames = [
    { common: 'Hammer Coral', latin: 'Euphyllia ancora', class: 'LPS' },
    { common: 'Zoanthids', latin: 'Zoanthus sp.', class: 'Soft' },
    { common: 'Green Star Polyps', latin: 'Pachyclavularia violacea', class: 'Soft' },
    { common: 'Montipora', latin: 'Montipora capricornis', class: 'SPS' },
    { common: 'Torch Coral', latin: 'Euphyllia glabrescens', class: 'LPS' },
    { common: 'Acropora', latin: 'Acropora millepora', class: 'SPS' },
];

const invertNames = [
    { common: 'Red Cherry Shrimp', latin: 'Neocaridina davidi', class: 'Shrimp' },
    { common: 'Amano Shrimp', latin: 'Caridina multidentata', class: 'Shrimp' },
    { common: 'Mystery Snail', latin: 'Pomacea bridgesii', class: 'Snail' },
    { common: 'Nerite Snail', latin: 'Neritina natalensis', class: 'Snail' },
];

const userNames = [
    'Sarah Johnson',
    'Michael Chen',
    'Emily Davis',
    'Robert Wilson',
    'Lisa Anderson',
    'David Martinez',
    'Jennifer Thompson',
    'Christopher Lee',
];

const fishFoods = ['flake food', 'brine shrimp', 'bloodworms', 'daphnia', 'algae wafers', 'pellets'];
const coralFoods = ['reef roids', 'phytoplankton', 'zooplankton', 'mysis shrimp', 'coral frenzy'];
const spawnLocations = ['cave', 'leaves', 'open water', 'substrate', 'bubble nest', 'plants'];
const filterTypes = ['sponge filter', 'hang-on-back', 'canister filter', 'internal filter', 'undergravel filter'];
const substrates = ['gravel', 'sand', 'bare bottom', 'planted substrate', 'crushed coral'];
const propagationMethods = ['runner', 'cutting', 'division', 'rhizome division', 'adventitious plantlets'];
const lightTypes = ['LED', 'T5', 'T8', 'Metal Halide', 'compact fluorescent'];

function randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysAgo: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - randomInt(1, daysAgo));
    return date;
}

function dateFromDaysAgo(daysAgo: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date;
}

function generateFishSubmission(memberName: string, memberEmail: string): FormValues {
    const fish = randomChoice(fishNames);
    const waterType = randomChoice(['Fresh', 'Brackish'] as const);

    return {
        member_name: memberName,
        member_email: memberEmail,
        species_type: 'Fish',
        species_class: fish.class,
        species_common_name: fish.common,
        species_latin_name: fish.latin,
        water_type: waterType,
        count: randomInt(10, 50).toString(),
        reproduction_date: randomDate(90).toISOString().split('T')[0],
        tank_size: randomChoice(['10', '20', '29', '40', '55', '75']) + ' gallons',
        filter_type: randomChoice(filterTypes),
        water_change_volume: randomChoice(['10%', '20%', '25%', '30%']),
        water_change_frequency: randomChoice(['weekly', 'bi-weekly', 'twice weekly']),
        temperature: randomInt(72, 82).toString() + 'F',
        ph: (6.5 + Math.random() * 1.5).toFixed(1),
        substrate_type: randomChoice(substrates),
        substrate_depth: randomInt(1, 3) + ' inches',
        substrate_color: randomChoice(['natural', 'black', 'white', 'brown']),
        foods: [randomChoice(fishFoods), randomChoice(fishFoods)],
        spawn_locations: [randomChoice(spawnLocations)],
    };
}

function generatePlantSubmission(memberName: string, memberEmail: string): FormValues {
    const plant = randomChoice(plantNames);

    return {
        member_name: memberName,
        member_email: memberEmail,
        species_type: 'Plant',
        species_class: plant.class,
        species_common_name: plant.common,
        species_latin_name: plant.latin,
        water_type: 'Fresh',
        reproduction_date: randomDate(60).toISOString().split('T')[0],
        tank_size: randomChoice(['10', '20', '29', '40']) + ' gallons',
        filter_type: randomChoice(filterTypes),
        water_change_volume: randomChoice(['20%', '25%', '30%']),
        water_change_frequency: 'weekly',
        temperature: randomInt(70, 78).toString() + 'F',
        ph: (6.8 + Math.random() * 0.6).toFixed(1),
        substrate_type: 'planted substrate',
        substrate_depth: '2-3 inches',
        substrate_color: 'black',
        propagation_method: randomChoice(propagationMethods),
        light_type: randomChoice(lightTypes),
        light_strength: randomChoice(['low', 'medium', 'high']),
        light_hours: randomInt(6, 10).toString(),
    };
}

function generateCoralSubmission(memberName: string, memberEmail: string): FormValues {
    const coral = randomChoice(coralNames);

    return {
        member_name: memberName,
        member_email: memberEmail,
        species_type: 'Coral',
        species_class: coral.class,
        species_common_name: coral.common,
        species_latin_name: coral.latin,
        water_type: 'Salt',
        reproduction_date: randomDate(120).toISOString().split('T')[0],
        tank_size: randomChoice(['20', '40', '75', '120']) + ' gallons',
        filter_type: 'protein skimmer + sump',
        water_change_volume: randomChoice(['10%', '15%', '20%']),
        water_change_frequency: 'weekly',
        temperature: randomInt(76, 80).toString() + 'F',
        ph: (8.1 + Math.random() * 0.3).toFixed(1),
        substrate_type: 'live sand',
        substrate_depth: '2 inches',
        substrate_color: 'white',
        foods: [randomChoice(coralFoods), randomChoice(coralFoods)],
        light_type: randomChoice(['LED', 'T5', 'Metal Halide']),
        light_strength: coral.class === 'SPS' ? 'high' : randomChoice(['medium', 'high']),
        light_hours: randomChoice(['8', '9', '10']),
    };
}

function generateInvertSubmission(memberName: string, memberEmail: string): FormValues {
    const invert = randomChoice(invertNames);

    return {
        member_name: memberName,
        member_email: memberEmail,
        species_type: 'Invert',
        species_class: invert.class,
        species_common_name: invert.common,
        species_latin_name: invert.latin,
        water_type: 'Fresh',
        count: randomInt(20, 100).toString(),
        reproduction_date: randomDate(30).toISOString().split('T')[0],
        tank_size: randomChoice(['5', '10', '20']) + ' gallons',
        filter_type: 'sponge filter',
        water_change_volume: '20%',
        water_change_frequency: 'weekly',
        temperature: randomInt(72, 78).toString() + 'F',
        ph: (7.0 + Math.random() * 0.5).toFixed(1),
        substrate_type: randomChoice(['gravel', 'sand']),
        substrate_depth: '1-2 inches',
        substrate_color: randomChoice(['natural', 'black']),
        foods: ['algae', 'biofilm', 'blanched vegetables'],
        spawn_locations: ['moss', 'plants'],
    };
}

function generateCatfishSubmission(memberName: string, memberEmail: string, catfish: { common: string; latin: string; class: string }): FormValues {
    return {
        member_name: memberName,
        member_email: memberEmail,
        species_type: 'Fish',
        species_class: catfish.class,
        species_common_name: catfish.common,
        species_latin_name: catfish.latin,
        water_type: 'Fresh',
        count: randomInt(20, 100).toString(),
        reproduction_date: randomDate(60).toISOString().split('T')[0],
        tank_size: randomChoice(['20', '29', '40', '55']) + ' gallons',
        filter_type: randomChoice(filterTypes),
        water_change_volume: randomChoice(['20%', '25%', '30%']),
        water_change_frequency: 'weekly',
        temperature: randomInt(74, 78).toString() + 'F',
        ph: (6.8 + Math.random() * 0.8).toFixed(1),
        substrate_type: randomChoice(['sand', 'fine gravel']),
        substrate_depth: '2 inches',
        substrate_color: randomChoice(['natural', 'black']),
        foods: [randomChoice(['sinking pellets', 'bloodworms', 'algae wafers']), randomChoice(fishFoods)],
        spawn_locations: [randomChoice(['cave', 'substrate', 'plants'])],
    };
}

function generateSpecialtyFishSubmission(memberName: string, memberEmail: string, fish: { common: string; latin: string; class: string }): FormValues {
    return {
        member_name: memberName,
        member_email: memberEmail,
        species_type: 'Fish',
        species_class: fish.class,
        species_common_name: fish.common,
        species_latin_name: fish.latin,
        water_type: randomChoice(['Fresh', 'Brackish'] as const),
        count: randomInt(10, 50).toString(),
        reproduction_date: randomDate(90).toISOString().split('T')[0],
        tank_size: randomChoice(['10', '20', '29', '40', '55', '75']) + ' gallons',
        filter_type: randomChoice(filterTypes),
        water_change_volume: randomChoice(['10%', '20%', '25%', '30%']),
        water_change_frequency: randomChoice(['weekly', 'bi-weekly', 'twice weekly']),
        temperature: randomInt(72, 82).toString() + 'F',
        ph: (6.5 + Math.random() * 1.5).toFixed(1),
        substrate_type: randomChoice(substrates),
        substrate_depth: randomInt(1, 3) + ' inches',
        substrate_color: randomChoice(['natural', 'black', 'white', 'brown']),
        foods: [randomChoice(fishFoods), randomChoice(fishFoods)],
        spawn_locations: [randomChoice(spawnLocations)],
    };
}

async function createWitnessTestSubmissions(users: Array<{ id: number; name: string; email: string }>, johnId: number) {
    logger.info('Creating submissions in various witness states...');

    const member1 = users.find(u => u.name === 'Sarah Johnson')!;
    const member2 = users.find(u => u.name === 'Michael Chen')!;
    const member3 = users.find(u => u.name === 'Emily Davis')!;
    const member4 = users.find(u => u.name === 'Robert Wilson')!;

    // 1. Draft submission (not submitted)
    logger.info('Creating draft submission...');
    const draftFormData = generateFishSubmission(member1.name, member1.email);
    const draftId = await createSubmission(member1.id, draftFormData, false); // false = draft
    logger.info(`Created draft submission ${draftId} for ${member1.name}`);

    // 2. Submitted - Awaiting Witness (pending)
    logger.info('Creating submission awaiting witness...');
    const pendingFormData = generateFishSubmission(member2.name, member2.email);
    pendingFormData.species_common_name = 'Angelfish';
    pendingFormData.species_latin_name = 'Pterophyllum scalare';
    pendingFormData.reproduction_date = dateFromDaysAgo(5).toISOString().split('T')[0]; // 5 days ago
    const pendingId = await createSubmission(member2.id, pendingFormData, true); // true = submitted
    logger.info(`Created pending witness submission ${pendingId} for ${member2.name}`);

    // 3. Witnessed & Confirmed - Still in Waiting Period
    logger.info('Creating witnessed submission in waiting period...');
    const waitingFormData = generateFishSubmission(member3.name, member3.email);
    waitingFormData.species_common_name = 'German Blue Ram';
    waitingFormData.species_latin_name = 'Mikrogeophagus ramirezi';
    waitingFormData.reproduction_date = dateFromDaysAgo(15).toISOString().split('T')[0]; // 15 days ago (still waiting)
    const waitingId = await createSubmission(member3.id, waitingFormData, true);
    await confirmWitness(waitingId, johnId); // John witnesses it
    logger.info(`Created witnessed submission ${waitingId} for ${member3.name} (15 days old - still waiting)`);

    // 4. Witnessed & Confirmed - Waiting Period Complete (Ready for Approval)
    logger.info('Creating witnessed submission ready for approval...');
    const readyFormData = generateFishSubmission(member4.name, member4.email);
    readyFormData.species_common_name = 'Zebra Danio';
    readyFormData.species_latin_name = 'Danio rerio';
    readyFormData.reproduction_date = dateFromDaysAgo(35).toISOString().split('T')[0]; // 35 days ago (past waiting period)
    const readyId = await createSubmission(member4.id, readyFormData, true);
    await confirmWitness(readyId, johnId); // John witnesses it
    logger.info(`Created witnessed submission ${readyId} for ${member4.name} (35 days old - ready for approval)`);

    // 5. Witness Declined
    logger.info('Creating declined witness submission...');
    const declinedFormData = generateFishSubmission(member1.name, member1.email);
    declinedFormData.species_common_name = 'Neon Tetra';
    declinedFormData.species_latin_name = 'Paracheirodon innesi';
    declinedFormData.reproduction_date = dateFromDaysAgo(10).toISOString().split('T')[0];
    const declinedId = await createSubmission(member1.id, declinedFormData, true);
    await declineWitness(declinedId, johnId); // John declines it
    logger.info(`Created declined witness submission ${declinedId} for ${member1.name}`);

    // 6. Plant submission with 60-day waiting period - Still Waiting
    logger.info('Creating plant submission in 60-day waiting period...');
    const plantWaitingFormData = generatePlantSubmission(member2.name, member2.email);
    plantWaitingFormData.species_common_name = 'Java Fern';
    plantWaitingFormData.species_latin_name = 'Microsorum pteropus';
    plantWaitingFormData.reproduction_date = dateFromDaysAgo(45).toISOString().split('T')[0]; // 45 days ago (still needs 15 more)
    const plantWaitingId = await createSubmission(member2.id, plantWaitingFormData, true);
    await confirmWitness(plantWaitingId, johnId); // John witnesses it
    logger.info(`Created plant submission ${plantWaitingId} for ${member2.name} (45 days old - still needs 15 more days)`);

    // 7. Plant submission - 60-day waiting period complete
    logger.info('Creating plant submission ready for approval...');
    const plantReadyFormData = generatePlantSubmission(member3.name, member3.email);
    plantReadyFormData.species_common_name = 'Amazon Sword';
    plantReadyFormData.species_latin_name = 'Echinodorus amazonicus';
    plantReadyFormData.reproduction_date = dateFromDaysAgo(70).toISOString().split('T')[0]; // 70 days ago (past 60-day waiting period)
    const plantReadyId = await createSubmission(member3.id, plantReadyFormData, true);
    await confirmWitness(plantReadyId, johnId); // John witnesses it
    logger.info(`Created plant submission ${plantReadyId} for ${member3.name} (70 days old - ready for approval)`);

    // 8. Coral submission in waiting period
    logger.info('Creating coral submission in waiting period...');
    const coralFormData = generateCoralSubmission(member4.name, member4.email);
    coralFormData.species_common_name = 'Hammer Coral';
    coralFormData.species_latin_name = 'Euphyllia ancora';
    coralFormData.reproduction_date = dateFromDaysAgo(20).toISOString().split('T')[0]; // 20 days ago (needs 10 more)
    const coralId = await createSubmission(member4.id, coralFormData, true);
    await confirmWitness(coralId, johnId); // John witnesses it
    logger.info(`Created coral submission ${coralId} for ${member4.name} (20 days old - needs 10 more days)`);

    logger.info('Witness test submissions created successfully!');
}

async function generateTestData() {
    try {
        logger.info('Starting test data generation...');

        // Change to parent directory so relative paths work correctly
        process.chdir(path.join(__dirname, '..'));

        // Initialize database connections
        await init();

        // Create or find John Allen (admin)
        logger.info('Creating/finding admin user John Allen...');
        let johnId: number;
        const existingJohn = await getMemberByEmail('baptest@porcnick.com');
        if (existingJohn) {
            johnId = existingJohn.id;
            // Ensure John Allen is an admin
            await updateMember(johnId, { is_admin: 1 });
            logger.info(`Found existing user John Allen with ID: ${johnId}, ensured admin status`);
        } else {
            johnId = await createMember(
                'baptest@porcnick.com',
                'John Allen',
                { password: 'coralishard' },
                true
            );
            logger.info(`Created admin user John Allen with ID: ${johnId}`);
        }

        // Create or find other test users
        const users: Array<{ id: number; name: string; email: string }> = [
            { id: johnId, name: 'John Allen', email: 'baptest@porcnick.com' }
        ];

        for (let i = 0; i < userNames.length; i++) {
            const name = userNames[i];
            const email = name.toLowerCase().replace(' ', '.') + '@porcnick.com';
            const password = 'testpass123';

            logger.info(`Creating/finding user: ${name}`);
            const existingUser = await getMemberByEmail(email);
            let userId: number;
            if (existingUser) {
                userId = existingUser.id;
                logger.info(`Found existing user ${name} with ID: ${userId}`);
            } else {
                userId = await createMember(
                    email,
                    name,
                    { password },
                    false
                );
                logger.info(`Created user ${name} with ID: ${userId}`);
            }
            users.push({ id: userId, name, email });
        }

        // Generate submissions for each user
        logger.info('Generating submissions...');

        // Track submissions to approve
        const submissionsToApprove: Array<{
            id: number;
            userId: number;
            points: number;
            genus: string;
            species: string;
            commonName: string;
            latinName: string;
            speciesType: string;
            speciesClass: string;
        }> = [];

        for (const user of users) {
            // John Allen gets specific catfish submissions for the specialty award
            if (user.name === 'John Allen') {
                logger.info('Creating catfish submissions for John Allen to earn Catfish Specialist award...');

                // Create 5+ catfish submissions (including at least 1 non-Corydoras)
                for (const catfish of catfishNames) {
                    const formData = generateCatfishSubmission(user.name, user.email, catfish);
                    const submissionId = await createSubmission(user.id, formData, true);

                    // Extract genus for canonical name
                    const [genus, species] = catfish.latin.split(' ');
                    submissionsToApprove.push({
                        id: submissionId,
                        userId: user.id,
                        points: randomInt(3, 8),
                        genus,
                        species: species || 'sp.',
                        commonName: catfish.common,
                        latinName: catfish.latin,
                        speciesType: 'Fish',
                        speciesClass: catfish.class
                    });

                    logger.info(`Created catfish submission ${submissionId} for John Allen: ${catfish.common}`);
                }

                // Add a few regular submissions too
                for (let i = 0; i < 3; i++) {
                    const submissionType = randomChoice(['fish', 'plant', 'coral']);
                    let formData: FormValues;

                    switch (submissionType) {
                        case 'fish':
                            formData = generateFishSubmission(user.name, user.email);
                            break;
                        case 'plant':
                            formData = generatePlantSubmission(user.name, user.email);
                            break;
                        case 'coral':
                            formData = generateCoralSubmission(user.name, user.email);
                            break;
                        default:
                            formData = generateFishSubmission(user.name, user.email);
                    }

                    const submissionId = await createSubmission(user.id, formData, true);
                    const [genus, species] = (formData.species_latin_name || 'Unknown species').split(' ');
                    submissionsToApprove.push({
                        id: submissionId,
                        userId: user.id,
                        points: randomInt(3, 8),
                        genus,
                        species: species || 'sp.',
                        commonName: formData.species_common_name || 'Unknown',
                        latinName: formData.species_latin_name || 'Unknown species',
                        speciesType: formData.species_type || 'Fish',
                        speciesClass: formData.species_class || 'Unknown'
                    });
                }
            } else if (user.name === 'Sarah Johnson') {
                // Sarah Johnson gets Anabantoids submissions for specialty award
                logger.info('Creating Anabantoids submissions for Sarah Johnson to earn Anabantoids Specialist award...');

                for (const anabantoid of anabantoidNames) {
                    const formData = generateSpecialtyFishSubmission(user.name, user.email, anabantoid);
                    const submissionId = await createSubmission(user.id, formData, true);

                    const [genus, species] = anabantoid.latin.split(' ');
                    submissionsToApprove.push({
                        id: submissionId,
                        userId: user.id,
                        points: randomInt(3, 8),
                        genus,
                        species: species || 'sp.',
                        commonName: anabantoid.common,
                        latinName: anabantoid.latin,
                        speciesType: 'Fish',
                        speciesClass: anabantoid.class
                    });

                    logger.info(`Created Anabantoids submission ${submissionId} for Sarah Johnson: ${anabantoid.common}`);
                }
            } else if (user.name === 'Michael Chen') {
                // Michael Chen gets Livebearers submissions for specialty award
                logger.info('Creating Livebearers submissions for Michael Chen to earn Livebearers Specialist award...');

                for (const livebearer of livebearerNames) {
                    const formData = generateSpecialtyFishSubmission(user.name, user.email, livebearer);
                    const submissionId = await createSubmission(user.id, formData, true);

                    const [genus, species] = livebearer.latin.split(' ');
                    submissionsToApprove.push({
                        id: submissionId,
                        userId: user.id,
                        points: randomInt(3, 8),
                        genus,
                        species: species || 'sp.',
                        commonName: livebearer.common,
                        latinName: livebearer.latin,
                        speciesType: 'Fish',
                        speciesClass: livebearer.class
                    });

                    logger.info(`Created Livebearers submission ${submissionId} for Michael Chen: ${livebearer.common}`);
                }
            } else {
                // Other users get regular random submissions
                const numSubmissions = randomInt(2, 5);

                for (let i = 0; i < numSubmissions; i++) {
                    const submissionType = randomChoice(['fish', 'plant', 'coral', 'invert']);
                    let formData: FormValues;

                    switch (submissionType) {
                        case 'fish':
                            formData = generateFishSubmission(user.name, user.email);
                            break;
                        case 'plant':
                            formData = generatePlantSubmission(user.name, user.email);
                            break;
                        case 'coral':
                            formData = generateCoralSubmission(user.name, user.email);
                            break;
                        case 'invert':
                            formData = generateInvertSubmission(user.name, user.email);
                            break;
                        default:
                            formData = generateFishSubmission(user.name, user.email);
                    }

                    // 70% chance of submission
                    const shouldSubmit = Math.random() > 0.3;

                    const submissionId = await createSubmission(user.id, formData, shouldSubmit);

                    if (shouldSubmit) {
                        const [genus, species] = (formData.species_latin_name || 'Unknown species').split(' ');
                        submissionsToApprove.push({
                            id: submissionId,
                            userId: user.id,
                            points: randomInt(3, 8),
                            genus,
                            species: species || 'sp.',
                            commonName: formData.species_common_name || 'Unknown',
                            latinName: formData.species_latin_name || 'Unknown species',
                            speciesType: formData.species_type || 'Fish',
                            speciesClass: formData.species_class || 'Unknown'
                        });
                    }

                    logger.info(`Created ${submissionType} submission ${submissionId} for user ${user.name} (submitted: ${shouldSubmit})`);
                }
            }
        }

        // Create witness test submissions to verify witness workflow
        await createWitnessTestSubmissions(users, johnId);

        // Witness and approve submissions following proper workflow
        logger.info('Processing submissions through witness and approval workflow...');

        for (const submission of submissionsToApprove) {
            try {
                // First witness the submission (required step)
                await confirmWitness(submission.id, johnId);
                logger.info(`Witnessed submission ${submission.id}`);

                // 85% chance of approval after witnessing
                if (Math.random() > 0.15) {
                    // Record the species name to get a proper species_name_id
                    const speciesNameId = await recordName({
                        program_class: submission.speciesType,
                        canonical_genus: submission.genus,
                        canonical_species_name: submission.species,
                        common_name: submission.commonName,
                        latin_name: submission.latinName
                    });

                    logger.info(`Recorded species: ${submission.latinName} (${submission.commonName}) with ID: ${speciesNameId}`);

                    // Now approve the submission with the correct species_name_id
                    await approveSubmission(
                        johnId, // John Allen approves everything
                        submission.id,
                        speciesNameId,
                        {
                            id: submission.id,
                            points: submission.points,
                            article_points: Math.random() > 0.7 ? randomInt(1, 3) : 0,
                            first_time_species: Math.random() > 0.5,
                            flowered: submission.speciesType === 'Plant' ? Math.random() > 0.7 : false,
                            sexual_reproduction: submission.speciesType === 'Plant' ? Math.random() > 0.6 : false,
                            canonical_genus: submission.genus,
                            canonical_species_name: submission.species
                        }
                    );
                    
                    // Create activity feed entry for submission approval (matching admin route behavior)
                    const updatedSubmission = await getSubmissionById(submission.id);
                    if (updatedSubmission) {
                        await createActivity(
                            'submission_approved',
                            submission.userId,
                            updatedSubmission.id.toString(),
                            {
                                species_common_name: updatedSubmission.species_common_name,
                                species_type: updatedSubmission.species_type,
                                points: updatedSubmission.points || 0,
                                first_time_species: Boolean(updatedSubmission.first_time_species),
                                article_points: updatedSubmission.article_points || undefined
                            }
                        );
                    }
                    
                    logger.info(`Approved submission ${submission.id} with species ID ${speciesNameId}`);
                } else {
                    logger.info(`Witnessed but not approved submission ${submission.id} (15% chance)`);
                }
            } catch (error) {
                logger.error(`Failed to process submission ${submission.id}:`, error);
            }
        }

        // Check for specialty awards
        logger.info('Checking for specialty awards...');

        for (const user of users) {
            const newAwards = await checkAndGrantSpecialtyAwards(user.id);
            if (newAwards.length > 0) {
                logger.info(`🏆 Awarded ${user.name}: ${newAwards.join(', ')}`);
            }
        }

        logger.info('Test data generation complete!');
        logger.info(`Created ${users.length} users and multiple submissions`);

    } catch (error) {
        logger.error('Error generating test data:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    generateTestData().then(() => {
        process.exit(0);
    });
}

export { generateTestData };
