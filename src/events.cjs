'use strict';

const crypto = require('crypto');

/**
 * Helper to generate mock Nostr events for testing.
 * Creates properly structured events without requiring real signatures.
 */

/**
 * Generate a random hex keypair (not cryptographically valid for Nostr, but fine for testing)
 */
function generateKeypair() {
  const secretKey = crypto.randomBytes(32).toString('hex');
  const pubkey = crypto.createHash('sha256').update(secretKey).digest('hex');
  return { secretKey, pubkey };
}

/**
 * Create a mock Nostr event
 */
function createEvent(opts = {}) {
  const {
    kind = 1,
    content = '',
    tags = [],
    pubkey = generateKeypair().pubkey,
    created_at = Math.floor(Date.now() / 1000)
  } = opts;

  const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content]);
  const id = crypto.createHash('sha256').update(serialized).digest('hex');
  const sig = crypto.randomBytes(64).toString('hex'); // Fake sig (fine for mock relay)

  return { id, pubkey, created_at, kind, tags, content, sig };
}

// ── Event Factories ─────────────────────────────────────

/**
 * Create a text note (kind 1)
 */
function textNote(content, opts = {}) {
  const tags = [...(opts.tags || [])];
  if (opts.mention) tags.push(['p', opts.mention]);
  if (opts.reply) tags.push(['e', opts.reply]);
  return createEvent({ kind: 1, content, tags, ...opts });
}

/**
 * Create an encrypted DM (kind 4)
 */
function dm(content, recipientPubkey, opts = {}) {
  return createEvent({
    kind: 4,
    content,
    tags: [['p', recipientPubkey], ...(opts.tags || [])],
    ...opts
  });
}

/**
 * Create a DVM request (kind 5xxx)
 */
function dvmRequest(dvmKind, content, providerPubkey, opts = {}) {
  return createEvent({
    kind: 5000 + dvmKind,
    content,
    tags: [['p', providerPubkey], ...(opts.tags || [])],
    ...opts
  });
}

/**
 * Create a DVM result (kind 6xxx)
 */
function dvmResult(dvmKind, content, requesterPubkey, opts = {}) {
  return createEvent({
    kind: 6000 + dvmKind,
    content,
    tags: [['p', requesterPubkey], ...(opts.tags || [])],
    ...opts
  });
}

/**
 * Create a zap receipt (kind 9735)
 */
function zapReceipt(recipientPubkey, amountMsats, opts = {}) {
  const zapRequest = JSON.stringify({
    kind: 9734,
    content: opts.message || '',
    tags: [['p', recipientPubkey], ['amount', String(amountMsats)]]
  });
  return createEvent({
    kind: 9735,
    content: '',
    tags: [
      ['p', recipientPubkey],
      ['bolt11', opts.bolt11 || `lnbc${Math.ceil(amountMsats / 1000)}n1mock`],
      ['description', zapRequest],
      ...(opts.tags || [])
    ],
    ...opts
  });
}

/**
 * Create a reaction (kind 7)
 */
function reaction(targetEventId, targetPubkey, emoji = '+', opts = {}) {
  return createEvent({
    kind: 7,
    content: emoji,
    tags: [['e', targetEventId], ['p', targetPubkey], ...(opts.tags || [])],
    ...opts
  });
}

/**
 * Create an ai.wot attestation (kind 1985)
 */
function trustAttestation(targetPubkey, type, comment, opts = {}) {
  return createEvent({
    kind: 1985,
    content: comment,
    tags: [
      ['L', 'ai.wot'],
      ['l', type, 'ai.wot'],
      ['p', targetPubkey],
      ...(opts.tags || [])
    ],
    ...opts
  });
}

/**
 * Create a marketplace task (kind 30950)
 */
function marketplaceTask(title, budget, opts = {}) {
  const taskId = opts.taskId || crypto.randomUUID();
  return createEvent({
    kind: 30950,
    content: opts.description || '',
    tags: [
      ['d', taskId],
      ['title', title],
      ['budget', String(budget)],
      ['status', opts.status || 'open'],
      ...(opts.capabilities || []).map(c => ['c', c]),
      ...(opts.tags || [])
    ],
    ...opts
  });
}

/**
 * Create a marketplace bid (kind 950)
 */
function marketplaceBid(taskEventId, posterPubkey, amount, lightningAddress, opts = {}) {
  return createEvent({
    kind: 950,
    content: opts.message || '',
    tags: [
      ['e', taskEventId],
      ['p', posterPubkey],
      ['amount', String(amount)],
      ['ln', lightningAddress],
      ...(opts.tags || [])
    ],
    ...opts
  });
}

/**
 * Create a marketplace delivery (kind 951)
 */
function marketplaceDelivery(taskEventId, posterPubkey, result, opts = {}) {
  const hash = crypto.createHash('sha256').update(result).digest('hex');
  return createEvent({
    kind: 951,
    content: result,
    tags: [
      ['e', taskEventId],
      ['p', posterPubkey],
      ['hash', hash],
      ...(opts.tags || [])
    ],
    ...opts
  });
}

/**
 * Create an agent service announcement (kind 38990)
 */
function serviceAnnouncement(name, capabilities, opts = {}) {
  return createEvent({
    kind: 38990,
    content: opts.description || '',
    tags: [
      ['d', opts.identifier || name.toLowerCase().replace(/\s+/g, '-')],
      ['title', name],
      ...(capabilities || []).map(c => ['c', c]),
      ...(opts.price ? [['price', String(opts.price)]] : []),
      ...(opts.lightningAddress ? [['ln', opts.lightningAddress]] : []),
      ['status', opts.status || 'active'],
      ...(opts.tags || [])
    ],
    ...opts
  });
}

module.exports = {
  generateKeypair,
  createEvent,
  textNote,
  dm,
  dvmRequest,
  dvmResult,
  zapReceipt,
  reaction,
  trustAttestation,
  marketplaceTask,
  marketplaceBid,
  marketplaceDelivery,
  serviceAnnouncement
};
