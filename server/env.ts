import fs from 'node:fs';

// Imported first so other modules see the .env values.
if (fs.existsSync('.env')) process.loadEnvFile('.env');
