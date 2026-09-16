// HARIS browser-native persistent audio alert system.
// Uses Web Audio API so GitHub Pages needs no external audio file or server.
(() => {
  let audioCtx = null;
  let masterGain = null;
  let compressor = null;
  let enabled = true;
  let armed = false;
  let activeSeverity = 'normal';
  let lastRingAt = 0;
  const activeOscillators = new Set();

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
          lastRingAt = 0;
          persistentAlarmLoop();
        } else {
          stopActiveTones();
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
    } else if (activeSeverity === 'danger') {
      chip.textContent = '🔔 إنذار نشط · خطر';
      chip.style.opacity = '1';
    } else if (activeSeverity === 'warning') {
      chip.textContent = '🔔 إنذار نشط · تحذير';
      chip.style.opacity = '1';
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

    // Noticeable alarm level while keeping peaks comfortable.
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

  function stopActiveTones() {
    for (const osc of activeOscillators) {
      try { osc.stop(); } catch (_) {}
    }
    activeOscillators.clear();
  }

  function bellPartial(frequency, delay, duration, volume, type = 'sine', detune = 0) {
    if (!enabled || !audioCtx || audioCtx.state !== 'running' || !masterGain) return;

    const start = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    osc.detune.setValueAtTime(detune, start);

    // Fast strike + smooth decay gives a bell-like alarm instead of a harsh beep.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(Math.max(volume * 0.34, 0.001), start + 0.10);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(masterGain);
    activeOscillators.add(osc);
    osc.onended = () => activeOscillators.delete(osc);
    osc.start(start);
    osc.stop(start + duration + 0.04);
  }

  function bellStrike(frequency, delay = 0, strength = 1, duration = 0.75) {
    bellPartial(frequency, delay, duration, 0.082 * strength, 'sine');
    bellPartial(frequency * 2.01, delay + 0.004, duration * 0.72, 0.030 * strength, 'sine', 3);
    bellPartial(frequency * 3.92, delay + 0.007, duration * 0.48, 0.013 * strength, 'triangle', -4);
  }

  function playWarningAlert() {
    armAudio();
    if (!audioCtx || audioCtx.state !== 'running') return;
    // Two calm bell strikes. Repeated every few seconds while WARNING remains active.
    bellStrike(720, 0.00, 0.88, 0.68);
    bellStrike(840, 0.48, 0.82, 0.64);
  }

  function playDangerAlert() {
    armAudio();
    if (!audioCtx || audioCtx.state !== 'running') return;
    // Three clearer alarm-bell strikes. Repeated while DANGER remains active.
    bellStrike(760, 0.00, 1.00, 0.78);
    bellStrike(760, 0.48, 1.00, 0.78);
    bellStrike(940, 0.96, 1.08, 0.88);
  }

  function currentSeverity() {
    try {
      if (typeof latest === 'undefined' || !latest || typeof latest !== 'object') return 'normal';
      const readings = Object.values(latest);
      if (readings.some((r) => r && r.status === 'danger')) return 'danger';
      if (readings.some((r) => r && r.status === 'warning')) return 'warning';
      return 'normal';
    } catch (_) {
      return 'normal';
    }
  }

  function persistentAlarmLoop() {
    const severity = currentSeverity();

    if (severity !== activeSeverity) {
      activeSeverity = severity;
      lastRingAt = 0; // ring immediately on a new severity or escalation.
      if (severity === 'normal') stopActiveTones();
      updateIndicator();
    }

    // The alarm stops only when every monitored line returns to NORMAL or sound is muted.
    if (!enabled || !armed || severity === 'normal') return;

    const now = performance.now();
    // Warning stays noticeable but calm; danger repeats more urgently.
    const repeatMs = severity === 'danger' ? 2400 : 3600;
    if (now - lastRingAt >= repeatMs || lastRingAt === 0) {
      lastRingAt = now;
      if (severity === 'danger') playDangerAlert();
      else playWarningAlert();
    }
  }

  // Browsers require a user gesture before sound can play. Clicking a demo fault button
  // arms the AudioContext, after which the bell continues until the fault is resolved.
  document.addEventListener('pointerdown', armAudio, { passive: true });
  document.addEventListener('keydown', armAudio, { passive: true });

  window.addEventListener('DOMContentLoaded', () => {
    updateIndicator();
    setInterval(persistentAlarmLoop, 180);
  });
})();
