import { closeWikiDb, initWikiDb } from '../services/wiki/wikiService.js';
import { refreshWikiCatalog } from '../services/wiki/catalogImporter.js';

try {
  initWikiDb();
  console.log(JSON.stringify(await refreshWikiCatalog(), null, 2));
} catch (error) {
  console.error(`Valorant catalog download failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  closeWikiDb();
}
