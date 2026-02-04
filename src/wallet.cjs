'use strict';

const crypto = require('crypto');

/**
 * Mock Lightning wallet for testing.
 *
 * Simulates lightning-agent's wallet interface:
 * - getBalance()
 * - createInvoice(amountMsats, description)
 * - payInvoice(bolt11)
 * - payAddress(address, amountMsats, description)
 * - decodeInvoice(bolt11)
 * - waitForPayment(paymentHash, timeoutMs)
 *
 * All operations are in-memory and deterministic.
 * Invoices can be "paid" via wallet.settle(paymentHash).
 */
function createMockWallet(opts = {}) {
  const {
    initialBalance = 100000000, // 100k sats in msats
    autoSettle = false,         // Auto-settle invoices on payInvoice
    failPayments = false,       // Simulate payment failures
    latencyMs = 0               // Simulated latency
  } = opts;

  let balance = initialBalance;
  const invoices = new Map();     // paymentHash → invoice
  const payments = new Map();     // paymentHash → payment record
  const waiters = new Map();      // paymentHash → [resolve, reject]
  const history = [];             // All operations

  /**
   * Generate a deterministic preimage and payment hash
   */
  function generatePaymentPair() {
    const preimage = crypto.randomBytes(32);
    const paymentHash = crypto.createHash('sha256').update(preimage).digest('hex');
    return { preimage: preimage.toString('hex'), paymentHash };
  }

  /**
   * Create a mock bolt11 invoice string
   */
  function mockBolt11(amountSats, paymentHash) {
    return `lnbcrt${amountSats}n1mock${paymentHash.slice(0, 32)}`;
  }

  /**
   * Simulate latency if configured
   */
  async function delay() {
    if (latencyMs > 0) {
      await new Promise(r => setTimeout(r, latencyMs));
    }
  }

  // ── Wallet Interface ──────────────────────────────────

  async function getBalance() {
    await delay();
    const sats = Math.floor(balance / 1000);
    history.push({ type: 'getBalance', balance: sats, timestamp: Date.now() });
    return { balance: sats, currency: 'sats' };
  }

  async function createInvoice(amountMsats, description = '') {
    await delay();
    const amountSats = Math.ceil(amountMsats / 1000);
    const { preimage, paymentHash } = generatePaymentPair();
    const bolt11 = mockBolt11(amountSats, paymentHash);

    const invoice = {
      invoice: bolt11,
      bolt11,
      pr: bolt11,
      payment_hash: paymentHash,
      paymentHash,
      preimage,
      amount: amountMsats,
      amountSats,
      description,
      settled: false,
      created_at: Date.now()
    };

    invoices.set(paymentHash, invoice);
    history.push({ type: 'createInvoice', amountSats, paymentHash, timestamp: Date.now() });

    return invoice;
  }

  async function payInvoice(bolt11) {
    await delay();

    if (failPayments) {
      const err = new Error('Payment failed (mock: failPayments=true)');
      history.push({ type: 'payInvoice', bolt11, error: err.message, timestamp: Date.now() });
      throw err;
    }

    // Extract amount from mock bolt11 or use a default
    const amountMatch = bolt11.match(/lnbcrt?(\d+)n/);
    const amountSats = amountMatch ? parseInt(amountMatch[1], 10) : 100;
    const amountMsats = amountSats * 1000;

    if (balance < amountMsats) {
      const err = new Error(`Insufficient balance: have ${Math.floor(balance / 1000)} sats, need ${amountSats}`);
      history.push({ type: 'payInvoice', bolt11, error: err.message, timestamp: Date.now() });
      throw err;
    }

    balance -= amountMsats;

    const preimage = crypto.randomBytes(32).toString('hex');
    const paymentHash = crypto.createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');

    const payment = {
      preimage,
      paymentHash,
      bolt11,
      amountSats,
      amountMsats,
      settled: true,
      timestamp: Date.now()
    };

    payments.set(paymentHash, payment);
    history.push({ type: 'payInvoice', amountSats, paymentHash, timestamp: Date.now() });

    // If autoSettle, also settle any matching invoice we created
    if (autoSettle) {
      for (const [hash, inv] of invoices) {
        if (inv.bolt11 === bolt11 && !inv.settled) {
          settle(hash);
        }
      }
    }

    return payment;
  }

  async function payAddress(address, amountMsats, description = '') {
    await delay();

    if (failPayments) {
      throw new Error('Payment failed (mock: failPayments=true)');
    }

    const amountSats = Math.ceil(amountMsats / 1000);

    if (balance < amountMsats) {
      throw new Error(`Insufficient balance: have ${Math.floor(balance / 1000)} sats, need ${amountSats}`);
    }

    balance -= amountMsats;

    const preimage = crypto.randomBytes(32).toString('hex');
    const paymentHash = crypto.createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');

    const payment = {
      preimage,
      paymentHash,
      address,
      amountSats,
      amountMsats,
      description,
      settled: true,
      timestamp: Date.now()
    };

    payments.set(paymentHash, payment);
    history.push({ type: 'payAddress', address, amountSats, paymentHash, timestamp: Date.now() });

    return payment;
  }

  async function decodeInvoice(bolt11) {
    await delay();
    const amountMatch = bolt11.match(/lnbcrt?(\d+)n/);
    const hashMatch = bolt11.match(/mock([a-f0-9]{32})/);

    return {
      bolt11,
      amountMsats: amountMatch ? parseInt(amountMatch[1], 10) * 1000 : 0,
      amountSats: amountMatch ? parseInt(amountMatch[1], 10) : 0,
      paymentHash: hashMatch ? hashMatch[1] : null,
      description: '',
      expiry: 3600,
      timestamp: Math.floor(Date.now() / 1000)
    };
  }

  async function waitForPayment(paymentHash, timeoutMs = 30000) {
    await delay();

    // Already settled?
    const inv = invoices.get(paymentHash);
    if (inv && inv.settled) {
      return { preimage: inv.preimage, settled: true };
    }

    // Wait for settle()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(paymentHash);
        reject(new Error(`Payment timeout: ${paymentHash}`));
      }, timeoutMs);

      waiters.set(paymentHash, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });
    });
  }

  // ── Test Control Methods ──────────────────────────────

  /**
   * Settle an invoice (simulate external payment received)
   */
  function settle(paymentHash) {
    const inv = invoices.get(paymentHash);
    if (!inv) throw new Error(`Invoice not found: ${paymentHash}`);
    if (inv.settled) return inv;

    inv.settled = true;
    balance += inv.amount;

    history.push({ type: 'settle', paymentHash, amountSats: inv.amountSats, timestamp: Date.now() });

    // Notify waiters
    const waiter = waiters.get(paymentHash);
    if (waiter) {
      waiter.resolve({ preimage: inv.preimage, settled: true });
      waiters.delete(paymentHash);
    }

    return inv;
  }

  /**
   * Set the balance directly
   */
  function setBalance(sats) {
    balance = sats * 1000;
  }

  /**
   * Get operation history
   */
  function getHistory(type = null) {
    if (!type) return [...history];
    return history.filter(h => h.type === type);
  }

  /**
   * Get all invoices
   */
  function getInvoices() {
    return Array.from(invoices.values());
  }

  /**
   * Get all outgoing payments
   */
  function getPayments() {
    return Array.from(payments.values());
  }

  /**
   * Reset wallet to initial state
   */
  function reset() {
    balance = initialBalance;
    invoices.clear();
    payments.clear();
    waiters.clear();
    history.length = 0;
  }

  /**
   * Close wallet (no-op for mock, API compat)
   */
  async function close() {
    // No-op
  }

  return {
    // lightning-agent compatible interface
    getBalance,
    createInvoice,
    payInvoice,
    payAddress,
    decodeInvoice,
    waitForPayment,
    close,

    // Test control
    settle,
    setBalance,
    getHistory,
    getInvoices,
    getPayments,
    reset
  };
}

module.exports = { createMockWallet };
