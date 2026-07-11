import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

import { config } from '../../src/config.js';
import { fetchJson } from '../http/jsonClient.js';
import { importWikiEntries } from './wikiService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(__dirname, 'resources', 'valorant-catalog.json');

export async function downloadValorantCatalog(options = {}) {
  const [
    agentsPayload,
    mapsPayload,
    weaponsPayload,
    gameModesPayload,
    gearPayload,
    buddiesPayload,
    bundlesPayload,
    playerCardsPayload,
    playerTitlesPayload,
    spraysPayload,
    currenciesPayload,
    contentTiersPayload,
    themesPayload,
    levelBordersPayload,
    ceremoniesPayload,
    contractsPayload,
    eventsPayload,
    seasonsPayload,
    competitiveTiersPayload
  ] = await Promise.all([
    fetchJson(createApiUrl('agents', { isPlayableCharacter: true }), options),
    fetchJson(createApiUrl('maps'), options),
    fetchJson(createApiUrl('weapons'), options),
    fetchJson(createApiUrl('gamemodes'), options),
    fetchJson(createApiUrl('gear'), options),
    fetchJson(createApiUrl('buddies'), options),
    fetchJson(createApiUrl('bundles'), options),
    fetchJson(createApiUrl('playercards'), options),
    fetchJson(createApiUrl('playertitles'), options),
    fetchJson(createApiUrl('sprays'), options),
    fetchJson(createApiUrl('currencies'), options),
    fetchJson(createApiUrl('contenttiers'), options),
    fetchJson(createApiUrl('themes'), options),
    fetchJson(createApiUrl('levelborders'), options),
    fetchJson(createApiUrl('ceremonies'), options),
    fetchJson(createApiUrl('contracts'), options),
    fetchJson(createApiUrl('events'), options),
    fetchJson(createApiUrl('seasons'), options),
    fetchJson(createApiUrl('competitivetiers'), options)
  ]);

  const agents = arrayData(agentsPayload, 'agents');
  const maps = arrayData(mapsPayload, 'maps');
  const weapons = arrayData(weaponsPayload, 'weapons');
  const gameModes = arrayData(gameModesPayload, 'game modes');
  const gear = arrayData(gearPayload, 'gear');
  const buddies = arrayData(buddiesPayload, 'buddies');
  const bundles = arrayData(bundlesPayload, 'bundles');
  const playerCards = arrayData(playerCardsPayload, 'player cards');
  const playerTitles = arrayData(playerTitlesPayload, 'player titles');
  const sprays = arrayData(spraysPayload, 'sprays');
  const currencies = arrayData(currenciesPayload, 'currencies');
  const contentTiers = arrayData(contentTiersPayload, 'content tiers');
  const themes = arrayData(themesPayload, 'themes');
  const levelBorders = arrayData(levelBordersPayload, 'level borders');
  const ceremonies = arrayData(ceremoniesPayload, 'ceremonies');
  const contracts = arrayData(contractsPayload, 'contracts');
  const events = arrayData(eventsPayload, 'events');
  const seasons = arrayData(seasonsPayload, 'seasons');
  const competitiveTiers = arrayData(competitiveTiersPayload, 'competitive tiers');
  const context = createCatalogContext({ contentTiers, themes });
  const entries = deduplicateEntries([
    ...agents.flatMap(mapAgentEntries),
    ...maps.map(mapMapEntry).filter(Boolean),
    ...weapons.map(mapWeaponEntry).filter(Boolean),
    ...weapons.flatMap((weapon) => mapWeaponSkinEntries(weapon, context)),
    ...gameModes.map(mapGameModeEntry).filter(Boolean),
    ...gear.map(mapGearEntry).filter(Boolean),
    ...buddies.map((item) => mapSimpleCosmeticEntry(item, 'Gun buddy')).filter(Boolean),
    ...bundles.map((item) => mapBundleEntry(item)).filter(Boolean),
    ...playerCards.map((item) => mapSimpleCosmeticEntry(item, 'Player card')).filter(Boolean),
    ...playerTitles.map((item) => mapSimpleCosmeticEntry(item, 'Player title')).filter(Boolean),
    ...sprays.map((item) => mapSimpleCosmeticEntry(item, 'Spray')).filter(Boolean),
    ...currencies.map((item) => mapSimpleMechanicEntry(item, 'Currency')).filter(Boolean),
    ...contentTiers.map((item) => mapSimpleCosmeticEntry(item, 'Content tier')).filter(Boolean),
    ...themes.map((item) => mapSimpleCosmeticEntry(item, 'Theme')).filter(Boolean),
    ...levelBorders.map((item) => mapSimpleCosmeticEntry(item, 'Level border')).filter(Boolean),
    ...ceremonies.map((item) => mapSimpleCosmeticEntry(item, 'Ceremony')).filter(Boolean),
    ...contracts.map((item) => mapSimpleMechanicEntry(item, 'Contract')).filter(Boolean),
    ...events.map((item) => mapEventEntry(item)).filter(Boolean),
    ...seasons.map((item) => mapSeasonEntry(item)).filter(Boolean),
    ...competitiveTiers.flatMap(mapCompetitiveTierEntries)
  ]);

  const counts = countCategories(entries);
  if (counts.agent < 20 || counts.map < 10 || counts.weapon < 15 || counts.ability + counts.ultimate < 80 || counts.cosmetic < 10) {
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

function mapWeaponSkinEntries(weapon, context) {
  const weaponName = weapon?.displayName;
  if (!weaponName || !Array.isArray(weapon.skins)) return [];

  return weapon.skins.map((skin) => mapWeaponSkinEntry(skin, weaponName, context)).filter(Boolean);
}

function mapWeaponSkinEntry(skin, weaponName, context) {
  if (!skin?.displayName) return null;
  const chromas = (skin.chromas || []).map((chroma) => chroma?.displayName).filter(Boolean);
  const levels = (skin.levels || []).map((level) => level?.displayName).filter(Boolean);
  const details = [
    `Weapon: ${weaponName}`,
    context.contentTiersByUuid.get(skin.contentTierUuid) ? `Edition: ${context.contentTiersByUuid.get(skin.contentTierUuid)}` : null,
    context.themesByUuid.get(skin.themeUuid) ? `Theme: ${context.themesByUuid.get(skin.themeUuid)}` : null,
    chromas.length ? `Variants/chromas: ${summarizeList(chromas, 12)}` : null,
    levels.length ? `Upgrade levels: ${summarizeList(levels, 8)}` : null
  ].filter(Boolean);

  return {
    term: `Skin: ${skin.displayName}`,
    category: 'cosmetic',
    explanation: `${skin.displayName} is a Valorant weapon skin. ${details.join('. ')}.`
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

function mapSimpleCosmeticEntry(item, type) {
  if (!item?.displayName) return null;
  return {
    term: `${type}: ${item.displayName}`,
    category: 'cosmetic',
    explanation: joinParagraphs([
      clean(item.description),
      `${item.displayName} is a Valorant ${type.toLowerCase()} cosmetic.`
    ])
  };
}

function mapBundleEntry(bundle) {
  if (!bundle?.displayName) return null;
  const details = [];
  if (bundle.displayNameSubText) details.push(clean(bundle.displayNameSubText));
  if (bundle.extraDescription) details.push(clean(bundle.extraDescription));
  return {
    term: `Bundle: ${bundle.displayName}`,
    category: 'cosmetic',
    explanation: joinParagraphs([
      `${bundle.displayName} is a Valorant cosmetic bundle.`,
      details.length ? details.join(' ') : null
    ])
  };
}

function mapSimpleMechanicEntry(item, type) {
  if (!item?.displayName) return null;
  return {
    term: `${type}: ${item.displayName}`,
    category: 'mechanic',
    explanation: joinParagraphs([
      clean(item.description),
      `${item.displayName} is a Valorant ${type.toLowerCase()}.`
    ])
  };
}

function mapEventEntry(event) {
  if (!event?.displayName) return null;
  return {
    term: `Event: ${event.displayName}`,
    category: 'mechanic',
    explanation: joinParagraphs([
      `${event.displayName} is a Valorant event.`,
      formatDateRange(event.startTime, event.endTime)
    ])
  };
}

function mapSeasonEntry(season) {
  if (!season?.displayName) return null;
  const type = season.type ? shortEnum(season.type).toLowerCase() : 'season';
  return {
    term: `Season: ${season.displayName}`,
    category: 'mechanic',
    explanation: joinParagraphs([
      `${season.displayName} is a Valorant ${type}.`,
      formatDateRange(season.startTime, season.endTime)
    ])
  };
}

function mapCompetitiveTierEntries(group) {
  const tiers = Array.isArray(group?.tiers) ? group.tiers : [];
  return tiers
    .filter((tier) => tier?.tierName && tier.tierName !== 'Unused')
    .map((tier) => ({
      term: `Competitive tier: ${tier.tierName}`,
      category: 'mechanic',
      explanation: `${tier.tierName} is a Valorant competitive rank tier. Tier number: ${tier.tier}.`
    }));
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
  }, { agent: 0, ability: 0, ultimate: 0, map: 0, weapon: 0, cosmetic: 0, mechanic: 0 });
}

function createCatalogContext({ contentTiers = [], themes = [] } = {}) {
  return {
    contentTiersByUuid: new Map(contentTiers.map((item) => [item.uuid, item.displayName]).filter(([uuid, name]) => uuid && name)),
    themesByUuid: new Map(themes.map((item) => [item.uuid, item.displayName]).filter(([uuid, name]) => uuid && name))
  };
}

function deduplicateEntries(entries) {
  const unique = new Map();
  for (const entry of entries) {
    const key = String(entry.term || '').trim().toLowerCase();
    const existing = unique.get(key);
    if (!existing || entry.explanation.length > existing.explanation.length) unique.set(key, entry);
  }
  return [...unique.values()];
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

function summarizeList(values, limit) {
  const unique = [...new Set(values.map(clean).filter(Boolean))];
  if (unique.length <= limit) return unique.join(', ');
  return `${unique.slice(0, limit).join(', ')}, and ${unique.length - limit} more`;
}

function formatDateRange(start, end) {
  const startText = formatDate(start);
  const endText = formatDate(end);
  if (startText && endText) return `Runs from ${startText} to ${endText}.`;
  if (startText) return `Starts ${startText}.`;
  if (endText) return `Ends ${endText}.`;
  return null;
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
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
