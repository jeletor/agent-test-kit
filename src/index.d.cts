// Type definitions for agent-test-kit

// ── Mock Relay ──────────────────────────────────────────

export interface NostrEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: `#${string}`]: string[];
}

export interface RelayStatus {
  running: boolean;
  port: number | null;
  url: string | null;
  events: number;
  clients: number;
  subscriptions: number;
}

export interface MockRelay {
  start(): Promise<{ port: number; url: string }>;
  stop(): Promise<void>;
  inject(event: NostrEvent): boolean;
  getEvents(filter?: NostrFilter): NostrEvent[];
  clear(): void;
  status(): RelayStatus;
  matchesFilter(event: NostrEvent, filter: NostrFilter): boolean;
  matchesFilters(event: NostrEvent, filters: NostrFilter[]): boolean;
}

export function createMockRelay(opts?: { port?: number; logging?: boolean }): MockRelay;

// ── Mock Wallet ─────────────────────────────────────────

export interface Invoice {
  invoice: string;
  bolt11: string;
  pr: string;
  payment_hash: string;
  paymentHash: string;
  preimage: string;
  amount: number;
  amountSats: number;
  description: string;
  settled: boolean;
  created_at: number;
}

export interface Payment {
  preimage: string;
  paymentHash: string;
  bolt11?: string;
  address?: string;
  amountSats: number;
  amountMsats: number;
  description?: string;
  settled: boolean;
  timestamp: number;
}

export interface HistoryEntry {
  type: string;
  timestamp: number;
  [key: string]: any;
}

export interface MockWallet {
  getBalance(): Promise<{ balance: number; currency: string }>;
  createInvoice(amountMsats: number, description?: string): Promise<Invoice>;
  payInvoice(bolt11: string): Promise<Payment>;
  payAddress(address: string, amountMsats: number, description?: string): Promise<Payment>;
  decodeInvoice(bolt11: string): Promise<{ bolt11: string; amountMsats: number; amountSats: number; paymentHash: string | null; description: string; expiry: number; timestamp: number }>;
  waitForPayment(paymentHash: string, timeoutMs?: number): Promise<{ preimage: string; settled: boolean }>;
  close(): Promise<void>;
  settle(paymentHash: string): Invoice;
  setBalance(sats: number): void;
  getHistory(type?: string): HistoryEntry[];
  getInvoices(): Invoice[];
  getPayments(): Payment[];
  reset(): void;
}

export function createMockWallet(opts?: {
  initialBalance?: number;
  autoSettle?: boolean;
  failPayments?: boolean;
  latencyMs?: number;
}): MockWallet;

// ── Event Factories ─────────────────────────────────────

export interface Keypair {
  secretKey: string;
  pubkey: string;
}

export function generateKeypair(): Keypair;
export function createEvent(opts?: { kind?: number; content?: string; tags?: string[][]; pubkey?: string; created_at?: number }): NostrEvent;
export function textNote(content: string, opts?: { tags?: string[][]; mention?: string; reply?: string; pubkey?: string }): NostrEvent;
export function dm(content: string, recipientPubkey: string, opts?: { tags?: string[][]; pubkey?: string }): NostrEvent;
export function dvmRequest(dvmKind: number, content: string, providerPubkey: string, opts?: { tags?: string[][]; pubkey?: string }): NostrEvent;
export function dvmResult(dvmKind: number, content: string, requesterPubkey: string, opts?: { tags?: string[][]; pubkey?: string }): NostrEvent;
export function zapReceipt(recipientPubkey: string, amountMsats: number, opts?: { message?: string; bolt11?: string; tags?: string[][]; pubkey?: string }): NostrEvent;
export function reaction(targetEventId: string, targetPubkey: string, emoji?: string, opts?: { tags?: string[][]; pubkey?: string }): NostrEvent;
export function trustAttestation(targetPubkey: string, type: string, comment: string, opts?: { tags?: string[][]; pubkey?: string }): NostrEvent;
export function marketplaceTask(title: string, budget: number, opts?: { description?: string; capabilities?: string[]; taskId?: string; status?: string; tags?: string[][]; pubkey?: string }): NostrEvent;
export function marketplaceBid(taskEventId: string, posterPubkey: string, amount: number, lightningAddress: string, opts?: { message?: string; tags?: string[][]; pubkey?: string }): NostrEvent;
export function marketplaceDelivery(taskEventId: string, posterPubkey: string, result: string, opts?: { tags?: string[][]; pubkey?: string }): NostrEvent;
export function serviceAnnouncement(name: string, capabilities: string[], opts?: { description?: string; identifier?: string; price?: number; lightningAddress?: string; status?: string; tags?: string[][]; pubkey?: string }): NostrEvent;

// ── Scenarios ───────────────────────────────────────────

export interface BaseScenario {
  relay: MockRelay;
  relayUrl: string;
  wallet: MockWallet;
  agents: { alice: Keypair & { name: string }; bob: Keypair & { name: string } };
  cleanup(): Promise<void>;
}

export interface DVMScenario extends BaseScenario {
  request: NostrEvent;
  dvmKind: number;
  createResult(content: string): NostrEvent;
}

export interface MarketplaceScenario extends BaseScenario {
  task: NostrEvent;
  bid: NostrEvent;
  createDelivery(result: string): NostrEvent;
}

export interface TrustScenario extends BaseScenario {
  agents: BaseScenario['agents'] & { charlie: Keypair & { name: string } };
  attestations: NostrEvent[];
}

export interface NotificationScenario extends BaseScenario {
  events: Array<{ type: string; event: NostrEvent }>;
}

export function basicScenario(opts?: { logging?: boolean; balance?: number }): Promise<BaseScenario>;
export function dvmScenario(opts?: { logging?: boolean; balance?: number; dvmKind?: number }): Promise<DVMScenario>;
export function marketplaceScenario(opts?: { logging?: boolean; balance?: number }): Promise<MarketplaceScenario>;
export function trustScenario(opts?: { logging?: boolean; balance?: number }): Promise<TrustScenario>;
export function notificationScenario(opts?: { logging?: boolean; balance?: number }): Promise<NotificationScenario>;
