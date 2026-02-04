'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

const {
  createMockRelay, createMockWallet,
  generateKeypair, createEvent, textNote, dm, dvmRequest, dvmResult,
  zapReceipt, reaction, trustAttestation,
  marketplaceTask, marketplaceBid, marketplaceDelivery, serviceAnnouncement,
  basicScenario, dvmScenario, marketplaceScenario, trustScenario, notificationScenario
} = require('../src/index.cjs');

// ── Mock Relay ──────────────────────────────────────────

describe('Mock Relay', () => {
  let relay;

  before(async () => {
    relay = createMockRelay();
    await relay.start();
  });

  after(async () => {
    await relay.stop();
  });

  it('starts and reports status', () => {
    const s = relay.status();
    assert.equal(s.running, true);
    assert.ok(s.port > 0);
    assert.ok(s.url.startsWith('ws://'));
  });

  it('accepts injected events', () => {
    const event = createEvent({ kind: 1, content: 'test' });
    const stored = relay.inject(event);
    assert.equal(stored, true);
    assert.equal(relay.getEvents().length, 1);
  });

  it('deduplicates events by id', () => {
    const event = createEvent({ kind: 1, content: 'dedupe' });
    relay.inject(event);
    const first = relay.getEvents().length;
    relay.inject(event);
    assert.equal(relay.getEvents().length, first);
  });

  it('filters events with getEvents', () => {
    relay.clear();
    const kp = generateKeypair();
    relay.inject(createEvent({ kind: 1, content: 'a', pubkey: kp.pubkey }));
    relay.inject(createEvent({ kind: 4, content: 'b', pubkey: kp.pubkey }));
    relay.inject(createEvent({ kind: 1, content: 'c' }));

    const kind1 = relay.getEvents({ kinds: [1] });
    assert.equal(kind1.length, 2);

    const byAuthor = relay.getEvents({ authors: [kp.pubkey] });
    assert.equal(byAuthor.length, 2);
  });

  it('handles parameterized replaceable events', () => {
    relay.clear();
    const kp = generateKeypair();
    const ev1 = createEvent({
      kind: 30950, pubkey: kp.pubkey,
      tags: [['d', 'task-1'], ['status', 'open']],
      created_at: 1000
    });
    relay.inject(ev1);

    const ev2 = createEvent({
      kind: 30950, pubkey: kp.pubkey,
      tags: [['d', 'task-1'], ['status', 'claimed']],
      created_at: 2000
    });
    relay.inject(ev2);

    // Should only have the newer one
    const tasks = relay.getEvents({ kinds: [30950] });
    assert.equal(tasks.length, 1);
    assert.ok(tasks[0].tags.find(t => t[0] === 'status' && t[1] === 'claimed'));
  });

  it('serves events over WebSocket', async () => {
    relay.clear();
    const event = createEvent({ kind: 1, content: 'ws-test' });
    relay.inject(event);

    const url = relay.status().url;
    const ws = new WebSocket(url);

    const received = await new Promise((resolve, reject) => {
      const events = [];
      ws.on('open', () => {
        ws.send(JSON.stringify(['REQ', 'sub1', { kinds: [1] }]));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg[0] === 'EVENT') events.push(msg[2]);
        if (msg[0] === 'EOSE') {
          ws.close();
          resolve(events);
        }
      });
      ws.on('error', reject);
      setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    });

    assert.equal(received.length, 1);
    assert.equal(received[0].content, 'ws-test');
  });

  it('broadcasts new events to subscribers', async () => {
    relay.clear();
    const url = relay.status().url;
    const ws = new WebSocket(url);

    const received = await new Promise((resolve, reject) => {
      let gotEose = false;
      ws.on('open', () => {
        // Subscribe to ALL kind 1 events (no since filter to avoid timing issues)
        ws.send(JSON.stringify(['REQ', 'live', { kinds: [1] }]));
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg[0] === 'EOSE' && !gotEose) {
          gotEose = true;
          // Inject after EOSE to test live broadcast
          setTimeout(() => {
            const event = createEvent({ kind: 1, content: 'live-event' });
            relay.inject(event);
          }, 50);
        }
        if (msg[0] === 'EVENT' && gotEose && msg[2].content === 'live-event') {
          ws.close();
          resolve(msg[2]);
        }
      });
      ws.on('error', reject);
      setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    });

    assert.equal(received.content, 'live-event');
  });

  it('handles tag filters', () => {
    relay.clear();
    const target = generateKeypair().pubkey;
    const ev1 = createEvent({ kind: 1, tags: [['p', target]], content: 'tagged' });
    const ev2 = createEvent({ kind: 1, content: 'not tagged' });
    relay.inject(ev1);
    relay.inject(ev2);

    assert.ok(relay.matchesFilter(ev1, { '#p': [target] }));
    assert.ok(!relay.matchesFilter(ev2, { '#p': [target] }));
  });

  it('clears all events', () => {
    relay.inject(createEvent({ kind: 1, content: 'will be cleared' }));
    assert.ok(relay.getEvents().length > 0);
    relay.clear();
    assert.equal(relay.getEvents().length, 0);
  });
});

// ── Mock Wallet ─────────────────────────────────────────

describe('Mock Wallet', () => {
  it('starts with configured balance', async () => {
    const wallet = createMockWallet({ initialBalance: 50000000 });
    const { balance } = await wallet.getBalance();
    assert.equal(balance, 50000); // 50k sats
  });

  it('creates invoices', async () => {
    const wallet = createMockWallet();
    const inv = await wallet.createInvoice(21000, 'test payment');
    assert.ok(inv.invoice);
    assert.ok(inv.paymentHash);
    assert.ok(inv.preimage);
    assert.equal(inv.amountSats, 21);
    assert.equal(inv.settled, false);
  });

  it('pays invoices and deducts balance', async () => {
    const wallet = createMockWallet({ initialBalance: 100000000 });
    const result = await wallet.payInvoice('lnbcrt1000n1mock' + 'a'.repeat(32));
    assert.ok(result.preimage);
    assert.equal(result.amountSats, 1000);

    const { balance } = await wallet.getBalance();
    assert.equal(balance, 99000); // 100k - 1k
  });

  it('pays Lightning addresses', async () => {
    const wallet = createMockWallet({ initialBalance: 100000000 });
    const result = await wallet.payAddress('test@getalby.com', 500000, 'tip');
    assert.ok(result.preimage);
    assert.equal(result.amountSats, 500);
    assert.equal(result.address, 'test@getalby.com');
  });

  it('rejects payments with insufficient balance', async () => {
    const wallet = createMockWallet({ initialBalance: 1000 }); // 1 sat
    await assert.rejects(
      () => wallet.payInvoice('lnbcrt1000n1mock' + 'a'.repeat(32)),
      /Insufficient balance/
    );
  });

  it('simulates payment failures when configured', async () => {
    const wallet = createMockWallet({ failPayments: true });
    await assert.rejects(
      () => wallet.payInvoice('lnbcrt100n1mock' + 'a'.repeat(32)),
      /Payment failed/
    );
  });

  it('settles invoices and credits balance', async () => {
    const wallet = createMockWallet({ initialBalance: 0 });
    const inv = await wallet.createInvoice(21000, 'receive');
    assert.equal(inv.settled, false);

    wallet.settle(inv.paymentHash);

    const { balance } = await wallet.getBalance();
    assert.equal(balance, 21); // received 21 sats
  });

  it('resolves waitForPayment on settle', async () => {
    const wallet = createMockWallet();
    const inv = await wallet.createInvoice(5000, 'wait test');

    // Settle after a short delay
    setTimeout(() => wallet.settle(inv.paymentHash), 50);

    const result = await wallet.waitForPayment(inv.paymentHash, 5000);
    assert.equal(result.settled, true);
    assert.ok(result.preimage);
  });

  it('times out waitForPayment', async () => {
    const wallet = createMockWallet();
    const inv = await wallet.createInvoice(1000, 'timeout test');

    await assert.rejects(
      () => wallet.waitForPayment(inv.paymentHash, 100),
      /Payment timeout/
    );
  });

  it('decodes mock invoices', async () => {
    const wallet = createMockWallet();
    const inv = await wallet.createInvoice(42000, 'decode test');
    const decoded = await wallet.decodeInvoice(inv.bolt11);
    assert.equal(decoded.amountSats, 42);
  });

  it('tracks operation history', async () => {
    const wallet = createMockWallet();
    await wallet.getBalance();
    await wallet.createInvoice(1000, 'test');
    const history = wallet.getHistory();
    assert.equal(history.length, 2);
    assert.equal(history[0].type, 'getBalance');
    assert.equal(history[1].type, 'createInvoice');
  });

  it('resets to initial state', async () => {
    const wallet = createMockWallet({ initialBalance: 50000000 });
    await wallet.payInvoice('lnbcrt100n1mock' + 'a'.repeat(32));
    wallet.reset();
    const { balance } = await wallet.getBalance();
    assert.equal(balance, 50000);
    assert.equal(wallet.getHistory().length, 1); // just the getBalance
  });

  it('sets balance directly', async () => {
    const wallet = createMockWallet();
    wallet.setBalance(999);
    const { balance } = await wallet.getBalance();
    assert.equal(balance, 999);
  });
});

// ── Event Factories ─────────────────────────────────────

describe('Event Factories', () => {
  it('generates keypairs', () => {
    const kp = generateKeypair();
    assert.equal(kp.secretKey.length, 64);
    assert.equal(kp.pubkey.length, 64);
  });

  it('creates valid event structure', () => {
    const event = createEvent({ kind: 1, content: 'hello' });
    assert.ok(event.id);
    assert.ok(event.pubkey);
    assert.ok(event.sig);
    assert.equal(event.kind, 1);
    assert.equal(event.content, 'hello');
    assert.ok(event.created_at > 0);
    assert.ok(Array.isArray(event.tags));
  });

  it('creates text notes with mentions', () => {
    const target = generateKeypair().pubkey;
    const note = textNote('hello', { mention: target });
    assert.equal(note.kind, 1);
    assert.ok(note.tags.find(t => t[0] === 'p' && t[1] === target));
  });

  it('creates DMs', () => {
    const recipient = generateKeypair().pubkey;
    const msg = dm('secret', recipient);
    assert.equal(msg.kind, 4);
    assert.ok(msg.tags.find(t => t[0] === 'p' && t[1] === recipient));
  });

  it('creates DVM requests', () => {
    const provider = generateKeypair().pubkey;
    const req = dvmRequest(50, 'translate this', provider);
    assert.equal(req.kind, 5050);
    assert.ok(req.tags.find(t => t[0] === 'p' && t[1] === provider));
  });

  it('creates DVM results', () => {
    const requester = generateKeypair().pubkey;
    const res = dvmResult(50, 'translated text', requester);
    assert.equal(res.kind, 6050);
  });

  it('creates zap receipts', () => {
    const recipient = generateKeypair().pubkey;
    const zap = zapReceipt(recipient, 21000);
    assert.equal(zap.kind, 9735);
    assert.ok(zap.tags.find(t => t[0] === 'p' && t[1] === recipient));
    assert.ok(zap.tags.find(t => t[0] === 'bolt11'));
  });

  it('creates reactions', () => {
    const r = reaction('event123', 'pubkey456', '🔥');
    assert.equal(r.kind, 7);
    assert.equal(r.content, '🔥');
    assert.ok(r.tags.find(t => t[0] === 'e' && t[1] === 'event123'));
  });

  it('creates trust attestations', () => {
    const target = generateKeypair().pubkey;
    const att = trustAttestation(target, 'service-quality', 'excellent');
    assert.equal(att.kind, 1985);
    assert.ok(att.tags.find(t => t[0] === 'L' && t[1] === 'ai.wot'));
    assert.ok(att.tags.find(t => t[0] === 'l' && t[1] === 'service-quality'));
    assert.ok(att.tags.find(t => t[0] === 'p' && t[1] === target));
  });

  it('creates marketplace tasks', () => {
    const task = marketplaceTask('Build a widget', 1000, {
      capabilities: ['code', 'javascript']
    });
    assert.equal(task.kind, 30950);
    assert.ok(task.tags.find(t => t[0] === 'title' && t[1] === 'Build a widget'));
    assert.ok(task.tags.find(t => t[0] === 'budget' && t[1] === '1000'));
    assert.ok(task.tags.find(t => t[0] === 'c' && t[1] === 'code'));
  });

  it('creates marketplace bids', () => {
    const bid = marketplaceBid('task123', 'poster456', 500, 'worker@ln.com');
    assert.equal(bid.kind, 950);
    assert.ok(bid.tags.find(t => t[0] === 'amount' && t[1] === '500'));
    assert.ok(bid.tags.find(t => t[0] === 'ln' && t[1] === 'worker@ln.com'));
  });

  it('creates marketplace deliveries with hash', () => {
    const del = marketplaceDelivery('task123', 'poster456', 'here is the work');
    assert.equal(del.kind, 951);
    assert.ok(del.tags.find(t => t[0] === 'hash'));
    assert.equal(del.content, 'here is the work');
  });

  it('creates service announcements', () => {
    const svc = serviceAnnouncement('Translation Bot', ['translation', 'spanish'], {
      price: 21,
      lightningAddress: 'bot@getalby.com'
    });
    assert.equal(svc.kind, 38990);
    assert.ok(svc.tags.find(t => t[0] === 'c' && t[1] === 'translation'));
    assert.ok(svc.tags.find(t => t[0] === 'price' && t[1] === '21'));
    assert.ok(svc.tags.find(t => t[0] === 'ln' && t[1] === 'bot@getalby.com'));
  });
});

// ── Scenarios ───────────────────────────────────────────

describe('Scenarios', () => {
  it('basic scenario provides relay + wallet + agents', async () => {
    const s = await basicScenario();
    try {
      assert.ok(s.relay);
      assert.ok(s.relayUrl);
      assert.ok(s.wallet);
      assert.ok(s.agents.alice.pubkey);
      assert.ok(s.agents.bob.pubkey);
      assert.notEqual(s.agents.alice.pubkey, s.agents.bob.pubkey);
    } finally {
      await s.cleanup();
    }
  });

  it('DVM scenario includes request event', async () => {
    const s = await dvmScenario();
    try {
      assert.ok(s.request);
      assert.equal(s.request.kind, 5050);

      // Request should be in the relay
      const events = s.relay.getEvents({ kinds: [5050] });
      assert.equal(events.length, 1);

      // Can create a result
      const result = s.createResult('Bonjour');
      assert.equal(result.kind, 6050);
      assert.equal(result.content, 'Bonjour');
    } finally {
      await s.cleanup();
    }
  });

  it('marketplace scenario includes task and bid', async () => {
    const s = await marketplaceScenario();
    try {
      assert.ok(s.task);
      assert.ok(s.bid);
      assert.equal(s.task.kind, 30950);
      assert.equal(s.bid.kind, 950);

      // Relay has both
      assert.equal(s.relay.getEvents({ kinds: [30950] }).length, 1);
      assert.equal(s.relay.getEvents({ kinds: [950] }).length, 1);

      // Can create delivery
      const delivery = s.createDelivery('La traducción completa');
      assert.equal(delivery.kind, 951);
    } finally {
      await s.cleanup();
    }
  });

  it('trust scenario includes attestations', async () => {
    const s = await trustScenario();
    try {
      assert.equal(s.attestations.length, 3);
      assert.ok(s.agents.charlie);

      const trustEvents = s.relay.getEvents({ kinds: [1985] });
      assert.equal(trustEvents.length, 3);
    } finally {
      await s.cleanup();
    }
  });

  it('notification scenario includes various event types', async () => {
    const s = await notificationScenario();
    try {
      assert.equal(s.events.length, 5);

      const types = s.events.map(e => e.type);
      assert.ok(types.includes('mention'));
      assert.ok(types.includes('dm'));
      assert.ok(types.includes('zap'));
      assert.ok(types.includes('dvm_request'));
      assert.ok(types.includes('trust'));
    } finally {
      await s.cleanup();
    }
  });
});
