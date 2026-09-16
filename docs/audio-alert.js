// HARIS browser-native audio alert system.
// Uses Web Audio API so GitHub Pages needs no external audio file or server.
(() => {
  let audioCtx = null;
  let enabled = true;
  let armed = false;
  let lastEventKey = '';

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  function updateIndicator() {
    let chip = document.getElementById('soundStatus');
    if (!chip) {
      const controls = document.querySelector('.controls');
      if (!controls) return;
      chip = document.createElement('div');
      chip.id = 'soundStatus';
      chip.className = 'chip';
      chip.style.cursor = 'pointer';
      chip.style.userSelect = 'none';
      chip.title = 'اضغطي لكتم أو تشغيل صوت التنبيه';
      chip.addEventListener('click', (event) => {
        event.stopPropagation();
        enabled = !enabled;
        if (enabled) {
          armAudio();
          playTestTone();
        }
        updateIndicator();
      });
      controls.prepend(chip);
    }

    if (!AudioContextClass) {
      chip.textContent = '🔇 SOUND UNSUPPORTED';
      chip.style.opacity = '.55';
      return;
    }

    if (!enabled) {
      chip.textContent = '🔇 الصوت مكتوم';
      chip.style.opacity = '.65';
    } else if (!armed) {
      chip.textContent = '🔊 صوت التنبيه · جاهز';
      chip.style.opacity = '1';
    } else {
      chip.textContent = '🔊 صوت التنبيه · مفعّل';
      chip.style.opacity = '1';
    }
  }

  function armAudio() {
    if (!enabled || !AudioContextClass) return;
    try {
      if (!audioCtx) audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      armed = true;
      updateIndicator();
    } catch (_) {
      armed = false;
    }
  }

  function tone(frequency, delay, duration, volume = 0.055, type = 'sine') {
    if (!enabled || !audioCtx || audioCtx.state !== 'running') return;

    const start = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  function playWarningAlert() {
    armAudio();
    if (!audioCtx || audioCtx.state !== 'running') return;
    tone(880, 0.00, 0.18, 0.05, 'sine');
    tone(660, 0.23, 0.22, 0.055, 'sine');
  }

  function playDangerAlert() {
    armAudio();
    if (!audioCtx || audioCtx.state !== 'running') return;
    tone(740, 0.00, 0.18, 0.065, 'square');
    tone(740, 0.25, 0.18, 0.065, 'square');
    tone(980, 0.50, 0.34, 0.075, 'square');
  }

  function playTestTone() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    tone(720, 0, 0.12, 0.03, 'sine');
  }

  function eventKey(event) {
    if (!event) return '';
    return [event.timestamp, event.branch, event.kind, event.status, event.fault_type].join('|');
  }

  function watchEvents() {
    try {
      if (typeof events === 'undefined' || !Array.isArray(events) || !events.length) return;
      const event = events[0];
      const key = eventKey(event);
      if (!key || key === lastEventKey) return;

      // Mark first so an old event never plays later just because audio became available.
      lastEventKey = key;

      if (event.kind === 'اكتشاف') {
        if (event.status === 'danger') playDangerAlert();
        else playWarningAlert();
      } else if (event.kind === 'تصاعد') {
        playDangerAlert();
      }
    } catch (_) {
      // Audio is non-critical; monitoring must continue even if a browser blocks sound.
    }
  }

  // Browsers require a user gesture before sound can play. The first click/tap/key press
  // arms the AudioContext. In the demo, clicking any fault button is enough.
  document.addEventListener('pointerdown', armAudio, { passive: true });
  document.addEventListener('keydown', armAudio, { passive: true });

  window.addEventListener('DOMContentLoaded', () => {
    updateIndicator();
    setInterval(watchEvents, 180);
  });
})();
