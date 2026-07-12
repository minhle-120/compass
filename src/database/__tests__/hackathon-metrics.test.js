import { beforeEach, describe, expect, it } from 'vitest';

process.env.DB_PATH = ':memory:';
process.env.INCIDENT_DB_PATH = ':memory:';

const {
  finalizeTicket,
  getDb,
  initDb,
  insertTicket,
  updateTicketStatus
} = await import('../sqlite.js');
const { getIncidentDb } = await import('../../../services/incident/db.js');
const { handler: classifyTicket } = await import('../../tools/classify_ticket.js');

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function calculateSupportMetrics(rows) {
  const resolved = rows.filter((ticket) =>
    ticket.status === 'completed' && ticket.resolution_type === 'resolved'
  ).length;
  const escalated = rows.filter((ticket) =>
    ticket.status === 'escalated' && ticket.resolution_type === 'escalated'
  ).length;
  const handlingSeconds = rows.map((ticket) =>
    (new Date(ticket.updated_at).getTime() - new Date(ticket.created_at).getTime()) / 1000
  );
  return {
    total_tickets: rows.length,
    resolved_tickets: resolved,
    escalated_tickets: escalated,
    deflection_rate: resolved / rows.length,
    median_handling_seconds: median(handlingSeconds)
  };
}

const ps5BlackScreenInputs = [
  ['Screen goes dark when the round loads', 'On PS5 I can hear my teammates and the match audio, but the picture turns completely black as soon as agent select ends.'],
  ['Black picture after loading into ranked', 'Ranked loads normally until gameplay starts, then my television says there is no picture while game sound keeps playing.'],
  ['PS5 video disappears but audio stays', 'Every time the countdown finishes my screen blanks out. I can still hear footsteps and party chat in the background.'],
  ['Can hear the match but cannot see it', 'The menus look fine on PlayStation 5. Once I spawn into a match the display becomes black and only the audio works.'],
  ['Display cuts out at match start', 'Since this morning my PS5 loses video right when a game begins. Restarting the console did not fix it.'],
  ['Blank screen entering Swiftplay', 'I queued Swiftplay twice and both times the screen went dark after the loading page, although all sounds continued.'],
  ['Picture lost after agent selection', 'After locking my agent on PS5, the next screen is solid black. The controller still responds and I hear the game.'],
  ['No gameplay video on PlayStation', 'Home screen and lobby are visible, but the image vanishes when the first round is about to start. Audio is unaffected.'],
  ['TV turns black only inside matches', 'My TV works in the game menu, then shows a black image during gameplay on PS5. I can hear that the round is running.'],
  ['Match audio with a completely dark screen', 'Loaded into Unrated on my PS5 and got sound with no visuals. Leaving and rejoining caused the same thing.'],
  ['Video output drops after map loading', 'The map loading art appears, but the screen goes black immediately afterward while voice chat remains active.'],
  ['Unable to see after spawning on PS5', 'When my character spawns there is no picture at all. I still hear the announcer and can open menus by sound.'],
  ['Gameplay starts with black display', 'This happens in every queue today: agent select works, then gameplay begins and my PS5 screen is black.'],
  ['Visuals vanish when the first round begins', 'I get through the lobby and loading screen, but lose the image at the round countdown. Sound continues normally.'],
  ['Black screen after joining a game', 'Joining friends on PlayStation puts me into a dark screen once the match starts, though I can still hear them talking.']
];

const xboxVoiceInputs = [
  ['Team chat dies halfway through matches', 'On Xbox Series X everyone can hear me at first, but around ten minutes into the match voice chat stops both ways.'],
  ['Voice comms disconnect after a few rounds', 'Party audio is fine before queueing. In team chat, all player voices disappear after three or four rounds.'],
  ['Cannot hear team later in the game', 'My Xbox voice chat works at the beginning and then suddenly goes silent during longer Competitive games.'],
  ['Microphone stops working mid-match', 'About ten minutes into Unrated my mic icon quits lighting up and I cannot hear anyone until the next match.'],
  ['Game chat cuts out during Competitive', 'Comms connect in agent select but drop later in the match on Series X. Reconnecting my headset does nothing.'],
  ['Xbox team voice randomly goes silent', 'Voice works for the opening rounds, then incoming and outgoing team chat both stop without an error.'],
  ['Lost all comms after round five', 'In two matches today I lost team voice around round five. The headset still works in the Xbox dashboard.'],
  ['In-game chat will not stay connected', 'I start matches able to talk, but the voice connection drops after playing for a while and never reconnects.'],
  ['Teammates disappear from voice channel', 'The team voice indicators vanish roughly ten minutes after loading into a match on Xbox Series X.'],
  ['Voice chat only works early in a match', 'During the first few rounds comms are normal. Later nobody can hear each other even though text chat works.'],
  ['Series X comms fail in long games', 'Short modes are okay, but in a full Competitive match voice audio cuts off after several rounds.'],
  ['Team voice disconnects without warning', 'There is no message or network icon; all comms simply stop midway through gameplay on my Xbox.'],
  ['Headset works but game chat drops', 'My headset continues playing game sound, yet player voices and my microphone stop after about ten minutes.'],
  ['Mid-game voice channel failure', 'I joined team chat successfully, then it disconnected during the second half and would not let me speak again.'],
  ['Comms vanish during longer Xbox sessions', 'Whenever a match lasts more than a few rounds, team voice goes silent until I return to the lobby.']
];

const paymentFreezeInputs = [
  ['Purchase completed but receipt is frozen', 'I paid for points on PC and the confirmation appeared, but the receipt popup is stuck and none of its buttons respond.'],
  ['Store locks up after payment confirmation', 'The card payment succeeded, then returning to the game left me on a frozen receipt screen that I cannot close.'],
  ['Cannot dismiss the purchase receipt', 'After buying currency the receipt overlay stopped responding. The rest of the client is blocked behind it.'],
  ['Payment went through and client got stuck', 'My bank approved the charge, but the game froze on the confirmation window when the payment page returned.'],
  ['Receipt page unresponsive after buying points', 'The transaction says successful. Now the receipt screen ignores clicks and I have to force close the client.'],
  ['Store confirmation overlay will not close', 'I finished a PayPal payment and came back to a receipt popup that is completely unresponsive.'],
  ['Frozen screen after successful checkout', 'Checkout completed normally, but the post-payment receipt is stuck over the store and Escape does not work.'],
  ['Client hangs on transaction receipt', 'Right after confirming my points purchase, the receipt displayed and the entire overlay became unclickable.'],
  ['Successful charge followed by frozen popup', 'I received the payment email, although the in-game confirmation window is frozen and blocks navigation.'],
  ['Stuck at the receipt after purchasing currency', 'The external payment page sent me back, then the client stopped responding on the purchase receipt.'],
  ['Buying points leaves store unusable', 'Once payment was accepted the receipt overlay remained on screen. Close and continue buttons do nothing.'],
  ['Confirmation window freezes after checkout', 'My currency order succeeded, but I cannot get past the final receipt page without restarting the game.'],
  ['Receipt overlay blocks the whole client', 'Following a completed card purchase, the displayed receipt is unresponsive and covers every other store control.'],
  ['Store stuck after returning from payment page', 'I was redirected back after paying and landed on a frozen confirmation receipt with no working buttons.'],
  ['Post-purchase receipt does not respond', 'The points transaction finished, but the final receipt popup will not close or react to the mouse.']
];

const isolatedInputs = [
  {
    subject: 'Friend request notification stays unread',
    description: 'I opened the new friend request on PC, but the red notification badge remains after restarting.',
    platform: 'PC', region: 'EU', category: 'other', severity: 'low',
    summary: 'Friend request badge remains after viewing request',
    reason: 'Notification count does not refresh after the social panel is opened'
  },
  {
    subject: 'Weekly mission progress is one game behind',
    description: 'My ability-use mission only updates after I finish another match. The previous game is counted late.',
    platform: 'PC', region: 'NA', category: 'bug', severity: 'low',
    summary: 'Weekly mission progress updates one match late',
    reason: 'Mission counters refresh only after the following match completes'
  },
  {
    subject: 'Cannot preview one specific weapon skin',
    description: 'The preview button works for every bundle item except the new rifle skin, which shows a blank panel.',
    platform: 'PC', region: 'APAC', category: 'bug', severity: 'low',
    summary: 'One rifle skin opens a blank preview panel',
    reason: 'The store preview asset for the selected rifle skin does not load'
  },
  {
    subject: 'Career page shows the wrong match score',
    description: 'Yesterday\'s match ended 13-9, but my career history displays it as 12-9 even after relaunching.',
    platform: 'PS5', region: 'OCE', category: 'bug', severity: 'low',
    summary: 'Career history displays an incorrect final score',
    reason: 'The completed match record omits the final winning round'
  },
  {
    subject: 'Would like a separate volume slider for pings',
    description: 'Team pings are much louder than other effects for me. Please add a dedicated ping volume option.',
    platform: 'Xbox Series X', region: 'NA', category: 'feature_request', severity: 'low',
    summary: 'Player requests a separate ping volume control',
    reason: 'Current effects volume combines team pings with unrelated game audio'
  }
];

const clusterDefinitions = [
  {
    inputs: ps5BlackScreenInputs,
    platform: 'PS5',
    region: 'NA',
    category: 'bug',
    severity: 'high',
    rationale: 'Gameplay video output disappears on PS5 while audio remains available.',
    summary: 'PS5 display turns black when gameplay begins',
    reason: 'Match transition causes video output to disappear while audio continues',
  },
  {
    inputs: xboxVoiceInputs,
    platform: 'Xbox Series X',
    region: 'EU',
    category: 'bug',
    severity: 'medium',
    rationale: 'Xbox team voice disconnects during longer matches.',
    summary: 'Xbox voice chat disconnects during a match',
    reason: 'Voice connection drops after approximately ten minutes of gameplay',
  },
  {
    inputs: paymentFreezeInputs,
    platform: 'PC',
    region: 'APAC',
    category: 'payment',
    severity: 'low',
    rationale: 'The store becomes unusable after a successful transaction.',
    summary: 'Store receipt screen freezes after payment confirmation',
    reason: 'Returning from the payment provider leaves the receipt overlay unresponsive',
  }
];

function realisticTickets() {
  const clustered = clusterDefinitions.flatMap((cluster) =>
    cluster.inputs.map(([subject, description], index) => ({
      subject,
      description,
      platform: cluster.platform,
      region: cluster.region,
      classification: {
        categories: [cluster.category],
        severity: cluster.severity,
        rationale: cluster.rationale,
        problem_summary: cluster.summary,
        problem_reason: cluster.reason
      }
    }))
  );
  const isolated = isolatedInputs.map((ticket) => ({
    ...ticket,
    classification: {
      categories: [ticket.category],
      severity: ticket.severity,
      rationale: `Isolated player report: ${ticket.summary}.`,
      problem_summary: ticket.summary,
      problem_reason: ticket.reason
    }
  }));
  return [...clustered, ...isolated];
}

describe('50-ticket realistic hackathon metrics simulation', () => {
  beforeEach(() => {
    const db = initDb();
    db.prepare('DELETE FROM problem_tickets').run();
    db.prepare('DELETE FROM problems').run();
    db.prepare('DELETE FROM tickets').run();
    getIncidentDb().prepare('DELETE FROM incidents').run();
  });

  it('resolves or escalates every unique player report while discovering three incidents', async () => {
    const tickets = realisticTickets();

    expect(tickets).toHaveLength(50);
    expect(new Set(tickets.map((ticket) => ticket.subject)).size).toBe(50);
    expect(new Set(tickets.map((ticket) => ticket.description)).size).toBe(50);

    // Keep tickets open while classifications normalize differently worded player
    // reports into repeated problems and evaluate incident thresholds.
    for (let index = 0; index < tickets.length; index += 1) {
      const ticket = tickets[index];
      const id = `T-SIM-${String(index + 1).padStart(3, '0')}`;
      insertTicket({
        id,
        subject: ticket.subject,
        description: ticket.description,
        status: 'pending',
        created_at: new Date().toISOString(),
        platform: ticket.platform,
        region: ticket.region
      });
      await classifyTicket(ticket.classification, { ticketId: id });
    }

    const generatedIncidents = getIncidentDb().prepare(`
      SELECT id, title, severity FROM incidents
      WHERE id LIKE 'INC-AUTO-%'
      ORDER BY id
    `).all();
    expect(generatedIncidents).toHaveLength(3);

    for (let index = 0; index < tickets.length; index += 1) {
      const id = `T-SIM-${String(index + 1).padStart(3, '0')}`;
      const linkedProblem = getDb().prepare(`
        SELECT p.incident_id
        FROM problem_tickets pt
        JOIN problems p ON p.id = pt.problem_id
        WHERE pt.ticket_id = ?
      `).get(id);
      updateTicketStatus(id, 'running');
      if (linkedProblem?.incident_id) {
        finalizeTicket(id, 'escalated', 'escalated', 'Escalated for incident investigation');
      } else {
        finalizeTicket(id, 'completed', 'resolved', 'Resolved with automated guidance');
      }
    }

    const rows = getDb().prepare(`
      SELECT status, resolution_type, created_at, updated_at
      FROM tickets ORDER BY id
    `).all();
    const metrics = calculateSupportMetrics(rows);

    expect(rows.every((ticket) => ['resolved', 'escalated'].includes(ticket.resolution_type))).toBe(true);
    expect(metrics.total_tickets).toBe(50);
    expect(metrics.resolved_tickets + metrics.escalated_tickets).toBe(50);
    expect(metrics.deflection_rate).toBe(metrics.resolved_tickets / metrics.total_tickets);
    expect(metrics.median_handling_seconds).toBeGreaterThanOrEqual(0);

    console.info([
      '',
      '=== Hackathon Simulation Results ===',
      `Tickets processed: ${metrics.total_tickets}`,
      `Resolved: ${metrics.resolved_tickets}`,
      `Escalated: ${metrics.escalated_tickets}`,
      `Deflection rate: ${(metrics.deflection_rate * 100).toFixed(2)}%`,
      `Median handling time: ${metrics.median_handling_seconds.toFixed(3)} seconds`,
      `Generated incidents: ${generatedIncidents.length}`,
      '======================================'
    ].join('\n'));
  });
});
