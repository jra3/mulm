import moduleAlias from "module-alias";
import path from "path";
moduleAlias.addAlias("@", path.join(__dirname, "..", "src"));

import { createMember } from '@/db/members';
import { createSubmission } from '@/db/submissions';
import { FormValues } from '@/forms/submission';
import { logger } from '@/utils/logger';
import { init } from '@/db/conn';

// Plausible test data
const fishNames = [
    { common: 'Betta', latin: 'Betta splendens', class: 'Anabantoids' },
    { common: 'Neon Tetra', latin: 'Paracheirodon innesi', class: 'Characins' },
    { common: 'Zebra Danio', latin: 'Danio rerio', class: 'Cyprinids' },
    { common: 'Corydoras', latin: 'Corydoras paleatus', class: 'Catfish' },
    { common: 'Guppy', latin: 'Poecilia reticulata', class: 'Livebearers' },
    { common: 'Angelfish', latin: 'Pterophyllum scalare', class: 'Cichlids' },
    { common: 'Cherry Barb', latin: 'Puntius titteya', class: 'Cyprinids' },
    { common: 'German Blue Ram', latin: 'Mikrogeophagus ramirezi', class: 'Cichlids' },
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

async function generateTestData() {
    try {
        logger.info('Starting test data generation...');
        
        // Change to parent directory so relative paths work correctly
        process.chdir(path.join(__dirname, '..'));
        
        // Initialize database connections
        await init();
        
        // Create John Allen first (admin)
        logger.info('Creating admin user John Allen...');
        const johnId = await createMember(
            'baptest@porcnick.com',
            'John Allen',
            { password: 'coralishard' },
            true
        );
        logger.info(`Created admin user John Allen with ID: ${johnId}`);
        
        // Create other test users
        const users: Array<{ id: number; name: string; email: string }> = [
            { id: johnId, name: 'John Allen', email: 'baptest@porcnick.com' }
        ];
        
        for (let i = 0; i < userNames.length; i++) {
            const name = userNames[i];
            const email = name.toLowerCase().replace(' ', '.') + '@example.com';
            const password = 'testpass123';
            
            logger.info(`Creating user: ${name}`);
            const userId = await createMember(
                email,
                name,
                { password },
                false
            );
            users.push({ id: userId, name, email });
            logger.info(`Created user ${name} with ID: ${userId}`);
        }
        
        // Generate submissions for each user
        logger.info('Generating submissions...');
        
        for (const user of users) {
            // Each user gets 2-5 submissions of various types
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
                
                // Randomly decide if submission should be submitted (80% chance)
                const shouldSubmit = Math.random() > 0.2;
                
                const submissionId = await createSubmission(user.id, formData, shouldSubmit);
                logger.info(`Created ${submissionType} submission ${submissionId} for user ${user.name} (submitted: ${shouldSubmit})`);
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