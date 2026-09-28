/** Loaded only by the isolated 8897 browser test URL. Not a public tool. */
import { registerBrowserOperation } from './browserMediaClient';

registerBrowserOperation('fixture_image', async (context, request, operation) => {
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
  const destination = request.arguments.save_to;
  await context.upload(operation.operation_id, bytes, 'image/png', digest, {},
    destination === undefined || destination === null ? null : String(destination));
}, () => ({ available: true, formats: ['image/png'] }));

registerBrowserOperation('fixture_pending', async (context, _request, operation) => {
  await new Promise<void>(resolve => window.setTimeout(resolve, 15_000));
  await context.transition(operation.operation_id, 'completed', { fixture: true });
}, () => ({ available: true }));
