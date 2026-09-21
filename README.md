# @swa-voltron/sos-sdk

TypeScript client SDK for connecting to the SWA Unified Odds Feed. Consumes live odds via AMQP (RabbitMQ) with automatic recovery and XML deserialization.

Set `sport` to match the feed you are connecting to (tennis | tabletennis | volleyball | mma | boxing, default mma). It scopes the queue bindings to `{sport}.live.#` and points the fixtures lookup at `/v1/sports/{sport}/events`.

## Installation

```bash
npm install @swa-voltron/sos-sdk
```

## Usage

```typescript
import { SosClient } from '@swa-voltron/sos-sdk';

const client = new SosClient({
  accessToken: 'your-api-key',
  sport: 'tennis',
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
  // Heartbeat : SDK handles recovery automatically
});

client.on('recoveryStarted', ({ estimatedMessages }) => {
  console.log(`Recovery started, ~${estimatedMessages} messages to replay`);
});

client.on('recoveryCompleted', () => {
  console.log('Recovery complete');
});

await client.connect();
```

## Upgrading from 1.x

Version 2 changes what `getFixtures` returns. In 1.x it resolved to the response body, an untyped object with the fixtures under `events`; it now resolves to the `Fixture[]` itself, so `(await client.getFixtures()).events` becomes `await client.getFixtures()`. A bare date string is still accepted as the argument. `getFixture` and `getEventSummary` are new, and both resolve to `null` for an event the feed does not hold.

The default bindings also change. In 1.x the client bound `system.live.alive.#`, which on a broker shared across sports let another sport's heartbeat stand in for this feed's. It now binds `system.live.alive.{sport}`, plus `system.live.alive.-` for a server that has not yet moved to the per-sport key. If you pass your own `bindingPatterns`, make the same change; `defaultBindingPatterns(sport)` is exported to build on.

## API

### `SosClient`

#### Constructor

```typescript
new SosClient(config: SosClientConfig)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `accessToken` | `string` | required | Partner API key |
| `amqpHost` | `string` | required | RabbitMQ connection URL |
| `apiHost` | `string` | required | SWA Odds Service (SOS) Server REST API URL |
| `apiBasePath` | `string` | `/sos-api` | Path the REST API is mounted at behind `apiHost`, where a gateway changes it |
| `bindingPatterns` | `string[]` | `['{sport}.live.#', 'system.live.alive.{sport}', 'system.live.alive.-']` | AMQP routing key patterns. Alive is bound per sport, because on a broker shared across sports `system.live.alive.#` lets another sport's heartbeat hide this feed's outage. `system.live.alive.-` is the key older servers publish on. |
| `aliveTimeoutMs` | `number` | `30000` | Alive timeout before triggering recovery |
| `autoRecover` | `boolean` | `true` | Automatically recover on reconnect |

#### Methods

- `connect()` : connect to the feed
- `disconnect()` : disconnect
- `getMarketDescriptions()` : fetch market definitions from the API
- `getFixtures(filters?)`: every fixture the feed holds for the client's sport, as `Fixture[]`. Filters are `date` (YYYY-MM-DD), `status` and `isLiveOdds`. A bare date string is still accepted.
- `getFixture(eventId)`: one fixture, or `null` when the feed does not hold it.
- `getEventSummary(eventId)`: the fixture with its result and settlement state, or `null`.

#### Events

| Event | Payload | Description |
|---|---|---|
| `oddsChange` | `OddsChangeEvent` | Odds update |
| `betSettlement` | `BetSettlementEvent` | Market settlement |
| `betStop` | `BetStopEvent` | Market suspension |
| `alive` | `AliveEvent` | Producer heartbeat |
| `connected` | `void` | AMQP connected |
| `disconnected` | `void` | AMQP disconnected |
| `recoveryStarted` | `{ estimatedMessages }` | Recovery initiated |
| `recoveryCompleted` | `void` | Recovery finished |
| `error` | `Error` | Error occurred |

## Recovery

With `autoRecover` on, the client asks the server to replay what it missed in two cases: when no alive has arrived for `aliveTimeoutMs`, and when the connection comes back after a drop. The first connect asks for nothing. A replay starts from the last alive heard before the gap, using the feed's own timestamp on that alive, and is requested once for each producer the client has heard from. The request names the queue the connection consumes from as `consumer_queue`. If a recovery fails, its starting point is kept and it is tried again after `aliveTimeoutMs`, so alives arriving in the meantime cannot shrink what is replayed. `recoveryStarted` and `recoveryCompleted` fire once for the whole recovery, and `estimatedMessages` counts every producer.

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
} from '@swa-voltron/sos-sdk';
```
