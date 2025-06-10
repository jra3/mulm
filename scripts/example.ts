// Example script with top-level await
import { promises as fs } from 'fs';

console.log('Starting async script...');

// This will work with top-level await
const packageJson = JSON.parse(await fs.readFile('./package.json', 'utf-8'));
console.log(`Project name: ${packageJson.name}`);

console.log('Script completed!');