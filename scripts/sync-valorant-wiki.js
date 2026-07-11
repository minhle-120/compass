import { syncValorantWiki } from '../src/services/valorantWikiSync.js';

const full = process.argv.includes('--full');

try {
  const result = await syncValorantWiki({ force: true, full });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`Valorant Wiki sync failed: ${error.message || error}`);
  process.exitCode = 1;
}
