import { parseArgs } from 'node:util';

import { io } from 'socket.io-client';

import type { RealtimeEvent, RealtimeEvents } from '@shared/realtime/realtime.types';

/**
 * Prints the realtime feed a signed-in actor receives. There is no other way to see what the
 * gateway pushes: a socket is not something curl can hold open, and "the emit is in the code"
 * is not the same statement as "the client got it".
 *
 *   pnpm realtime:watch --token "$ACCESS_TOKEN" [--url http://127.0.0.1:3000] [--seconds 30]
 */
const WATCHED: readonly RealtimeEvent[] = [
  'order.placed',
  'order.status-changed',
  'notification.created',
  'media.processed',
];

const { values } = parseArgs({
  options: {
    token: { type: 'string' },
    url: { type: 'string', default: 'http://127.0.0.1:3000' },
    seconds: { type: 'string', default: '30' },
  },
});

const { token, url, seconds } = values;

if (token === undefined) {
  throw new Error('Usage: pnpm realtime:watch --token <access token>');
}

const socket = io(url, { path: '/realtime', auth: { token }, transports: ['websocket'] });

socket.on('connect', () => {
  process.stdout.write(`connected to ${url} as ${String(socket.id)}\n`);
});

socket.on('connect_error', (error: Error) => {
  process.stdout.write(`connect_error: ${error.message}\n`);
  process.exit(1);
});

for (const event of WATCHED) {
  socket.on(event, (payload: RealtimeEvents[typeof event]) => {
    process.stdout.write(`${event} ${JSON.stringify(payload)}\n`);
  });
}

setTimeout(
  () => {
    socket.close();
    process.exit(0);
  },
  Number(seconds) * 1000,
);
