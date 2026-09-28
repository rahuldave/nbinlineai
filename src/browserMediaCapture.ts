/** Camera, microphone and display operations owned by one notebook browser context. */
import { Widget } from '@lumino/widgets';
import { BrowserMediaError, BrowserOperationContext, BrowserOperationStatus, BrowserSource,
  registerBrowserOperation } from './browserMediaClient';
import { sha256Bytes } from './browserMediaHash';
import { recordingHandle, recordingSourceEnded,
  startRecordedOperation, stopRecordingHandle } from './browserMediaRecorder';

interface CaptureUi {
  widget: Widget;
  previews: Map<string, HTMLElement>;
  sourceCleanup: Map<string, () => void>;
  share: HTMLButtonElement;
  message: HTMLElement;
  pendingShare?: { operation: BrowserOperationStatus; audio: boolean; timer: number };
}
const views = new WeakMap<BrowserOperationContext, CaptureUi>();
const terminal = new Set(['completed', 'failed', 'cancelled', 'expired']);

function errorCode(error: unknown): BrowserMediaError {
  if (error instanceof BrowserMediaError) return error;
  const name = error instanceof DOMException ? error.name : '';
  const code = ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name) ? 'permission_denied' :
    ['NotFoundError', 'OverconstrainedError', 'NotReadableError'].includes(name) ? 'device_unavailable' : 'unsupported';
  return new BrowserMediaError(code, code === 'permission_denied' ? 'The browser did not grant media access.' :
    code === 'device_unavailable' ? 'The requested camera, microphone, or display is unavailable.' :
      'This browser could not complete the media request.');
}

function requireDevice(kind: 'camera' | 'microphone' | 'screen'): void {
  if (!window.isSecureContext) throw new BrowserMediaError('needs_secure_context',
    `${kind} access needs a secure Jupyter origin, such as HTTPS or desktop localhost.`);
  if (!navigator.mediaDevices || (kind === 'screen' ? !navigator.mediaDevices.getDisplayMedia :
    !navigator.mediaDevices.getUserMedia))
    throw new BrowserMediaError('unsupported', `This browser does not support ${kind} capture here.`);
}

function capability(kind: 'camera' | 'microphone' | 'screen') {
  if (!window.isSecureContext) return { available: false, reason: 'Needs a secure Jupyter origin' };
  const supported = Boolean(navigator.mediaDevices && (kind === 'screen' ?
    navigator.mediaDevices.getDisplayMedia : navigator.mediaDevices.getUserMedia));
  return { available: supported, ...(!supported ? { reason: `${kind} capture API is unavailable` } : {}) };
}

function recordingCapability(kind?: 'camera' | 'microphone') {
  const device = kind ? capability(kind) : { available: true };
  if (!device.available) return device;
  if (typeof MediaRecorder === 'undefined')
    return { available: false, reason: 'MediaRecorder is unavailable' };
  const formats = ['video/webm', 'video/mp4', 'audio/webm', 'audio/mp4', 'audio/ogg']
    .filter(format => MediaRecorder.isTypeSupported?.(format));
  return { available: true, formats };
}

function deviceListCapability() {
  if (!window.isSecureContext) return { available: false, reason: 'Needs a secure Jupyter origin' };
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) ? { available: true } :
    { available: false, reason: 'Browser device listing is unavailable' };
}

function captureUi(context: BrowserOperationContext): CaptureUi {
  const previous = views.get(context);
  if (previous && !previous.widget.isDisposed) return previous;
  const widget = new Widget();
  widget.addClass('nbinlineai-capture-panel');
  widget.node.hidden = true;
  const message = document.createElement('span');
  message.className = 'nbinlineai-capture-message';
  const share = document.createElement('button');
  share.type = 'button';
  share.textContent = 'Share screen';
  const previews = new Map<string, HTMLElement>();
  const sourceCleanup = new Map<string, () => void>();
  widget.node.append(share, message);
  const ui: CaptureUi = { widget, previews, sourceCleanup, share, message };
  share.onclick = () => { void clickedShare(context, ui); };
  context.panel.contentHeader.addWidget(widget);
  context.addCleanup(() => {
    sourceCleanup.forEach(cleanup => cleanup()); sourceCleanup.clear();
    widget.dispose(); views.delete(context);
  });
  views.set(context, ui);
  return ui;
}

function showCaptureControls(ui: CaptureUi, text = ''): void {
  ui.widget.node.hidden = false;
  ui.message.textContent = text;
}

function showSource(context: BrowserOperationContext, source: BrowserSource, stream: MediaStream): void {
  const ui = captureUi(context);
  showCaptureControls(ui);
  const row = document.createElement('div');
  row.className = 'nbinlineai-capture-source';
  const label = document.createElement('span');
  label.textContent = `${source.kind} source active`;
  row.append(label);
  if (stream.getVideoTracks().length) {
    const video = document.createElement('video');
    video.autoplay = true; video.muted = true; video.playsInline = true;
    video.srcObject = stream;
    video.setAttribute('aria-label', `${source.kind} preview`);
    row.append(video);
    void video.play().catch(() => undefined);
  } else if (stream.getAudioTracks().length) {
    const meter = document.createElement('meter');
    meter.min = 0; meter.max = 1; meter.value = 0;
    meter.setAttribute('aria-label', 'Microphone level');
    row.append(meter);
    const AudioContextClass = window.AudioContext;
    if (AudioContextClass) {
      try {
        const audio = new AudioContextClass();
        const analyser = audio.createAnalyser();
        analyser.fftSize = 512;
        audio.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const timer = window.setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          meter.value = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
        }, 200);
        ui.sourceCleanup.set(source.sourceId, () => { window.clearInterval(timer); void audio.close(); });
      } catch { meter.title = 'Level meter unavailable in this browser'; }
    }
  }
  const stop = document.createElement('button');
  stop.type = 'button'; stop.textContent = 'Stop source';
  stop.onclick = () => { void context.endSource(source.sourceId, 'source_ended').catch(error => {
    ui.message.textContent = errorCode(error).message;
  }); };
  row.append(stop);
  ui.previews.set(source.sourceId, row);
  ui.widget.node.append(row);
}

function removeSource(context: BrowserOperationContext, sourceId: string): void {
  const ui = views.get(context);
  ui?.previews.get(sourceId)?.remove();
  ui?.previews.delete(sourceId);
  ui?.sourceCleanup.get(sourceId)?.();
  ui?.sourceCleanup.delete(sourceId);
}

function registerStream(context: BrowserOperationContext, kind: BrowserSource['kind'], stream: MediaStream): BrowserSource {
  let sourceId = '';
  const source = context.registerSource({ kind, tracks: stream.getTracks(),
    actions: kind === 'microphone' ? ['record', 'levels'] : ['capture', 'record'],
    onEnded: async reason => {
      await recordingSourceEnded(context, sourceId, reason, () => removeSource(context, sourceId));
    } });
  sourceId = source.sourceId;
  showSource(context, source, stream);
  return source;
}

function settingsFor(source: BrowserSource): Record<string, unknown> {
  const video = source.tracks.find(track => track.kind === 'video');
  const audio = source.tracks.find(track => track.kind === 'audio');
  const settings = (video ?? audio)?.getSettings() ?? {};
  return { source_id: source.sourceId, kind: source.kind,
    audio: Boolean(audio), video: Boolean(video),
    ...(settings.deviceId ? { device_id: settings.deviceId } : {}),
    ...(settings.facingMode ? { facing: settings.facingMode } : {}),
    ...(settings.width ? { width: settings.width } : {}),
    ...(settings.height ? { height: settings.height } : {}),
    ...(settings.displaySurface ? { display_surface: settings.displaySurface } : {}) };
}

async function openUserMedia(context: BrowserOperationContext, kind: 'camera' | 'microphone',
  args: Record<string, unknown>, operation: BrowserOperationStatus): Promise<BrowserSource> {
  requireDevice(kind);
  const signal = context.operationSignal(operation.operation_id);
  const deviceId = String(args.device_id ?? '');
  const facing = String(args.facing ?? 'user');
  const video: MediaTrackConstraints | false = kind === 'camera' ? (deviceId ?
    { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } }) : false;
  const audio: MediaTrackConstraints | boolean = kind === 'microphone' ? (deviceId ?
    { deviceId: { exact: deviceId } } : true) : args.audio === true;
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video, audio }); }
  catch (error) { throw errorCode(error); }
  if (signal.aborted || !context.isCurrent()) {
    stream.getTracks().forEach(track => track.stop());
    throw new BrowserMediaError('cancelled', 'Media permission completed after cancellation.');
  }
  let state: BrowserOperationStatus;
  try { state = await context.status(operation.operation_id); }
  catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  if (terminal.has(state.status)) {
    stream.getTracks().forEach(track => track.stop());
    throw new BrowserMediaError('stale_target', 'The media permission request has ended.');
  }
  if ((kind === 'camera' && !stream.getVideoTracks().length) ||
      ((kind === 'microphone' || args.audio === true) && !stream.getAudioTracks().length)) {
    stream.getTracks().forEach(track => track.stop());
    throw new BrowserMediaError('device_unavailable', 'The requested track was not provided.');
  }
  let source: BrowserSource;
  try { source = registerStream(context, kind, stream); }
  catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  context.addOperationCleanup(operation.operation_id, () => {
    if (signal.aborted) void context.endSource(source.sourceId, 'cancelled');
  });
  return source;
}

function chosenSource(context: BrowserOperationContext, kind: BrowserSource['kind'], sourceId: string): BrowserSource {
  if (sourceId) {
    const source = context.source(sourceId);
    if (source.kind !== kind) throw new BrowserMediaError('invalid_argument', `The selected source is not ${kind}.`);
    return source;
  }
  const sources = context.sourcesOfKind(kind);
  if (sources.length !== 1) throw new BrowserMediaError(sources.length ? 'busy' : 'source_stopped',
    sources.length ? `Choose one ${kind} source_id.` : `No active ${kind} source is available.`);
  return sources[0];
}

async function videoFrame(source: BrowserSource, timeoutSeconds: number, maxSize: number): Promise<Uint8Array> {
  if (!source.tracks.some(track => track.kind === 'video' && track.readyState === 'live'))
    throw new BrowserMediaError('source_stopped', 'The selected video source stopped.');
  const video = document.createElement('video');
  video.autoplay = true; video.muted = true; video.playsInline = true;
  video.srcObject = new MediaStream(source.tracks.filter(track => track.kind === 'video'));
  const ready = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new BrowserMediaError('timeout', 'Video frame was not ready.')),
      timeoutSeconds * 1000);
    const check = (): void => {
      if (video.videoWidth > 0 && video.videoHeight > 0) { window.clearTimeout(timer); resolve(); }
    };
    video.onloadeddata = check;
    video.onloadedmetadata = check;
    check();
  });
  try {
    void video.play().catch(() => undefined);
    await ready;
    const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight),
      Math.sqrt(16_000_000 / (video.videoWidth * video.videoHeight)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
    const graphics = canvas.getContext('2d');
    if (!graphics) throw new BrowserMediaError('unsupported', 'Canvas image capture is unavailable.');
    graphics.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value =>
      value ? resolve(value) : reject(new BrowserMediaError('unsupported', 'PNG encoding failed.')), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally { video.pause(); video.srcObject = null; }
}

async function captureStill(context: BrowserOperationContext, operation: BrowserOperationStatus,
  source: BrowserSource, saveTo: string | null, maxSize: number, timeout: number): Promise<void> {
  const bytes = await videoFrame(source, timeout, maxSize);
  const digest = await sha256Bytes(bytes);
  await context.upload(operation.operation_id, bytes, 'image/png', digest, {}, saveTo);
}

async function clickedShare(context: BrowserOperationContext, ui: CaptureUi): Promise<void> {
  let capture: Promise<MediaStream>;
  const pending = ui.pendingShare;
  try {
    requireDevice('screen');
    // This call must remain directly inside the button click's activation.
    capture = navigator.mediaDevices.getDisplayMedia({ video: true, audio: pending?.audio ?? false });
  } catch (error) {
    ui.message.textContent = errorCode(error).message;
    return;
  }
  let operation = pending?.operation;
  let stream: MediaStream | undefined;
  let source: BrowserSource | undefined;
  try {
    if (!operation) operation = await context.create({ request_id: randomRequestId(),
      name: 'start_share', arguments: { audio: false } }, true);
    stream = await capture;
    if (!context.isCurrent() || terminal.has((await context.status(operation.operation_id)).status)) {
      stream.getTracks().forEach(track => track.stop()); return;
    }
    if (pending?.audio && !stream.getAudioTracks().length) {
      stream.getTracks().forEach(track => track.stop());
      pending.audio = false;
      ui.share.textContent = 'Share without audio';
      ui.message.textContent = 'Screen audio was unavailable. Click again to choose silent sharing.';
      return;
    }
    source = registerStream(context, 'screen', stream);
    await context.transition(operation.operation_id, 'running');
    await context.transition(operation.operation_id, 'completed', settingsFor(source));
    if (pending) { window.clearTimeout(pending.timer); ui.pendingShare = undefined; }
    ui.share.textContent = 'Share screen';
    ui.message.textContent = 'Screen source active. Stop it when finished.';
  } catch (error) {
    if (source) void context.endSource(source.sourceId, 'cancelled');
    else stream?.getTracks().forEach(track => track.stop());
    if (operation) {
      try { await context.transition(operation.operation_id, 'failed', undefined,
        { code: errorCode(error).code, message: errorCode(error).message }); } catch { /* already cancelled */ }
    }
    if (pending) { window.clearTimeout(pending.timer); ui.pendingShare = undefined; }
    ui.message.textContent = errorCode(error).message;
  }
}

function randomRequestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value =>
    value.toString(16).padStart(2, '0')).join('');
}

async function audioLevels(source: BrowserSource, windowMs: number): Promise<{ rms: number; peak: number; window_ms: number }> {
  const tracks = source.tracks.filter(track => track.kind === 'audio' && track.readyState === 'live');
  if (!tracks.length) throw new BrowserMediaError('source_stopped', 'This source has no active audio track.');
  if (!window.AudioContext) throw new BrowserMediaError('unsupported', 'Audio level observation is unavailable.');
  const audio = new AudioContext();
  try {
    const analyser = audio.createAnalyser();
    analyser.fftSize = 2048;
    audio.createMediaStreamSource(new MediaStream(tracks)).connect(analyser);
    await new Promise(resolve => window.setTimeout(resolve, windowMs));
    const values = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(values);
    let energy = 0; let peak = 0;
    for (const value of values) {
      const amplitude = Math.abs((value - 128) / 128);
      energy += amplitude * amplitude;
      peak = Math.max(peak, amplitude);
    }
    return { rms: Math.round(Math.sqrt(energy / values.length) * 1000) / 1000,
      peak: Math.round(peak * 1000) / 1000, window_ms: windowMs };
  } finally { await audio.close(); }
}

registerBrowserOperation('list_media_sources', async (context, request, operation) => {
  const support = deviceListCapability();
  if (!support.available) throw new BrowserMediaError(window.isSecureContext ? 'unsupported' : 'needs_secure_context',
    support.reason ?? 'Browser device listing is unavailable');
  let devices: MediaDeviceInfo[];
  try { devices = await navigator.mediaDevices.enumerateDevices(); }
  catch (error) { throw errorCode(error); }
  const kind = String(request.arguments.kind);
  const filtered = devices.filter(device => device.kind === 'videoinput' || device.kind === 'audioinput')
    .filter(device => kind === 'all' || (kind === 'camera' ? device.kind === 'videoinput' : device.kind === 'audioinput'));
  const cursor = String(request.arguments.cursor);
  if (cursor && !/^(0|[1-9][0-9]{0,5})$/.test(cursor))
    throw new BrowserMediaError('invalid_argument', 'Invalid device cursor.');
  const start = cursor ? Number(cursor) : 0;
  if (start > filtered.length) throw new BrowserMediaError('stale_target', 'Device list changed; start again.');
  const limit = Number(request.arguments.limit);
  const page: Array<{ device_id: string; kind: string; label: string }> = [];
  let next = start; let omitted = 0;
  while (next < filtered.length && page.length < limit) {
    const device = filtered[next++];
    if (device.deviceId.length > 200) { omitted++; continue; }
    const candidate = { device_id: device.deviceId,
      kind: device.kind === 'videoinput' ? 'camera' : 'microphone', label: device.label.slice(0, 100) };
    if (JSON.stringify({ devices: [...page, candidate] }).length > 1100) { next--; break; }
    page.push(candidate);
  }
  await context.transition(operation.operation_id, 'completed', {
    devices: page, next_cursor: next < filtered.length ? String(next) : '', omitted_count: omitted,
    labels_may_be_hidden: page.some(device => !device.label)
  });
}, deviceListCapability);

registerBrowserOperation('start_camera', async (context, request, operation) => {
  const source = await openUserMedia(context, 'camera', request.arguments, operation);
  await context.transition(operation.operation_id, 'running');
  await context.transition(operation.operation_id, 'completed', settingsFor(source));
}, () => capability('camera'), { waitingForUser: true });

registerBrowserOperation('start_microphone', async (context, request, operation) => {
  const source = await openUserMedia(context, 'microphone', request.arguments, operation);
  await context.transition(operation.operation_id, 'running');
  await context.transition(operation.operation_id, 'completed', settingsFor(source));
}, () => capability('microphone'), { waitingForUser: true });

registerBrowserOperation('capture_camera', async (context, request, operation) => {
  const source = chosenSource(context, 'camera', String(request.arguments.source_id));
  await captureStill(context, operation, source, request.arguments.save_to as string | null,
    Number(request.arguments.max_size), 15);
}, () => capability('camera'));

registerBrowserOperation('stop_source', async (context, request, operation) => {
  const source = context.source(String(request.arguments.source_id));
  await context.endSource(source.sourceId, 'source_ended');
  await context.transition(operation.operation_id, 'completed', { source_id: source.sourceId, stopped: true });
}, () => ({ available: true }));

registerBrowserOperation('start_recording', async (context, request, operation) => {
  const source = context.source(String(request.arguments.source_id));
  await startRecordedOperation(context, operation, source, request.arguments.save_to as string | null,
    Number(request.arguments.duration));
}, () => recordingCapability());

registerBrowserOperation('pause_recording', async (context, request, operation) => {
  const target = String(request.arguments.operation_id);
  const handle = recordingHandle(context, target);
  handle.pause();
  await context.transition(target, 'paused');
  await context.transition(operation.operation_id, 'completed', { target_operation_id: target, paused: true,
    tracks_remain_live: true });
}, () => ({ available: typeof MediaRecorder !== 'undefined' }));

registerBrowserOperation('resume_recording', async (context, request, operation) => {
  const target = String(request.arguments.operation_id);
  const handle = recordingHandle(context, target);
  handle.resume();
  await context.transition(target, 'running');
  await context.transition(operation.operation_id, 'completed', { target_operation_id: target, resumed: true });
}, () => ({ available: typeof MediaRecorder !== 'undefined' }));

registerBrowserOperation('stop_recording', async (context, request, operation) => {
  const target = String(request.arguments.operation_id);
  const before = await context.status(target);
  if (before.status === 'completed') {
    await context.transition(operation.operation_id, 'completed', { target_operation_id: target,
      target_status: 'completed', already_stopped: true });
    return;
  }
  await stopRecordingHandle(context, target, 'user');
  const current = await context.status(target);
  await context.transition(operation.operation_id, 'completed', { target_operation_id: target,
    target_status: current.status });
}, () => ({ available: typeof MediaRecorder !== 'undefined' }));

async function convenience(context: BrowserOperationContext, request: { name: string; arguments: Record<string, unknown> },
  operation: BrowserOperationStatus, kind: 'camera' | 'microphone'): Promise<void> {
  const source = await openUserMedia(context, kind, request.arguments, operation);
  const unsubscribe = context.onStatus(status => {
    if (status.operation_id === operation.operation_id && terminal.has(status.status)) {
      unsubscribe();
      void context.endSource(source.sourceId, 'cancelled');
    }
  });
  await context.transition(operation.operation_id, 'running');
  try { await startRecordedOperation(context, operation, source,
    request.arguments.save_to as string | null, Number(request.arguments.duration)); }
  catch (error) { unsubscribe(); await context.endSource(source.sourceId, 'cancelled'); throw error; }
}

registerBrowserOperation('record_camera', async (context, request, operation) => {
  await convenience(context, request, operation, 'camera');
}, () => recordingCapability('camera'), { waitingForUser: true });

registerBrowserOperation('record_microphone', async (context, request, operation) => {
  await convenience(context, request, operation, 'microphone');
}, () => recordingCapability('microphone'), { waitingForUser: true });

registerBrowserOperation('read_audio_levels', async (context, request, operation) => {
  const source = context.source(String(request.arguments.source_id));
  await context.transition(operation.operation_id, 'completed', await audioLevels(source,
    Number(request.arguments.window_ms)));
}, () => ({ available: Boolean(window.AudioContext) }));

registerBrowserOperation('setup_share', async (context, _request, operation) => {
  const ui = captureUi(context);
  showCaptureControls(ui, capability('screen').available ? 'Click Share screen to choose a display.' :
    'Screen sharing is unavailable here; camera and local media still work.');
  await context.transition(operation.operation_id, 'completed', { share_controls: true,
    screen_available: capability('screen').available });
}, () => ({ available: true }));

registerBrowserOperation('start_share', async (context, request, operation) => {
  requireDevice('screen');
  const ui = captureUi(context);
  showCaptureControls(ui, 'Click Share screen to open the browser chooser.');
  if (ui.pendingShare && ui.pendingShare.operation.operation_id !== operation.operation_id)
    throw new BrowserMediaError('busy', 'A display chooser is already pending.');
  if (ui.pendingShare) return;
  const timer = window.setTimeout(() => {
    if (ui.pendingShare?.operation.operation_id === operation.operation_id) {
      ui.pendingShare = undefined;
      ui.message.textContent = 'Share request timed out. Start it again.';
      void context.transition(operation.operation_id, 'expired', undefined,
        { code: 'timeout', message: 'Share button was not clicked within two minutes.' }).catch(() => undefined);
    }
  }, 120_000);
  ui.pendingShare = { operation, audio: request.arguments.audio === true, timer };
  context.addOperationCleanup(operation.operation_id, () => {
    if (ui.pendingShare?.operation.operation_id === operation.operation_id) {
      window.clearTimeout(ui.pendingShare.timer); ui.pendingShare = undefined;
    }
  });
}, () => capability('screen'), { waitingForUser: true });

async function screenStill(context: BrowserOperationContext, request: { name: string; arguments: Record<string, unknown> },
  operation: BrowserOperationStatus): Promise<void> {
  const source = chosenSource(context, 'screen', String(request.arguments.source_id));
  if (request.name === 'capture_tool')
    await context.transition(operation.operation_id, 'running', {
      model_pixels_attached: false, note: 'Pixels remain local; use attach_media explicitly for model images.'
    });
  await captureStill(context, operation, source, request.arguments.save_to as string | null,
    Number(request.arguments.max_size), Number(request.arguments.timeout));
}

registerBrowserOperation('capture_screen', screenStill, () => capability('screen'));
registerBrowserOperation('capture_tool', screenStill, () => capability('screen'));

registerBrowserOperation('stop_share', async (context, request, operation) => {
  const id = String(request.arguments.source_id);
  const alreadyStopped = id ? context.sourceWasStopped(id, 'screen') :
    context.sourcesOfKind('screen').length === 0 && Boolean(context.uniqueStoppedSourceId('screen'));
  if (alreadyStopped) {
    await context.transition(operation.operation_id, 'completed', {
      source_id: id || context.uniqueStoppedSourceId('screen'), stopped: true, already_stopped: true });
    return;
  }
  const source = chosenSource(context, 'screen', id);
  await context.endSource(source.sourceId, 'source_ended');
  await context.transition(operation.operation_id, 'completed', { source_id: source.sourceId, stopped: true });
}, () => ({ available: true }));
