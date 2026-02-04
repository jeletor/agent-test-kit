# agent-test-kit

Mock Nostr relays and Lightning wallets for testing AI agent infrastructure. In-memory, deterministic, fast.

Stop testing against live relays. Stop mocking by hand.

## Install

```bash
npm install --save-dev agent-test-kit
```

## Quick Start

```javascript
const { createMockRelay, createMockWallet, textNote, generateKeypair } = require('agent-test-kit');

// Start an in-memory relay
const relay = createMockRelay();
const { url } = await relay.start(); // ws://localhost:xxxxx

// Create a mock wallet (lightning-agent compatible)
const wallet = createMockWallet({ initialBalance: 100000000 }); // 100k sats

// Generate test identities
const alice = generateKeypair();
const bob = generateKeypair();

// Inject events directly
relay.inject(textNote('Hello from tests!', { pubkey: alice.pubkey, mention: bob.pubkey }));

// Use the relay URL with any Nostr client
// Use the wallet with any lightning-agent consumer
```

## Mock Relay

Full NIP-01 implementation in memory:

```javascript
const relay = createMockRelay({ port: 0, logging: false });
const { url } = await relay.start();

// Inject events (bypasses WebSocket, still broadcasts to subscribers)
relay.inject(event);

// Query stored events
const events = relay.getEvents({ kinds: [1], authors: [pubkey] });

// Clear all events
relay.clear();

// Check status
relay.status(); // { running, port, url, events, clients, subscriptions }

// Stop
await relay.stop();
```

**Supports:**
- EVENT, REQ, CLOSE messages
- NIP-20 OK responses
- Tag filters (#e, #p, #t, #d, #L, etc.)
- Parameterized replaceable events (kind 30000-39999)
- Event deduplication
- Live broadcast to subscribers (including via `inject()`)

## Mock Wallet

Drop-in replacement for `lightning-agent`'s wallet:

```javascript
const wallet = createMockWallet({
  initialBalance: 100000000,  // msats (= 100k sats)
  autoSettle: false,          // Auto-settle on payInvoice?
  failPayments: false,        // Simulate failures?
  latencyMs: 0                // Simulated latency
});

// Same API as lightning-agent
const inv = await wallet.createInvoice(21000, 'test payment');
const payment = await wallet.payInvoice(bolt11);
const balance = await wallet.getBalance();
await wallet.payAddress('test@getalby.com', 500000);

// Test control
wallet.settle(inv.paymentHash);     // Simulate external payment
wallet.setBalance(50000);            // Set balance directly
wallet.getHistory();                 // All operations
wallet.getInvoices();                // All created invoices
wallet.getPayments();                // All outgoing payments
wallet.reset();                      // Back to initial state
```

## Event Factories

Create properly structured Nostr events without real signatures:

```javascript
const {
  textNote, dm, dvmRequest, dvmResult, zapReceipt,
  reaction, trustAttestation, marketplaceTask,
  marketplaceBid, marketplaceDelivery, serviceAnnouncement
} = require('agent-test-kit');

// Text note with mention
textNote('Hello!', { pubkey: alice, mention: bob });

// Encrypted DM
dm('Secret message', recipientPubkey, { pubkey: sender });

// DVM request/result (NIP-90)
dvmRequest(50, 'Translate this', providerPubkey);
dvmResult(50, 'Translated text', requesterPubkey);

// Zap receipt
zapReceipt(recipientPubkey, 21000); // 21 sats

// ai.wot trust attestation
trustAttestation(targetPubkey, 'service-quality', 'Great agent');

// agent-escrow marketplace events
marketplaceTask('Build a widget', 1000, { capabilities: ['code'] });
marketplaceBid(taskId, posterPubkey, 500, 'worker@ln.com');
marketplaceDelivery(taskId, posterPubkey, 'Here is the work');

// agent-discovery service announcement
serviceAnnouncement('Translation Bot', ['translation'], { price: 21 });
```

## Scenarios

Pre-built test setups for common situations:

```javascript
const { dvmScenario, marketplaceScenario, trustScenario } = require('agent-test-kit');

// DVM: provider with incoming request
const s = await dvmScenario({ dvmKind: 50 });
// s.relay, s.relayUrl, s.wallet, s.agents, s.request
const result = s.createResult('Translated text');
await s.cleanup();

// Marketplace: task posted, bid submitted
const m = await marketplaceScenario();
// m.task, m.bid, m.agents.alice (poster), m.agents.bob (bidder)
const delivery = m.createDelivery('Completed work');
await m.cleanup();

// Trust: agents with attestations
const t = await trustScenario();
// t.attestations (3 mutual attestations), t.agents.charlie
await t.cleanup();

// Notifications: various events targeting an agent
const n = await notificationScenario();
// n.events = [mention, dm, zap, dvm_request, trust]
await n.cleanup();
```

## Use With Your Packages

```javascript
// Test nostr-inbox with mock relay
const { createInbox } = require('nostr-inbox');
const { notificationScenario } = require('agent-test-kit');

const s = await notificationScenario();
const inbox = createInbox({ pubkey: s.agents.alice.pubkey, relays: [s.relayUrl] });
await inbox.start();
const notifications = await inbox.collect(2000);
assert.ok(notifications.length >= 5);
inbox.stop();
await s.cleanup();

// Test agent-escrow with mock wallet
const { createMarketplace } = require('agent-escrow');
const { createMockWallet, createMockRelay, generateKeypair } = require('agent-test-kit');

const wallet = createMockWallet();
// Pass wallet to marketplace config...
```

## License

MIT
