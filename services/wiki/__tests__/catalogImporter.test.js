import { describe, expect, it } from 'vitest';

import { downloadValorantCatalog } from '../catalogImporter.js';

describe('Valorant catalog importer', () => {
  it('normalizes gameplay, cosmetic, and progression API data into text entries', async () => {
    const result = await downloadValorantCatalog({ fetchImpl: mockCatalogFetch });

    expect(result.counts).toEqual({ agent: 20, ability: 60, ultimate: 20, map: 10, weapon: 15, cosmetic: 33, mechanic: 18 });
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: 'Agent 0', category: 'agent' }),
      expect.objectContaining({ term: 'Agent 0: Ultimate 0', category: 'ultimate' }),
      expect.objectContaining({ term: 'Map 0', category: 'map' }),
      expect.objectContaining({ term: 'Weapon 0', category: 'weapon' }),
      expect.objectContaining({ term: 'Skin: Weapon 0 Skin', category: 'cosmetic' }),
      expect.objectContaining({ term: 'Gun buddy: Buddy 0', category: 'cosmetic' }),
      expect.objectContaining({ term: 'Competitive tier: Silver 1', category: 'mechanic' })
    ]));
  });
});

async function mockCatalogFetch(input) {
  const url = new URL(String(input));
  let data;

  if (url.pathname.endsWith('/agents')) {
    data = Array.from({ length: 20 }, (_, index) => ({
      displayName: `Agent ${index}`,
      description: `Agent description ${index}`,
      isPlayableCharacter: true,
      role: { displayName: 'Duelist', description: 'Creates space.' },
      abilities: [
        { slot: 'Ability1', displayName: `Ability A${index}`, description: 'First ability.' },
        { slot: 'Ability2', displayName: `Ability B${index}`, description: 'Second ability.' },
        { slot: 'Grenade', displayName: `Ability C${index}`, description: 'Third ability.' },
        { slot: 'Ultimate', displayName: `Ultimate ${index}`, description: 'Ultimate ability.' }
      ]
    }));
  } else if (url.pathname.endsWith('/maps')) {
    data = Array.from({ length: 11 }, (_, index) => ({
      displayName: `Map ${index === 10 ? 0 : index}`,
      tacticalDescription: 'Two sites.'
    }));
  } else if (url.pathname.endsWith('/weapons')) {
    data = Array.from({ length: 15 }, (_, index) => ({
      displayName: `Weapon ${index}`,
      shopData: { categoryText: 'Rifle', cost: 2900 },
      weaponStats: {
        fireRate: 10,
        magazineSize: 25,
        reloadTimeSeconds: 2.5,
        wallPenetration: 'EWallPenetrationDisplayType::Medium',
        damageRanges: [{ rangeStartMeters: 0, rangeEndMeters: 50, headDamage: 160, bodyDamage: 40, legDamage: 34 }]
      },
      skins: [{
        displayName: `Weapon ${index} Skin`,
        contentTierUuid: 'tier-deluxe',
        themeUuid: 'theme-ion',
        chromas: [{ displayName: `Weapon ${index} Skin Chroma` }],
        levels: [{ displayName: `Weapon ${index} Skin Level 1` }]
      }]
    }));
  } else if (url.pathname.endsWith('/gamemodes')) {
    data = Array.from({ length: 5 }, (_, index) => ({ displayName: `Mode ${index}`, duration: '30-40 minutes', roundsPerHalf: 12 }));
  } else if (url.pathname.endsWith('/gear')) {
    data = Array.from({ length: 2 }, (_, index) => ({
      displayName: `Shield ${index}`,
      description: 'Absorbs incoming damage.',
      shopData: { categoryText: 'Armor', cost: 400 }
    }));
  } else if (url.pathname.endsWith('/buddies')) {
    data = Array.from({ length: 2 }, (_, index) => ({ displayName: `Buddy ${index}` }));
  } else if (url.pathname.endsWith('/bundles')) {
    data = Array.from({ length: 2 }, (_, index) => ({ displayName: `Bundle ${index}`, extraDescription: 'Limited collection.' }));
  } else if (url.pathname.endsWith('/playercards')) {
    data = Array.from({ length: 2 }, (_, index) => ({ displayName: `Card ${index}` }));
  } else if (url.pathname.endsWith('/playertitles')) {
    data = Array.from({ length: 2 }, (_, index) => ({ displayName: `Title ${index}` }));
  } else if (url.pathname.endsWith('/sprays')) {
    data = Array.from({ length: 2 }, (_, index) => ({ displayName: `Spray ${index}` }));
  } else if (url.pathname.endsWith('/currencies')) {
    data = Array.from({ length: 2 }, (_, index) => ({ displayName: `Currency ${index}` }));
  } else if (url.pathname.endsWith('/contenttiers')) {
    data = [
      { uuid: 'tier-deluxe', displayName: 'Deluxe Edition' },
      { uuid: 'tier-premium', displayName: 'Premium Edition' }
    ];
  } else if (url.pathname.endsWith('/themes')) {
    data = [
      { uuid: 'theme-ion', displayName: 'Ion' },
      { uuid: 'theme-prime', displayName: 'Prime' }
    ];
  } else if (url.pathname.endsWith('/levelborders')) {
    data = Array.from({ length: 2 }, (_, index) => ({ displayName: `Level Border ${index}` }));
  } else if (url.pathname.endsWith('/ceremonies')) {
    data = Array.from({ length: 2 }, (_, index) => ({ displayName: `Ceremony ${index}` }));
  } else if (url.pathname.endsWith('/contracts')) {
    data = Array.from({ length: 2 }, (_, index) => ({ displayName: `Contract ${index}` }));
  } else if (url.pathname.endsWith('/events')) {
    data = Array.from({ length: 2 }, (_, index) => ({ displayName: `Event ${index}`, startTime: '2026-01-01T00:00:00Z', endTime: '2026-02-01T00:00:00Z' }));
  } else if (url.pathname.endsWith('/seasons')) {
    data = Array.from({ length: 2 }, (_, index) => ({ displayName: `Season ${index}`, type: 'EAresSeasonType::Act', startTime: '2026-01-01T00:00:00Z' }));
  } else if (url.pathname.endsWith('/competitivetiers')) {
    data = Array.from({ length: 1 }, () => ({
      tiers: [
        { tierName: 'Unused', tier: 0 },
        { tierName: 'Silver 1', tier: 6 },
        { tierName: 'Silver 2', tier: 7 },
        { tierName: 'Silver 3', tier: 8 }
      ]
    }));
  } else {
    data = [];
  }

  return { ok: true, status: 200, json: async () => ({ data }) };
}
