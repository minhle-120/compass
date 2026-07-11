import { closeWikiDb, initWikiDb } from '../services/wiki/wikiService.js';
import { refreshWikiCatalog } from '../services/wiki/catalogImporter.js';
import { refreshWikiSnapshotFromValorant } from '../services/wiki/importer.js';

initWikiDb();
const results = {};

try {
  results.catalog = await refreshWikiCatalog();
} catch (error) {
  results.catalog_error = error.message;
}

try {
  results.terminology = await refreshWikiSnapshotFromValorant();
} catch (error) {
  results.terminology_error = error.message;
}

console.log(JSON.stringify(results, null, 2));
closeWikiDb();

if (!results.catalog && !results.terminology) process.exitCode = 1;
