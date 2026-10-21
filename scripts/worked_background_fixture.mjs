// An owned canvas is the only display source allowed by the background runner.
// No operating-system surface, camera, microphone or clipboard is accessed.
export async function installBackgroundFixture(context) {
  await context.addInitScript(() => {
    // Keep transient Jupyter toasts from covering the owned confirmation controls.
    // Completion is checked through notebook state and actual response events.
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '#react-toastify-container { display: none !important; }';
      document.head.append(style);
    }, { once: true });
    const onStop = (track, cleanup) => {
      let cleaned = false;
      const once = () => { if (!cleaned) { cleaned = true; cleanup(); } };
      const stop = track.stop.bind(track);
      track.stop = () => { stop(); once(); };
      track.addEventListener('ended', once, { once: true });
    };
    const denied = async () => { throw new DOMException('Physical devices are disabled in the background worked example', 'NotAllowedError'); };
    const syntheticDevices = async () => [];
    const syntheticDisplay = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1000; canvas.height = 600;
      const draw = () => {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f4f6fa'; ctx.fillRect(0, 0, 1000, 600);
        ctx.fillStyle = '#172b4d'; ctx.font = 'bold 28px sans-serif';
        ctx.fillText('Disposable search demo — synthetic fixture', 36, 64);
        ctx.font = '20px sans-serif'; ctx.fillText('Search term', 36, 130);
        ctx.fillStyle = '#fff'; ctx.fillRect(36, 150, 610, 60);
        ctx.strokeStyle = '#67758b'; ctx.strokeRect(36, 150, 610, 60);
        ctx.fillStyle = '#172b4d'; ctx.fillText('sample notebook', 54, 188);
        ctx.fillStyle = '#2557a0'; ctx.fillRect(690, 150, 180, 60);
        ctx.fillStyle = '#fff'; ctx.fillText('Search', 735, 188);
        ctx.fillStyle = '#9c2f2f'; ctx.fillText('Search clicked; result panel remains empty.', 36, 272);
        ctx.fillStyle = '#fff'; ctx.fillRect(36, 305, 834, 180);
        ctx.strokeStyle = '#67758b'; ctx.strokeRect(36, 305, 834, 180);
        ctx.fillStyle = '#58677d'; ctx.font = '18px sans-serif';
        ctx.fillText('Illustrative fixture, not an observed product defect.', 36, 550);
      };
      draw();
      const stream = canvas.captureStream(10);
      const timer = setInterval(draw, 100);
      for (const track of stream.getTracks()) onStop(track, () => clearInterval(timer));
      return stream;
    };
    const syntheticUserMedia = async constraints => {
      const stream = constraints?.video ? await syntheticDisplay() : new MediaStream();
      if (constraints?.audio) {
        // A silent audio track is encoded without connecting to the speakers.
        const audio = new AudioContext();
        const destination = audio.createMediaStreamDestination();
        const oscillator = audio.createOscillator();
        const mute = audio.createGain(); mute.gain.value = 0;
        oscillator.connect(mute).connect(destination); oscillator.start();
        for (const track of destination.stream.getAudioTracks()) {
          stream.addTrack(track);
          onStop(track, () => { oscillator.stop(); void audio.close(); });
        }
      }
      return stream;
    };
    const replace = (target, name, implementation) => {
      Object.defineProperty(target, name, { value: implementation, configurable: false, writable: false });
      if (target[name] !== implementation) throw new Error(`Cannot disable native ${name}`);
    };
    replace(navigator.mediaDevices, 'enumerateDevices', syntheticDevices);
    replace(navigator.mediaDevices, 'getDisplayMedia', syntheticDisplay);
    replace(navigator.mediaDevices, 'getUserMedia', syntheticUserMedia);
    if (navigator.clipboard) {
      for (const name of ['read', 'readText', 'write', 'writeText']) {
        replace(navigator.clipboard, name, denied);
      }
    }
    window.__nbinlineaiBackgroundFixtureReady = true;
  });
}

export async function assertBackgroundFixture(page) {
  if (!await page.evaluate(() => window.__nbinlineaiBackgroundFixtureReady === true)) {
    throw new Error("Background fixture did not install; refusing notebook execution");
  }
}
