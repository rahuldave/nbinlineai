/** Bounded capture metadata and passive device pages for the server result channel. */
import type { BrowserSource } from './browserMediaClient';
import { resultFits } from './browserMediaResultBudget';

export function settingsFor(source: BrowserSource): Record<string, unknown> {
  const video = source.tracks.find(track => track.kind === 'video');
  const audio = source.tracks.find(track => track.kind === 'audio');
  const settings = (video ?? audio)?.getSettings() ?? {};
  const result: Record<string, unknown> = { source_id: source.sourceId, kind: source.kind,
    audio: Boolean(audio), video: Boolean(video) };
  if (settings.deviceId) {
    if (settings.deviceId.length <= 200) result.device_id = settings.deviceId;
    else result.device_id_omitted = true;
  }
  if (settings.facingMode) result.facing = settings.facingMode;
  if (settings.width && Number.isFinite(settings.width)) result.width = settings.width;
  if (settings.height && Number.isFinite(settings.height)) result.height = settings.height;
  if (settings.displaySurface) result.display_surface = settings.displaySurface;
  if (!resultFits(result)) {
    delete result.facing; delete result.display_surface;
    result.settings_truncated = true;
  }
  if (!resultFits(result) && result.device_id) {
    delete result.device_id;
    result.device_id_omitted = true;
  }
  return result;
}

interface ListedDevice { deviceId: string; kind: string; label: string; }
interface DevicePage extends Record<string, unknown> {
  devices: Array<{ device_id: string; kind: string; label: string }>;
  next_cursor: string;
  omitted_count: number;
  labels_may_be_hidden: boolean;
  labels_truncated: boolean;
}
/** Retain exact usable IDs; shorten only labels to fit the server's JSON result budget. */
export function mediaSourcePage(devices: ListedDevice[], start: number, limit: number): DevicePage {
  const page: DevicePage['devices'] = [];
  let next = start; let omitted = 0; let truncated = false;
  const snapshot = (candidate?: DevicePage['devices'][number], candidateNext = next,
    candidateTruncated = truncated): DevicePage => {
    const listed = candidate ? [...page, candidate] : page;
    return { devices: listed, next_cursor: candidateNext < devices.length ? String(candidateNext) : '',
      omitted_count: omitted, labels_may_be_hidden: listed.some(device => !device.label),
      labels_truncated: candidateTruncated };
  };
  while (next < devices.length && page.length < limit) {
    const device = devices[next++];
    if (device.deviceId.length > 200) { omitted++; continue; }
    const fullLabel = device.label.slice(0, 100);
    const kind = device.kind === 'videoinput' ? 'camera' : 'microphone';
    let label = fullLabel;
    let candidate = { device_id: device.deviceId, kind, label };
    if (!resultFits(snapshot(candidate, next, truncated || fullLabel.length < device.label.length))) {
      if (page.length) { next--; break; }
      let low = 0; let high = fullLabel.length; let accepted = -1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        candidate = { device_id: device.deviceId, kind, label: fullLabel.slice(0, middle) };
        if (resultFits(snapshot(candidate, next, true))) { accepted = middle; low = middle + 1; }
        else high = middle - 1;
      }
      if (accepted < 0) {
        omitted++; continue;
      }
      label = fullLabel.slice(0, accepted);
    }
    truncated ||= label.length < device.label.length;
    page.push({ device_id: device.deviceId, kind, label });
  }
  return snapshot();
}
