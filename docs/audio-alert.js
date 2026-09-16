// HARIS browser-native persistent audio alert system.
// The alarm is driven from the rendered dashboard state so it keeps ringing
// as long as ANY branch is in WARNING or DANGER.
(() => {
  let audioCtx = null;
  let masterGain = null;
  let compressor = null;
  let enabled = true;
  let armed = false;
  let activeSeverity = 'normal';
  let nextRingAt = 0;
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
          nextRingAt = 0;
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
      chip.textContent = '🔔 إنذار مستمر · خطر';
      chip.style.opacity = '1';
    } else if (activeSeverity === 'warning') {
      chip.textContent = '🔔 إنذار مستمر · تحذير';
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
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
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
    bellStrike(720, 0.00, 0.88, 0.68);
    bellStrike(840, 0.48, 0.82, 0.64);
  }

  function playDangerAlert() {
    armAudio();
    if (!audioCtx || audioCtx.state !== 'running') return;
    bellStrike(760, 0.00, 1.00, 0.78);
    bellStrike(760, 0.48, 1.00, 0.78);
    bellStrike(940, 0.96, 1.08, 0.88);
  }

  // Read the actual visible card state. This avoids relying on variables from app.js
  // and makes the alarm independent and reliable on GitHub Pages.
  function currentSeverityFromDashboard() {
    if (document.querySelector('.card[data-status="danger"]')) return 'danger';
    if (document.querySelector('.card[data-status="warning"]')) return 'warning';
    return 'normal';
  }

  function persistentAlarmLoop() {
    const severity = currentSeverityFromDashboard();

    if (severity !== activeSeverity) {
      activeSeverity = severity;
      nextRingAt = 0; // ring immediately when a fault appears or escalates
      if (severity === 'normal') stopActiveTones();
      updateIndicator();
    }

    if (!enabled || !armed || severity === 'normal') return;

    const now = Date.now();
    if (nextRingAt === 0 || now >= nextRingAt) {
      if (severity === 'danger') {
        playDangerAlert();
        nextRingAt = now + 2600;
      } else {
        playWarningAlert();
        nextRingAt = now + 3600;
      }
    }
  }

  // Browsers require a user gesture before sound can play. The first click/tap/key press
  // arms the audio engine. Clicking a demo-fault button therefore enables the alarm.
  document.addEventListener('pointerdown', armAudio, { passive: true });
  document.addEventListener('keydown', armAudio, { passive: true });

  window.addEventListener('DOMContentLoaded', () => {
    updateIndicator();
    setInterval(persistentAlarmLoop, 150);
  });
})();
