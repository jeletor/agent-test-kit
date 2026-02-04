'use strict';

const { createMockRelay } = require('./relay.cjs');
const { createMockWallet } = require('./wallet.cjs');
const {
  generateKeypair, textNote, dm, dvmRequest, dvmResult,
  zapReceipt, trustAttestation, marketplaceTask, marketplaceBid,
  marketplaceDelivery
} = require('./events.cjs');

/**
 * Pre-built test scenarios that set up common agent situations.
 *
 * Each scenario returns { relay, wallet, agents, events, cleanup }
 */

/**
 * Basic scenario: relay + wallet + two agent identities
 */
async function basicScenario(opts = {}) {
  const relay = createMockRelay({ logging: opts.logging });
  const { url } = await relay.start();

  const alice = { ...generateKeypair(), name: 'alice' };
  const bob = { ...generateKeypair(), name: 'bob' };

  const wallet = createMockWallet({
    initialBalance: opts.balance || 100000000
  });

  return {
    relay,
    relayUrl: url,
    wallet,
    agents: { alice, bob },
    cleanup: async () => {
      await relay.stop();
    }
  };
}

/**
 * DVM scenario: provider agent with incoming requests
 */
async function dvmScenario(opts = {}) {
  const { relay, relayUrl, wallet, agents, cleanup: baseCleanup } = await basicScenario(opts);

  const dvmKind = opts.dvmKind || 50; // text generation

  // Inject a DVM request from bob to alice
  const request = dvmRequest(dvmKind, 'Translate "hello" to French', agents.alice.pubkey, {
    pubkey: agents.bob.pubkey
  });
  relay.inject(request);

  return {
    relay,
    relayUrl,
    wallet,
    agents,
    request,
    dvmKind,
    // Helper to create a result
    createResult: (content) => dvmResult(dvmKind, content, agents.bob.pubkey, {
      pubkey: agents.alice.pubkey,
      tags: [['e', request.id]]
    }),
    cleanup: baseCleanup
  };
}

/**
 * Marketplace scenario: task posted, bid submitted
 */
async function marketplaceScenario(opts = {}) {
  const { relay, relayUrl, wallet, agents, cleanup: baseCleanup } = await basicScenario(opts);

  // Alice posts a task
  const task = marketplaceTask('Translate README to Spanish', 500, {
    pubkey: agents.alice.pubkey,
    description: 'High-quality translation needed',
    capabilities: ['translation', 'spanish'],
    taskId: 'test-task-001'
  });
  relay.inject(task);

  // Bob bids on it
  const bid = marketplaceBid(task.id, agents.alice.pubkey, 400, 'bob@getalby.com', {
    pubkey: agents.bob.pubkey,
    message: 'I can do this'
  });
  relay.inject(bid);

  return {
    relay,
    relayUrl,
    wallet,
    agents,
    task,
    bid,
    // Helper to create a delivery
    createDelivery: (result) => marketplaceDelivery(task.id, agents.alice.pubkey, result, {
      pubkey: agents.bob.pubkey
    }),
    cleanup: baseCleanup
  };
}

/**
 * Trust scenario: agents with attestations
 */
async function trustScenario(opts = {}) {
  const { relay, relayUrl, wallet, agents, cleanup: baseCleanup } = await basicScenario(opts);

  const charlie = { ...generateKeypair(), name: 'charlie' };

  // Charlie attests alice
  const attestation1 = trustAttestation(agents.alice.pubkey, 'service-quality', 'Great translation service', {
    pubkey: charlie.pubkey
  });
  relay.inject(attestation1);

  // Bob attests alice
  const attestation2 = trustAttestation(agents.alice.pubkey, 'work-completed', 'Completed task on time', {
    pubkey: agents.bob.pubkey
  });
  relay.inject(attestation2);

  // Alice attests bob
  const attestation3 = trustAttestation(agents.bob.pubkey, 'general-trust', 'Reliable agent', {
    pubkey: agents.alice.pubkey
  });
  relay.inject(attestation3);

  return {
    relay,
    relayUrl,
    wallet,
    agents: { ...agents, charlie },
    attestations: [attestation1, attestation2, attestation3],
    cleanup: baseCleanup
  };
}

/**
 * Notification scenario: various events targeting an agent
 */
async function notificationScenario(opts = {}) {
  const { relay, relayUrl, wallet, agents, cleanup: baseCleanup } = await basicScenario(opts);

  const events = [];

  // Mention
  const mention = textNote('Hey @alice, check this out', {
    pubkey: agents.bob.pubkey,
    mention: agents.alice.pubkey
  });
  relay.inject(mention);
  events.push({ type: 'mention', event: mention });

  // DM
  const directMsg = dm('Secret message', agents.alice.pubkey, {
    pubkey: agents.bob.pubkey
  });
  relay.inject(directMsg);
  events.push({ type: 'dm', event: directMsg });

  // Zap
  const zap = zapReceipt(agents.alice.pubkey, 21000, {
    pubkey: agents.bob.pubkey
  });
  relay.inject(zap);
  events.push({ type: 'zap', event: zap });

  // DVM request
  const dvmReq = dvmRequest(50, 'Write a haiku', agents.alice.pubkey, {
    pubkey: agents.bob.pubkey
  });
  relay.inject(dvmReq);
  events.push({ type: 'dvm_request', event: dvmReq });

  // Trust attestation
  const attest = trustAttestation(agents.alice.pubkey, 'service-quality', 'Good agent', {
    pubkey: agents.bob.pubkey
  });
  relay.inject(attest);
  events.push({ type: 'trust', event: attest });

  return {
    relay,
    relayUrl,
    wallet,
    agents,
    events,
    cleanup: baseCleanup
  };
}

module.exports = {
  basicScenario,
  dvmScenario,
  marketplaceScenario,
  trustScenario,
  notificationScenario
};
