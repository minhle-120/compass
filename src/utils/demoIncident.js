const scenarios = [
  {
    key: 'ps5-black-screen',
    name: 'PS5 gameplay black screen',
    platform: 'PS5',
    region: 'NA',
    classification: {
      categories: ['bug'],
      severity: 'high',
      rationale: 'PS5 gameplay video disappears at match start while audio remains available.',
      problem_summary: 'PS5 display turns black when gameplay begins',
      problem_reason: 'Match transition causes video output to disappear while audio continues'
    },
    inputs: [
      ['Screen turns black when the match starts', 'The lobby and agent selection work normally, but my screen goes completely black when the first round begins. I can still hear the game and my teammates.'],
      ['I can hear the match but cannot see anything', 'After the map finishes loading, the picture disappears. Game audio and voice chat continue working, but the display remains black until I close Valorant.'],
      ['No video after agent selection on PS5', 'Everything displays correctly until agent selection ends. When I enter the match, my television shows a black picture even though I can hear the round starting.'],
      ['PS5 display cuts out during map loading', 'The loading screen appears for a few seconds and then the screen goes dark. My controller still responds and I can hear footsteps in the match.'],
      ['Valorant match loads with sound only', 'I joined an Unrated match and could hear the announcer and other players, but the entire screen was black. Restarting the console did not help.']
    ]
  },
  {
    key: 'xbox-voice-drop',
    name: 'Xbox voice chat disconnection',
    platform: 'Xbox Series X',
    region: 'EU',
    classification: {
      categories: ['bug'],
      severity: 'medium',
      rationale: 'Xbox team voice disconnects during longer matches while other audio remains available.',
      problem_summary: 'Xbox voice chat disconnects during a match',
      problem_reason: 'Voice connection drops after approximately ten minutes of gameplay'
    },
    inputs: [
      ['Team chat dies halfway through matches', 'Everyone can hear me at first, but around ten minutes into the match voice chat stops working both ways on my Xbox.'],
      ['Voice comms disconnect after a few rounds', 'Team audio is fine before queueing, then all player voices disappear after three or four rounds.'],
      ['Cannot hear my team later in the game', 'Voice works at the beginning and suddenly goes silent during longer Competitive matches on Series X.'],
      ['Microphone stops working mid-match', 'About ten minutes into Unrated my mic icon quits lighting up and I cannot hear anyone until the next match.'],
      ['Xbox game chat will not stay connected', 'I start each match able to talk, but the voice connection drops after playing for a while and never reconnects.']
    ]
  },
  {
    key: 'payment-receipt-freeze',
    name: 'Frozen payment receipt',
    platform: 'PC',
    region: 'APAC',
    classification: {
      categories: ['payment'],
      severity: 'low',
      rationale: 'The receipt overlay blocks the store after a successful transaction.',
      problem_summary: 'Store receipt screen freezes after payment confirmation',
      problem_reason: 'Returning from the payment provider leaves the receipt overlay unresponsive'
    },
    inputs: [
      ['Purchase completed but receipt is frozen', 'I paid for points and the confirmation appeared, but the receipt popup is stuck and none of its buttons respond.'],
      ['Store locks up after payment confirmation', 'The card payment succeeded, then returning to the game left me on a frozen receipt screen that I cannot close.'],
      ['Cannot dismiss the purchase receipt', 'After buying currency the receipt overlay stopped responding. The rest of the client is blocked behind it.'],
      ['Payment went through and client got stuck', 'My bank approved the charge, but the game froze on the confirmation window when the payment page returned.'],
      ['Receipt page unresponsive after buying points', 'The transaction says successful. Now the receipt screen ignores clicks and I have to force close the client.']
    ]
  },
  {
    key: 'vanguard-restart-loop',
    name: 'Vanguard restart loop',
    platform: 'PC',
    region: 'NA',
    classification: {
      categories: ['bug'],
      severity: 'medium',
      rationale: 'Vanguard repeatedly requests a reboot and prevents players from launching Valorant.',
      problem_summary: 'Vanguard requests a restart after every reboot',
      problem_reason: 'Vanguard service fails to initialize when Windows starts'
    },
    inputs: [
      ['Vanguard keeps asking me to restart', 'I have rebooted my PC three times, but Valorant still says Vanguard requires a system restart before I can play.'],
      ['Restart required message will not go away', 'Every launch shows the same Vanguard restart warning even though Windows has just finished rebooting.'],
      ['Stuck in a Vanguard reboot loop', 'The client tells me to restart, then gives the identical message after the computer comes back on.'],
      ['Valorant will not open after multiple restarts', 'I followed the Vanguard prompt four times today and still cannot get past the required restart screen.'],
      ['Vanguard never starts with Windows', 'After rebooting, the tray icon is missing and Valorant immediately asks for another restart.']
    ]
  }
];

export const demoIncidentScenarios = Object.freeze(scenarios.map((scenario) => Object.freeze({
  ...scenario,
  classification: Object.freeze({ ...scenario.classification, categories: Object.freeze([...scenario.classification.categories]) }),
  inputs: Object.freeze(scenario.inputs.map(([subject, description]) => Object.freeze({ subject, description })))
})));

// Keep the original exports available for callers that want the first scenario.
export const demoIncidentClassification = demoIncidentScenarios[0].classification;
export const demoIncidentInputs = demoIncidentScenarios[0].inputs;

export function getDemoIncidentScenario(batchNumber = 0) {
  const normalized = Number.isInteger(batchNumber) && batchNumber >= 0 ? batchNumber : 0;
  return demoIncidentScenarios[normalized % demoIncidentScenarios.length];
}

export function buildDemoIncidentTickets({
  createdAt = new Date().toISOString(),
  batchId = `${Date.now().toString(36)}-${Math.floor(1000 + Math.random() * 9000)}`,
  scenario = demoIncidentScenarios[0]
} = {}) {
  return scenario.inputs.map((input, index) => ({
    id: `T-DEMO-${batchId}-${index + 1}`.toUpperCase(),
    ...input,
    status: 'running',
    created_at: createdAt,
    updated_at: createdAt,
    platform: scenario.platform,
    region: scenario.region,
    locale: 'en-US'
  }));
}
