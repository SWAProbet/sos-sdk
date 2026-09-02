# @swa/sos-sdk

TypeScript client SDK for connecting to the SWA Unified Odds Feed. Consumes live odds via AMQP (RabbitMQ) with automatic recovery and XML deserialization.

Set `sport` to match the feed you are connecting to (tennis | tabletennis | volleyball | mma, default mma). It scopes the queue bindings to `{sport}.live.#` and points the fixtures lookup at `/v1/sports/{sport}/events`.

## Installation

```bash
npm install @swa/sos-sdk
```

## Usage

```typescript
import { SosClient } from '@swa/sos-sdk';

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
  // Heartbeat — SDK handles recovery automatically
});

client.on('recoveryStarted', ({ estimatedMessages }) => {
  console.log(`Recovery started, ~${estimatedMessages} messages to replay`);
});

client.on('recoveryCompleted', () => {
  console.log('Recovery complete');
});

await client.connect();
```

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
| `bindingPatterns` | `string[]` | `['mma.live.#', 'system.live.alive.#']` | AMQP routing key patterns |
| `aliveTimeoutMs` | `number` | `30000` | Alive timeout before triggering recovery |
| `autoRecover` | `boolean` | `true` | Automatically recover on reconnect |

#### Methods

- `connect()` — connect to the feed
- `disconnect()` — disconnect
- `getMarketDescriptions()` — fetch market definitions from the API
- `getFixtures(date?)` — fetch scheduled events

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
} from '@swa/sos-sdk';
```
