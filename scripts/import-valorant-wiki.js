import { closeWikiDb, initWikiDb } from '../services/wiki/wikiService.js';
import { refreshWikiSnapshotFromValorant } from '../services/wiki/importer.js';

try {
  initWikiDb();
  const result = await refreshWikiSnapshotFromValorant();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`Valorant Wiki import failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  closeWikiDb();
}
