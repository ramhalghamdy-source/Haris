// HARIS browser-native audio alert system.
// Uses Web Audio API so GitHub Pages needs no external audio file or server.
(() => {
  let audioCtx = null;
  let masterGain = null;
  let compressor = null;
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
      chip.textContent = '🔔 جرس التنبيه · جاهز';
      chip.style.opacity = '1';
    } else {
      chip.textContent = '🔔 جرس التنبيه · مفعّل';
      chip.style.opacity = '1';
    }
  }

  function setupAudioChain() {
    if (!audioCtx || masterGain) return;

    masterGain = audioCtx.createGain();
    compressor = audioCtx.createDynamicsCompressor();

    // Slightly stronger overall output while keeping peaks soft and comfortable.
    masterGain.gain.value = 0.92;
    compressor.threshold.value = -14;
    compressor.knee.value = 20;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.20;

    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);
  }

  function armAudio() {
    if (!enabled || !AudioContextClass) return;
    try {
      if (!audioCtx) audioCtx = new AudioContextClass();
      setupAudioChain();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
      armed = true;
      updateIndicator();
    } catch (_) {
      armed = false;
    }
  }

  function bellPartial(frequency, delay, duration, volume, type = 'sine', detune = 0) {
    if (!enabled || !audioCtx || audioCtx.state !== 'running' || !masterGain) return;

    const start = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    osc.detune.setValueAtTime(detune, start);

    // Fast strike + smooth exponential decay gives a bell-like alarm instead of a harsh beep.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume * 0.34, 0.001), start + 0.10);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(start);
    osc.stop(start + duration + 0.04);
  }

  function bellStrike(frequency, delay = 0, strength = 1, duration = 0.75) {
    // Fundamental plus gentle metallic overtones. Strong enough to notice, not siren-like.
    bellPartial(frequency, delay, duration, 0.082 * strength, 'sine');
    bellPartial(frequency * 2.01, delay + 0.004, duration * 0.72, 0.030 * strength, 'sine', 3);
    bellPartial(frequency * 3.92, delay + 0.007, duration * 0.48, 0.013 * strength, 'triangle', -4);
  }

  function playWarningAlert() {
    armAudio();
    if (!audioCtx || audioCtx.state !== 'running') return;
    // Two calm bell strikes for WARNING.
    bellStrike(720, 0.00, 0.88, 0.68);
    bellStrike(840, 0.48, 0.82, 0.64);
  }

  function playDangerAlert() {
    armAudio();
    if (!audioCtx || audioCtx.state !== 'running') return;
    // Three clearer alarm-bell strikes for DANGER, without a piercing siren tone.
    bellStrike(760, 0.00, 1.00, 0.78);
    bellStrike(760, 0.48, 1.00, 0.78);
    bellStrike(940, 0.96, 1.08, 0.88);
  }

  function playTestTone() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    bellStrike(820, 0, 0.62, 0.42);
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
