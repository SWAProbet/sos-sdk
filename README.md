# @swa/uof-sdk

TypeScript client SDK for connecting to the SWA Unified Odds Feed. Consumes live odds via AMQP (RabbitMQ) with automatic recovery and XML deserialization, and wraps the REST API so fixtures, odds queries and per-event recovery come back as typed objects.

## Installation

```bash
npm install @swa/uof-sdk
```

## Usage

```typescript
import { SwaUofClient } from '@swa/uof-sdk';

const client = new SwaUofClient({
  accessToken: 'your-api-key',
  amqpHost: 'amqp://feed.swa.com',
  apiHost: 'https://feed-api.swa.com',
});

client.on('oddsChange', (event) => {
  console.log(`Odds update for ${event.eventId}:`);
  for (const market of event.markets) {
    console.log(`  Market ${market.id} (status=${market.status}):`);
    for (const outcome of market.outcomes) {
      console.log(`    ${outcome.id}: odds=${outcome.odds}, active=${outcome.active}`);
    }
  }
});

client.on('betSettlement', (event) => {
  console.log(`Settlement for ${event.eventId}:`);
  for (const market of event.markets) {
    for (const outcome of market.outcomes) {
      console.log(`  ${outcome.id}: ${outcome.result}`);
    }
  }
});

client.on('betStop', (event) => {
  console.log(`Bet stop for ${event.eventId}, groups: ${event.groups}`);
});

client.on('alive', (event) => {
  // Heartbeat. The SDK handles recovery automatically.
});

client.on('recoveryStarted', ({ estimatedMessages }) => {
  console.log(`Recovery started, ~${estimatedMessages} messages to replay`);
});

client.on('recoveryCompleted', () => {
  console.log('Recovery complete');
});

await client.connect();
```

### Discovering fixtures

Fixtures let a partner map SWA event ids onto their own before a card starts.

```typescript
const fixtures = await client.getFixtures({ date: '2026-09-01', isLiveOdds: true });

for (const fixture of fixtures) {
  console.log(fixture.eventId, fixture.name, fixture.card?.name, fixture.weightClass);
}
```

### Querying one event

```typescript
// Current odds, returned in the HTTP response rather than over the queue.
const probabilities = await client.getProbabilities('sr:match:63471857');

// One market, or one market and specifier set.
const market = await client.getProbabilities('sr:match:63471857', 1510, 'total=2.5|roundnr=1');

// Result and settlement state.
const summary = await client.getEventSummary('sr:match:63471857');
```

### Recovering one event

Both calls ask the server to republish to this partner's recovery queue, so the
messages arrive through the normal `oddsChange` and `betSettlement` events.

```typescript
await client.recoverEvent('sr:match:63471857');
await client.recoverStatefulMessages('sr:match:63471857');
```

## API

### `SwaUofClient`

#### Constructor

```typescript
new SwaUofClient(config: SwaUofClientConfig)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `accessToken` | `string` | required | Partner API key |
| `amqpHost` | `string` | required | RabbitMQ connection URL |
| `apiHost` | `string` | required | SWA UOF Server REST API URL |
| `bindingPatterns` | `string[]` | `['mma.live.#', 'system.live.alive.#']` | AMQP routing key patterns |
| `aliveTimeoutMs` | `number` | `30000` | Alive timeout before triggering recovery |
| `autoRecover` | `boolean` | `true` | Automatically recover on reconnect |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `connect()` | `void` | Connect to the feed |
| `disconnect()` | `void` | Disconnect |
| `getMarketDescriptions()` | `any` | Market definitions |
| `getFixtures(query?)` | `Fixture[]` | Scheduled events, filter on `date`, `status`, `isLiveOdds` |
| `getFixture(eventId)` | `Fixture` | One fixture, served as JSON |
| `getEventSummary(eventId)` | `EventSummary \| null` | Result and settlement state |
| `getProbabilities(eventId, marketId?, specifiers?)` | `Probabilities \| null` | Current odds in the response body |
| `recoverEvent(eventId)` | `RecoveryRequestAccepted` | Republish the current odds for one event |
| `recoverStatefulMessages(eventId)` | `RecoveryRequestAccepted` | Republish settlements and bet stops for one event |

`getFixtures` used to take a date string and return the raw JSON body. It now
takes a query object and returns parsed `Fixture` objects.

#### Events

| Event | Payload | Description |
|---|---|---|
| `oddsChange` | `OddsChangeEvent` | Odds update |
| `betSettlement` | `BetSettlementEvent` | Market settlement |
| `betStop` | `BetStopEvent` | Market suspension |
| `fixtureChange` | `FixtureChangeEvent` | Event first seen, or its schedule changed |
| `snapshotComplete` | `SnapshotCompleteEvent` | Recovery replay finished |
| `betCancel` | `BetCancelEvent` | Settled markets cancelled |
| `alive` | `AliveEvent` | Producer heartbeat |
| `connected` | `void` | AMQP connected |
| `disconnected` | `void` | AMQP disconnected |
| `recoveryStarted` | `{ estimatedMessages }` | Recovery initiated |
| `recoveryCompleted` | `void` | Recovery finished |
| `error` | `Error` | Error occurred |

## Types

All types are exported from the package:

```typescript
import type {
  OddsChangeEvent,
  BetSettlementEvent,
  BetStopEvent,
  AliveEvent,
  Market,
  Outcome,
  SettlementMarket,
  SettlementOutcome,
  SportEventStatus,
  FixtureChangeEvent,
  SnapshotCompleteEvent,
  BetCancelEvent,
  Fixture,
  FixtureQuery,
  FixtureStatus,
  FixtureCard,
  FixtureCompetitor,
  SportUrn,
  Probabilities,
  EventSummary,
  RecoveryRequestAccepted,
} from '@swa/uof-sdk';
```

## Testing

```bash
npm test
```

```bash
npm run test:coverage
```

Coverage is gated at 80% of statements, branches, functions and lines.
