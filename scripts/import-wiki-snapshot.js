import {
  closeWikiDb,
  importBundledWikiSnapshot,
  initWikiDb
} from '../services/wiki/wikiService.js';

try {
  initWikiDb();
  console.log(JSON.stringify(importBundledWikiSnapshot(), null, 2));
} catch (error) {
  console.error(`Local wiki snapshot import failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  closeWikiDb();
}
