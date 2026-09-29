# Worked notebook execution record

This is an in-progress record for the opt-in worked gallery. Execution uses an
isolated JupyterLab on port 8897, one owned Chromium context, the normally
configured nbinlineai ChatGPT subscription, and disposable notebooks. The
published examples must retain observed outputs and tool-call evidence; an
accepted browser-operation receipt alone does not establish completion.

## Camera

Camera capture remains unverified. In an earlier real `start_camera` attempt,
the browser action stayed `waiting_for_user` until its server receipt expired.
That receipt did not contain a captured still or video.

On 2026-09-29, a separate bounded diagnostic used installed Chrome with a
fresh profile and origin-scoped camera permission on the owned isolated
JupyterLab. The browser reported camera permission `granted` and one video
input, but both `getUserMedia({video: true, audio: false})` and the default
ideal-facing constraint remained unresolved for 20 seconds each. Neither
returned a stream or a DOM exception. The diagnostic stopped any late stream
tracks, closed its browser and server, and left port 8897 free. Only device
kinds and counts were retained; no device labels or identifiers are published.

The worked gallery will mark `start_camera`, `capture_camera`, and
`record_camera` as attempted or dependency-deferred, with no successful camera
claim. Other capture examples will use actual microphone or owned-tab screen
sources. The user offered to troubleshoot the physical camera together later;
no simulated camera result will replace this missing evidence.
