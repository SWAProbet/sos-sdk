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

// apiKey, amqpUsername and amqpPassword come back once, when your partner account is registered.
const client = new SosClient({
  accessToken: 'your-api-key',
  sport: 'tennis',
  amqpHost: 'amqps://<amqpUsername>:<amqpPassword>@<broker-host>:5671',
  apiHost: 'https://<api-host>',
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
| `apiBasePath` | `string` | `/sos` | Path the REST API is mounted at behind `apiHost`, where a gateway changes it |
| `bindingPatterns` | `string[]` | `['{sport}.live.#', 'system.live.alive.{sport}', 'system.live.alive.-']` | AMQP routing key patterns. Alive is bound per sport, because on a broker shared across sports `system.live.alive.#` lets another sport's heartbeat hide this feed's outage. `system.live.alive.-` is the key older servers publish on. Not applied when `queue` is set. |
| `queue` | `string` | none | Name of your durable partner queue, `swa.sos.partner.{partnerId}`; the token exchange, `POST {apiBasePath}/auth/token`, returns your `partnerId`. When set, the client consumes that queue by name and declares and binds nothing, because partner credentials can neither declare a named queue nor change its bindings; the server has already bound it to your sports and their heartbeats. Of those heartbeats only `sport`'s counts, so another sport's cannot hide this feed's outage, and recovery covers `sport` alone. Left unset, the client declares an exclusive auto-delete queue for each connection. |
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
| `betCancel` | `BetCancelEvent` | Settlement reversed |
| `fixtureChange` | `FixtureChangeEvent` | Fixture added or changed |
| `snapshotComplete` | `SnapshotCompleteEvent` | End of a recovery replay |
| `alive` | `AliveEvent` | Heartbeat of this sport's producer |
| `connected` | `void` | AMQP connected |
| `disconnected` | `void` | AMQP disconnected |
| `recoveryStarted` | `{ estimatedMessages }` | Recovery initiated |
| `recoveryCompleted` | `void` | Recovery finished |
| `error` | `Error` | Error occurred |

Beyond ids, timestamps, markets and outcomes, the events carry these fields. Each is `undefined` when the message does not have it.

| Event | Field | Description |
|---|---|---|
| `oddsChange` | `sportEventStatus.homeScore`, `sportEventStatus.awayScore` | Score of each competitor; the feed sends `0` where the sport keeps none |
| `oddsChange` | `sportEventStatus.clock.remainingTime` | Time left in the current period, as `m:ss` |
| `oddsChange` | `sportEventStatus.clock.stopped` | `true` while the clock is not running, `false` while it runs |
| `betStop` | `marketStatus` | Status applied to the stopped markets: `0`, deactivated |
| `betCancel` | `markets[].specifiers` | The cancelled line, written as on `oddsChange` and `betSettlement`, so it can be matched to its market |

## Recovery

With `autoRecover` on, the client asks the server to replay what it missed in two cases: when no alive has arrived for `aliveTimeoutMs`, and when the connection comes back after a drop. The first connect asks for nothing. A replay starts from the last alive heard before the gap, using the feed's own timestamp on that alive, and is requested once for each producer the client has heard from. The request names the queue the connection consumes from as `consumer_queue`. If a recovery fails, its starting point is kept and it is tried again after `aliveTimeoutMs`, so alives arriving in the meantime cannot shrink what is replayed. `recoveryStarted` and `recoveryCompleted` fire once for the whole recovery, and `estimatedMessages` counts every producer.

With `queue` set, `consumer_queue` is your durable queue and the replay is delivered into it. That queue also holds what is published while no client is connected, for up to 72 hours, and delivers it on the next connect, so expect the replay that follows a reconnect to repeat messages already read from the queue. The queue carries every sport on your account, and the client reads only `sport`'s heartbeat from it, neither counting nor emitting another sport's, so a sport that stays alive cannot hide this feed's silence. Your other sports' messages are delivered as they come, but a replay is requested for `sport` alone. Run one client per durable queue: clients that share a queue split its messages between them.

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

### Shared SOS deployment

Use the AMQP credentials and vhost assigned to your client; routing keys and the
SDK's anonymous exclusive queue behaviour are unchanged. A shared SOS server can
serve multiple sports. Catalogue and recovery reads include this client's configured
`sport`, including recovery status polling. One `SosClient` still consumes one sport;
HTTP client ownership comes from its API credential, not a client query parameter.
