import { config } from '../../src/config.js';
import { logger } from '../../src/utils/logger.js';
import { refreshWikiFromValorant } from './importer.js';
import { importBundledWikiSnapshot } from './wikiService.js';
import { refreshWikiCatalog } from './catalogImporter.js';

let refreshTimer;

export function startWikiSync() {
  if (refreshTimer) return refreshTimer;

  const snapshot = importBundledWikiSnapshot();
  logger.info(
    `Local snapshot ready: ${snapshot.imported} terms, ${snapshot.updated} updated`,
    'Wiki'
  );
  refreshTimer = setInterval(runRefresh, config.wikiSyncIntervalMs);
  refreshTimer.unref?.();
  logger.info(`Local wiki refresh scheduled every ${config.wikiSyncIntervalMs}ms`, 'Wiki');
  return refreshTimer;
}

export function stopWikiSync() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = undefined;
}

async function runRefresh() {
  const [catalog, terminology] = await Promise.allSettled([
    refreshWikiCatalog(),
    refreshWikiFromValorant()
  ]);

  if (catalog.status === 'fulfilled') {
    const result = catalog.value;
    logger.info(
      `Catalog refresh complete: ${result.added} added, ${result.updated} updated`,
      'Wiki'
    );
  } else {
    logger.warn(`Catalog refresh skipped; the local snapshot remains available. ${catalog.reason.message}`, 'Wiki');
  }

  if (terminology.status === 'fulfilled') {
    const result = terminology.value;
    logger.info(`Terminology refresh complete: ${result.added} added, ${result.updated} updated`, 'Wiki');
  } else {
    logger.warn(`Terminology refresh skipped; the local snapshot remains available. ${terminology.reason.message}`, 'Wiki');
  }
}
