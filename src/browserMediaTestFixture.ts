/** Loaded only by the isolated 8897 browser test URL. Not a public tool. */
import { registerBrowserOperation } from './browserMediaClient';

async function tinyPng(): Promise<{ bytes: Uint8Array; digest: string }> {
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 2;
  const graphics = canvas.getContext('2d');
  if (!graphics) throw new Error('Canvas is unavailable.');
  graphics.fillStyle = '#e23a1c';
  graphics.fillRect(0, 0, 2, 2);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map(value => value.toString(16).padStart(2, '0')).join('');
  return { bytes, digest };
}

registerBrowserOperation('fixture_image', async (context, request, operation) => {
  const { bytes, digest } = await tinyPng();
  const destination = request.arguments.save_to;
  await context.upload(operation.operation_id, bytes, 'image/png', digest, {},
    destination === undefined || destination === null ? null : String(destination));
}, () => ({ available: true, formats: ['image/png'] }));

registerBrowserOperation('fixture_pending', async (context, _request, operation) => {
  await new Promise<void>(resolve => window.setTimeout(resolve, 15_000));
  await context.transition(operation.operation_id, 'completed', { fixture: true });
}, () => ({ available: true }));

const dedupRuns = new Map<string, number>();
registerBrowserOperation('fixture_dedup', async (context, request, operation) => {
  dedupRuns.set(operation.operation_id, (dedupRuns.get(operation.operation_id) ?? 0) + 1);
  await new Promise(resolve => window.setTimeout(resolve, 50));
  const now = Date.now;
  let nested;
  try {
    Date.now = () => now() + 6 * 60_000;
    nested = await Promise.all([context.start(request), context.start(request)]);
  } finally { Date.now = now; }
  await context.transition(operation.operation_id, 'completed', {
    handler_runs: dedupRuns.get(operation.operation_id),
    same_operation: nested.every(item => item.operation_id === operation.operation_id)
  });
  // Simulate an old running create reply after the terminal tombstone window.
  const create = context.create.bind(context);
  let staleReplayStatus = '';
  try {
    Date.now = () => now() + 12 * 60_000;
    context.create = async () => ({ operation_id: operation.operation_id, status: 'running' });
    staleReplayStatus = (await context.start(request)).status;
  } finally { context.create = create; Date.now = now; }
  (window as unknown as { __nbinlineaiFixtureDedup?: { runs: number; staleReplayStatus: string } }).__nbinlineaiFixtureDedup = {
    runs: dedupRuns.get(operation.operation_id) ?? 0, staleReplayStatus
  };
  dedupRuns.delete(operation.operation_id);
}, () => ({ available: true }));

registerBrowserOperation('fixture_release_replay', async (context, request, operation) => {
  const { bytes, digest } = await tinyPng();
  const producer = await context.create({ request_id: `${request.request_id}-producer`,
    name: 'fixture_image', arguments: {} });
  const produced = await context.upload(producer.operation_id, bytes, 'image/png', digest);
  const mediaId = String((produced.media as Record<string, unknown>).media_id);
  const release = { request_id: `${request.request_id}-release`, name: 'release_media',
    arguments: { media_id: mediaId } };
  const [first, second] = await Promise.all([context.releaseOperation(release), context.releaseOperation(release)]);
  const replay = await context.releaseOperation(release);
  await context.transition(operation.operation_id, 'completed', {
    statuses: [first.status, second.status, replay.status],
    same_operation: first.operation_id === second.operation_id && second.operation_id === replay.operation_id
  });
}, () => ({ available: true }));
