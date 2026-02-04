'use strict';

const { WebSocketServer } = require('ws');
const crypto = require('crypto');

/**
 * In-memory mock Nostr relay for testing.
 *
 * Implements NIP-01 (basic protocol):
 * - EVENT: store and broadcast
 * - REQ: subscribe with filters
 * - CLOSE: unsubscribe
 *
 * Also supports:
 * - NIP-20 (command results): OK responses for EVENT
 * - Parameterized replaceable events (kind 30000-39999)
 * - Deduplication by event ID
 */
function createMockRelay(opts = {}) {
  const {
    port = 0,  // 0 = random available port
    logging = false
  } = opts;

  const events = new Map();           // id → event
  const subscriptions = new Map();     // ws → Map<subId, filters[]>
  let wss = null;
  let actualPort = null;

  function log(...args) {
    if (logging) console.log('[mock-relay]', ...args);
  }

  /**
   * Check if an event matches a single filter
   */
  function matchesFilter(event, filter) {
    if (filter.ids && !filter.ids.includes(event.id)) return false;
    if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    if (filter.since && event.created_at < filter.since) return false;
    if (filter.until && event.created_at > filter.until) return false;

    // Tag filters (#e, #p, #t, #d, #L, #l, etc.)
    for (const [key, values] of Object.entries(filter)) {
      if (key.startsWith('#') && key.length === 2) {
        const tagName = key[1];
        const eventTagValues = event.tags
          .filter(t => t[0] === tagName)
          .map(t => t[1]);
        if (!values.some(v => eventTagValues.includes(v))) return false;
      }
    }

    return true;
  }

  /**
   * Check if event matches any filter in the array
   */
  function matchesFilters(event, filters) {
    return filters.some(f => matchesFilter(event, f));
  }

  /**
   * Get the replaceable key for parameterized replaceable events
   */
  function replaceableKey(event) {
    if (event.kind >= 30000 && event.kind < 40000) {
      const dTag = event.tags.find(t => t[0] === 'd');
      return `${event.kind}:${event.pubkey}:${dTag ? dTag[1] : ''}`;
    }
    if (event.kind === 0 || event.kind === 3 || (event.kind >= 10000 && event.kind < 20000)) {
      return `${event.kind}:${event.pubkey}`;
    }
    return null;
  }

  /**
   * Store an event
   */
  function storeEvent(event) {
    // Check for replaceable
    const rKey = replaceableKey(event);
    if (rKey) {
      // Find and remove older versions
      for (const [id, existing] of events) {
        if (replaceableKey(existing) === rKey && existing.created_at <= event.created_at) {
          events.delete(id);
        }
      }
    }

    // Deduplicate
    if (events.has(event.id)) {
      return false; // Already have it
    }

    events.set(event.id, event);
    return true;
  }

  /**
   * Handle incoming WebSocket message
   */
  function handleMessage(ws, data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      ws.send(JSON.stringify(['NOTICE', 'Invalid JSON']));
      return;
    }

    if (!Array.isArray(msg) || msg.length < 2) {
      ws.send(JSON.stringify(['NOTICE', 'Invalid message format']));
      return;
    }

    const type = msg[0];

    switch (type) {
      case 'EVENT': {
        const event = msg[1];
        if (!event || !event.id || !event.pubkey || !event.kind === undefined) {
          ws.send(JSON.stringify(['OK', event?.id || '', false, 'Invalid event']));
          return;
        }

        const isNew = storeEvent(event);
        ws.send(JSON.stringify(['OK', event.id, true, '']));
        log('EVENT', event.kind, event.id.slice(0, 8));

        if (isNew) {
          // Broadcast to matching subscriptions
          for (const [subWs, subs] of subscriptions) {
            for (const [subId, filters] of subs) {
              if (matchesFilters(event, filters)) {
                subWs.send(JSON.stringify(['EVENT', subId, event]));
              }
            }
          }
        }
        break;
      }

      case 'REQ': {
        const subId = msg[1];
        const filters = msg.slice(2);

        if (!subscriptions.has(ws)) {
          subscriptions.set(ws, new Map());
        }
        subscriptions.get(ws).set(subId, filters);

        log('REQ', subId, JSON.stringify(filters).slice(0, 100));

        // Send matching stored events
        let count = 0;
        const limit = filters.reduce((max, f) => Math.max(max, f.limit || Infinity), 0);

        const sorted = Array.from(events.values())
          .sort((a, b) => b.created_at - a.created_at);

        for (const event of sorted) {
          if (matchesFilters(event, filters)) {
            ws.send(JSON.stringify(['EVENT', subId, event]));
            count++;
            if (limit !== Infinity && count >= limit) break;
          }
        }

        // Send EOSE
        ws.send(JSON.stringify(['EOSE', subId]));
        break;
      }

      case 'CLOSE': {
        const subId = msg[1];
        const subs = subscriptions.get(ws);
        if (subs) subs.delete(subId);
        log('CLOSE', subId);
        break;
      }

      default:
        ws.send(JSON.stringify(['NOTICE', `Unknown message type: ${type}`]));
    }
  }

  /**
   * Start the mock relay
   */
  function start() {
    return new Promise((resolve) => {
      wss = new WebSocketServer({ port }, () => {
        actualPort = wss.address().port;
        log(`Listening on ws://localhost:${actualPort}`);

        wss.on('connection', (ws) => {
          log('Client connected');

          ws.on('message', (data) => handleMessage(ws, data.toString()));

          ws.on('close', () => {
            subscriptions.delete(ws);
            log('Client disconnected');
          });
        });

        resolve({ port: actualPort, url: `ws://localhost:${actualPort}` });
      });
    });
  }

  /**
   * Stop the mock relay
   */
  function stop() {
    return new Promise((resolve) => {
      if (wss) {
        // Close all client connections
        for (const client of wss.clients) {
          client.close();
        }
        wss.close(() => {
          wss = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Inject an event directly (bypass WebSocket)
   * Also broadcasts to any active WebSocket subscribers.
   */
  function inject(event) {
    const isNew = storeEvent(event);
    if (isNew) {
      // Broadcast to matching subscriptions
      for (const [subWs, subs] of subscriptions) {
        for (const [subId, filters] of subs) {
          if (matchesFilters(event, filters)) {
            try {
              subWs.send(JSON.stringify(['EVENT', subId, event]));
            } catch (e) { /* client disconnected */ }
          }
        }
      }
    }
    return isNew;
  }

  /**
   * Get all stored events
   */
  function getEvents(filter = null) {
    const all = Array.from(events.values());
    if (!filter) return all;
    return all.filter(e => matchesFilter(e, filter));
  }

  /**
   * Clear all stored events
   */
  function clear() {
    events.clear();
  }

  /**
   * Get relay status
   */
  function status() {
    return {
      running: wss !== null,
      port: actualPort,
      url: actualPort ? `ws://localhost:${actualPort}` : null,
      events: events.size,
      clients: wss ? wss.clients.size : 0,
      subscriptions: Array.from(subscriptions.values()).reduce((sum, m) => sum + m.size, 0)
    };
  }

  return {
    start,
    stop,
    inject,
    getEvents,
    clear,
    status,
    matchesFilter,
    matchesFilters
  };
}

module.exports = { createMockRelay };
