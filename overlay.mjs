// Adapted from the temporary video-layer architecture in chenyi380/baili-codex.
// This layer owns only its full-screen startup film and removes itself on completion.
export function installIntro(win, sessionId = 'legacy') {
  if (win.top !== win || !win.document.body || !win.document.querySelector('#root')) return { installed: false };
  if (win.__kurumiIntro) return { installed: true, existing: true, sessionId: win.__kurumiIntro.sessionId };
  const doc = win.document;
  const shell = doc.createElement('div');
  shell.id = 'kurumi-intro';
  Object.assign(shell.style, {
    position: 'fixed', inset: '0', zIndex: '2147483647', background: '#02030a',
    display: 'grid', placeItems: 'center', overflow: 'hidden', pointerEvents: 'auto'
  });
  const video = doc.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-label', '时崎狂三 Codex 入场动画');
  video.playsInline = true;
  video.muted = false;
  video.defaultMuted = false;
  video.volume = 0.75;
  video.preload = 'auto';
  Object.assign(video.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
  const skip = doc.createElement('button');
  skip.textContent = '跳过';
  skip.setAttribute('aria-label', '跳过入场动画');
  Object.assign(skip.style, {
    position: 'absolute', right: '24px', bottom: '20px', padding: '7px 12px',
    border: '1px solid #d1a776', borderRadius: '6px', color: '#fff',
    background: 'rgba(10, 8, 16, .55)', font: '14px Segoe UI, sans-serif', cursor: 'pointer'
  });
  shell.append(video, skip);
  doc.body.append(shell);
  let parts = [], objectUrl = null, state = 'receiving', error = '', disposed = false;
  function keydown(e) { if (e.key === 'Escape') { e.preventDefault(); dispose('skipped'); } }
  function dispose(reason = 'removed') {
    if (disposed) return;
    disposed = true;
    state = 'done';
    win.__kurumiIntroResult = { sessionId, state: reason, error, currentTime: video.currentTime,
      width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    video.pause();
    video.removeAttribute('src');
    video.load();
    shell.remove();
    doc.removeEventListener('keydown', keydown, true);
    win.clearTimeout(watchdog);
    if (objectUrl) win.URL.revokeObjectURL(objectUrl);
    if (win.__kurumiIntro === api) delete win.__kurumiIntro;
  }
  function fail(message) { error = String(message); dispose('error'); }
  const watchdog = win.setTimeout(() => fail('Intro watchdog expired'), 30000);
  doc.addEventListener('keydown', keydown, true);
  skip.onclick = () => dispose('skipped');
  video.onended = () => dispose('ended');
  video.onerror = () => fail(video.error?.message || `Film decode failed (${video.error?.code ?? 'unknown'})`);
  video.onplaying = () => { state = 'playing'; };
  const api = {
    installed: true,
    sessionId,
    begin() { parts = []; state = 'receiving'; },
    addChunk(encoded) {
      if (disposed || state !== 'receiving') throw new Error('Intro is not receiving');
      const binary = win.atob(encoded), bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      parts.push(bytes);
    },
    start() {
      if (disposed || !parts.length) throw new Error('Intro film is empty');
      objectUrl = win.URL.createObjectURL(new win.Blob(parts, { type: 'video/mp4' }));
      parts = [];
      video.src = objectUrl;
      video.load();
      video.play().catch(e => fail(e.message));
      state = 'loading';
    },
    status() {
      return { state, error, currentTime: video.currentTime, width: video.videoWidth,
        height: video.videoHeight, readyState: video.readyState, muted: video.muted, duration: video.duration, disposed };
    },
    dispose
  };
  win.__kurumiIntro = api;
  return { installed: true };
}
