import { describe, expect, it } from 'vitest';

import { downloadValorantCatalog } from '../catalogImporter.js';

describe('Valorant catalog importer', () => {
  it('normalizes agents, abilities, ultimates, maps, and weapons into text entries', async () => {
    const result = await downloadValorantCatalog({ fetchImpl: mockCatalogFetch });

    expect(result.counts).toEqual({ agent: 20, ability: 60, ultimate: 20, map: 10, weapon: 15, mechanic: 7 });
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: 'Agent 0', category: 'agent' }),
      expect.objectContaining({ term: 'Agent 0: Ultimate 0', category: 'ultimate' }),
      expect.objectContaining({ term: 'Map 0', category: 'map' }),
      expect.objectContaining({ term: 'Weapon 0', category: 'weapon' })
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
    data = Array.from({ length: 10 }, (_, index) => ({ displayName: `Map ${index}`, tacticalDescription: 'Two sites.' }));
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
      }
    }));
  } else if (url.pathname.endsWith('/gamemodes')) {
    data = Array.from({ length: 5 }, (_, index) => ({ displayName: `Mode ${index}`, duration: '30-40 minutes', roundsPerHalf: 12 }));
  } else {
    data = Array.from({ length: 2 }, (_, index) => ({
      displayName: `Shield ${index}`,
      description: 'Absorbs incoming damage.',
      shopData: { categoryText: 'Armor', cost: 400 }
    }));
  }

  return { ok: true, status: 200, json: async () => ({ data }) };
}
