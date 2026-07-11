import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

import { config } from '../../src/config.js';
import { fetchJson } from '../http/jsonClient.js';
import { importWikiEntries } from './wikiService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(__dirname, 'resources', 'valorant-catalog.json');

export async function downloadValorantCatalog(options = {}) {
  const [agentsPayload, mapsPayload, weaponsPayload, gameModesPayload, gearPayload] = await Promise.all([
    fetchJson(createApiUrl('agents', { isPlayableCharacter: true }), options),
    fetchJson(createApiUrl('maps'), options),
    fetchJson(createApiUrl('weapons'), options),
    fetchJson(createApiUrl('gamemodes'), options),
    fetchJson(createApiUrl('gear'), options)
  ]);

  const agents = arrayData(agentsPayload, 'agents');
  const maps = arrayData(mapsPayload, 'maps');
  const weapons = arrayData(weaponsPayload, 'weapons');
  const gameModes = arrayData(gameModesPayload, 'game modes');
  const gear = arrayData(gearPayload, 'gear');
  const entries = [
    ...agents.flatMap(mapAgentEntries),
    ...maps.map(mapMapEntry).filter(Boolean),
    ...weapons.map(mapWeaponEntry).filter(Boolean),
    ...gameModes.map(mapGameModeEntry).filter(Boolean),
    ...gear.map(mapGearEntry).filter(Boolean)
  ];

  const counts = countCategories(entries);
  if (counts.agent < 20 || counts.map < 10 || counts.weapon < 15 || counts.ability + counts.ultimate < 80) {
    throw new Error(`Catalog validation failed: ${JSON.stringify(counts)}`);
  }

  return { entries, counts };
}

export async function refreshWikiCatalog(options = {}) {
  const downloaded = await downloadValorantCatalog(options);
  const snapshot = {
    schema_version: 1,
    source: config.valorantApiUrl,
    retrieved_at: new Date().toISOString(),
    entry_count: downloaded.entries.length,
    category_counts: downloaded.counts,
    entries: downloaded.entries
  };
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  return {
    ...importWikiEntries(downloaded.entries),
    downloaded: downloaded.entries.length,
    category_counts: downloaded.counts,
    import_method: 'valorant_api_catalog',
    snapshot_path: snapshotPath
  };
}

function mapAgentEntries(agent) {
  if (!agent?.displayName || !agent?.isPlayableCharacter) return [];
  const abilities = (agent.abilities || []).filter((ability) => ability?.displayName && ability?.description);
  const roleName = agent.role?.displayName || 'Unknown';
  const roleDescription = clean(agent.role?.description);
  const abilityNames = abilities.map((ability) => ability.displayName).join(', ');
  const entries = [{
    term: agent.displayName,
    category: 'agent',
    explanation: joinParagraphs([
      clean(agent.description),
      `Role: ${roleName}.${roleDescription ? ` ${roleDescription}` : ''}`,
      abilityNames ? `Abilities: ${abilityNames}.` : null
    ])
  }];

  for (const ability of abilities) {
    const isUltimate = ability.slot === 'Ultimate';
    entries.push({
      term: `${agent.displayName}: ${ability.displayName}`,
      category: isUltimate ? 'ultimate' : 'ability',
      explanation: joinParagraphs([
        clean(ability.description),
        `Agent: ${agent.displayName}. Type: ${formatSlot(ability.slot)}.`
      ])
    });
  }
  return entries;
}

function mapMapEntry(map) {
  if (!map?.displayName) return null;
  const callouts = [...new Set((map.callouts || []).map((callout) => callout?.regionName).filter(Boolean))];
  return {
    term: map.displayName,
    category: 'map',
    explanation: joinParagraphs([
      clean(map.narrativeDescription || map.tacticalDescription),
      map.coordinates ? `Location: ${map.coordinates}.` : null,
      callouts.length ? `Named callout regions: ${callouts.join(', ')}.` : null
    ]) || `${map.displayName} is a playable Valorant map.`
  };
}

function mapWeaponEntry(weapon) {
  if (!weapon?.displayName) return null;
  const stats = weapon.weaponStats;
  const shop = weapon.shopData;
  const details = [];
  if (shop?.categoryText) details.push(`Class: ${shop.categoryText}`);
  if (Number.isFinite(shop?.cost)) details.push(`Cost: ${shop.cost} credits`);
  if (stats) {
    if (Number.isFinite(stats.fireRate)) details.push(`Fire rate: ${stats.fireRate} rounds/sec`);
    if (Number.isFinite(stats.magazineSize)) details.push(`Magazine: ${stats.magazineSize}`);
    if (Number.isFinite(stats.reloadTimeSeconds)) details.push(`Reload: ${stats.reloadTimeSeconds} sec`);
    if (Number.isFinite(stats.runSpeedMultiplier)) details.push(`Run speed multiplier: ${stats.runSpeedMultiplier}`);
    if (stats.wallPenetration) details.push(`Wall penetration: ${shortEnum(stats.wallPenetration)}`);
  }

  const damage = (stats?.damageRanges || []).map((range) => {
    const distance = `${range.rangeStartMeters}-${range.rangeEndMeters}m`;
    return `${distance}: head ${range.headDamage}, body ${range.bodyDamage}, legs ${range.legDamage}`;
  });

  return {
    term: weapon.displayName,
    category: 'weapon',
    explanation: joinParagraphs([
      details.length ? `${details.join('. ')}.` : `${weapon.displayName} is a Valorant weapon.`,
      damage.length ? `Damage ranges: ${damage.join('; ')}.` : null,
      stats?.altFireType && !stats.altFireType.endsWith('::None')
        ? `Alternate fire: ${shortEnum(stats.altFireType)}.`
        : null
    ])
  };
}

function mapGameModeEntry(mode) {
  if (!mode?.displayName) return null;
  const details = [];
  if (mode.duration) details.push(`Typical duration: ${mode.duration}`);
  if (Number.isFinite(mode.roundsPerHalf) && mode.roundsPerHalf > 0) details.push(`Rounds per half: ${mode.roundsPerHalf}`);
  if (Number.isFinite(mode.orbCount) && mode.orbCount > 0) details.push(`Orb types: ${mode.orbCount}`);
  return {
    term: `Game mode: ${mode.displayName}`,
    category: 'mechanic',
    explanation: details.length
      ? `${mode.displayName} is a Valorant game mode. ${details.join('. ')}.`
      : `${mode.displayName} is a Valorant game mode.`
  };
}

function mapGearEntry(gear) {
  if (!gear?.displayName) return null;
  const details = [];
  if (gear.shopData?.categoryText) details.push(`Type: ${gear.shopData.categoryText}`);
  if (Number.isFinite(gear.shopData?.cost)) details.push(`Cost: ${gear.shopData.cost} credits`);
  return {
    term: `Gear: ${gear.displayName}`,
    category: 'mechanic',
    explanation: joinParagraphs([
      clean(gear.description),
      details.length ? `${details.join('. ')}.` : null
    ]) || `${gear.displayName} is purchasable Valorant gear.`
  };
}

function createApiUrl(endpoint, params = {}) {
  const url = new URL(`${config.valorantApiUrl.replace(/\/$/, '')}/v1/${endpoint}`);
  url.searchParams.set('language', 'en-US');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}

function arrayData(payload, label) {
  if (!Array.isArray(payload?.data)) throw new Error(`Valorant ${label} response did not contain an array.`);
  return payload.data;
}

function countCategories(entries) {
  return entries.reduce((counts, entry) => {
    counts[entry.category] = (counts[entry.category] || 0) + 1;
    return counts;
  }, { agent: 0, ability: 0, ultimate: 0, map: 0, weapon: 0, mechanic: 0 });
}

function joinParagraphs(values) {
  return values.filter(Boolean).join('\n\n').trim();
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function shortEnum(value) {
  return String(value || '').split('::').at(-1).replace(/([a-z])([A-Z])/g, '$1 $2');
}

function formatSlot(slot) {
  const labels = {
    Ability1: 'basic ability',
    Ability2: 'basic ability',
    Grenade: 'basic ability',
    Passive: 'passive ability',
    Ultimate: 'ultimate ability'
  };
  return labels[slot] || slot || 'ability';
}
