let audioGraphPromise;
let toneModulePromise;

function loadTone() {
  if (!toneModulePromise) {
    toneModulePromise = import("tone/build/esm/index.js");
  }
  return toneModulePromise;
}

export function prepareMeetAudio() {
  void loadTone();
}

async function createAudioGraph() {
  const Tone = await loadTone();
  await Tone.start();
  await Tone.getContext().resume();
  Tone.Destination.mute = false;

  const limiter = new Tone.Limiter(-1).toDestination();
  const compressor = new Tone.Compressor({
    attack: 0.003,
    ratio: 4,
    release: 0.12,
    threshold: -12,
  }).connect(limiter);
  const glassReverb = new Tone.Reverb({
    decay: 2.65,
    preDelay: 0.016,
    wet: 0.36,
  }).connect(compressor);
  const brightReverb = new Tone.Reverb({
    decay: 3.2,
    preDelay: 0.022,
    wet: 0.32,
  }).connect(compressor);
  await Promise.all([glassReverb.ready, brightReverb.ready]);
  const glassDelay = new Tone.FeedbackDelay({
    delayTime: "32n",
    feedback: 0.14,
    wet: 0.12,
  }).connect(glassReverb);
  const shimmerDelay = new Tone.PingPongDelay({
    delayTime: "16n",
    feedback: 0.12,
    wet: 0.13,
  }).connect(brightReverb);
  const bassDelay = new Tone.FeedbackDelay({
    delayTime: "64n",
    feedback: 0.08,
    wet: 0.08,
  }).connect(glassReverb);
  const voiceDelay = new Tone.PingPongDelay({
    delayTime: "32n",
    feedback: 0.18,
    wet: 0.16,
  }).connect(brightReverb);

  return {
    bassVolume: new Tone.Volume(-3).connect(bassDelay),
    masterVolume: new Tone.Volume(0).connect(glassDelay),
    noiseVolume: new Tone.Volume(-12).connect(glassReverb),
    shimmerVolume: new Tone.Volume(-4).connect(shimmerDelay),
    Tone,
    voiceVolume: new Tone.Volume(-1).connect(voiceDelay),
  };
}

async function getAudioGraph(speakerId = "") {
  if (!audioGraphPromise) {
    audioGraphPromise = createAudioGraph().catch((error) => {
      audioGraphPromise = null;
      throw error;
    });
  }
  const graph = await audioGraphPromise;
  await graph.Tone.start();
  await graph.Tone.getContext().resume();
  const rawContext = graph.Tone.getContext().rawContext;
  if (speakerId && typeof rawContext?.setSinkId === "function") {
    try {
      await rawContext.setSinkId(speakerId);
    } catch {}
  }
  return graph;
}

function disposeLater(nodes, delay = 1900) {
  window.setTimeout(() => {
    for (const node of nodes) node.dispose();
  }, delay);
}

function createGlassSynth(graph, volume = -1) {
  const { masterVolume, Tone } = graph;
  const synth = new Tone.FMSynth({
    envelope: {
      attack: 0.002,
      decay: 0.34,
      release: 0.3,
      sustain: 0,
    },
    harmonicity: 3.8,
    modulation: { type: "sine" },
    modulationEnvelope: {
      attack: 0.001,
      decay: 0.14,
      release: 0.17,
      sustain: 0,
    },
    modulationIndex: 10,
    oscillator: { type: "sine" },
  }).connect(masterVolume);
  synth.volume.value = volume;
  return synth;
}

function createWarmSynth(graph, volume = -2) {
  const { bassVolume, Tone } = graph;
  const synth = new Tone.Synth({
    envelope: {
      attack: 0.006,
      decay: 0.2,
      release: 0.24,
      sustain: 0.08,
    },
    oscillator: { type: "triangle" },
  }).connect(bassVolume);
  synth.volume.value = volume;
  return synth;
}

function createShimmerSynth(graph, volume = -4) {
  const { shimmerVolume, Tone } = graph;
  const synth = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.26, release: 0.12 },
    frequency: 820,
    harmonicity: 7.5,
    modulationIndex: 20,
    octaves: 1.9,
    resonance: 3200,
  }).connect(shimmerVolume);
  synth.volume.value = volume;
  return synth;
}

function createVoiceSynth(graph, volume = -2) {
  const { Tone, voiceVolume } = graph;
  const synth = new Tone.FMSynth({
    envelope: {
      attack: 0.008,
      decay: 0.28,
      release: 0.3,
      sustain: 0.04,
    },
    harmonicity: 2.4,
    modulation: { type: "sine" },
    modulationEnvelope: {
      attack: 0.004,
      decay: 0.2,
      release: 0.22,
      sustain: 0,
    },
    modulationIndex: 5.5,
    oscillator: { type: "sine" },
  }).connect(voiceVolume);
  synth.volume.value = volume;
  return synth;
}

function glassPing(graph, note, time, duration = "16n", volume = -2) {
  const synth = createGlassSynth(graph, volume);
  synth.triggerAttackRelease(note, duration, time);
  disposeLater([synth]);
}

function warmPing(graph, note, time, duration = "16n", volume = -3) {
  const synth = createWarmSynth(graph, volume);
  synth.triggerAttackRelease(note, duration, time);
  disposeLater([synth], 1600);
}

function voicePing(graph, note, time, duration = "16n", volume = -3) {
  const synth = createVoiceSynth(graph, volume);
  synth.triggerAttackRelease(note, duration, time);
  disposeLater([synth]);
}

function glassShimmer(graph, time, volume = -5) {
  const shimmer = createShimmerSynth(graph, volume);
  shimmer.triggerAttackRelease("32n", time);
  disposeLater([shimmer], 1500);
}

function softNoiseSweep(graph, time, type = "up", volume = -16) {
  const { noiseVolume, Tone } = graph;
  const noise = new Tone.NoiseSynth({
    envelope: {
      attack: 0.008,
      decay: 0.18,
      release: 0.08,
      sustain: 0,
    },
    noise: { type: "pink" },
  });
  const filter = new Tone.Filter({
    Q: 8,
    frequency: type === "up" ? 950 : 680,
    type: "bandpass",
  }).connect(noiseVolume);
  noise.volume.value = volume;
  noise.connect(filter);
  noise.triggerAttackRelease("16n", time);
  filter.frequency.rampTo(type === "up" ? 4400 : 180, 0.24, time);
  disposeLater([noise, filter], 1400);
}

function voiceAirSweep(graph, time, type = "up", volume = -18) {
  const { Tone, voiceVolume } = graph;
  const noise = new Tone.NoiseSynth({
    envelope: {
      attack: 0.012,
      decay: 0.22,
      release: 0.1,
      sustain: 0,
    },
    noise: { type: "white" },
  });
  const filter = new Tone.Filter({
    Q: 10,
    frequency: type === "up" ? 760 : 1600,
    type: "bandpass",
  }).connect(voiceVolume);
  noise.volume.value = volume;
  noise.connect(filter);
  noise.triggerAttackRelease("16n", time);
  filter.frequency.rampTo(type === "up" ? 5200 : 260, 0.28, time);
  disposeLater([noise, filter], 1500);
}

function warningBuzz(graph, time, volume = -8) {
  const { bassVolume, Tone } = graph;
  const synth = new Tone.MonoSynth({
    envelope: {
      attack: 0.004,
      decay: 0.12,
      release: 0.08,
      sustain: 0,
    },
    filter: { Q: 3, rolloff: -24, type: "lowpass" },
    filterEnvelope: {
      attack: 0.002,
      baseFrequency: 180,
      decay: 0.08,
      octaves: 2.2,
      release: 0.06,
      sustain: 0,
    },
    oscillator: { type: "square" },
  }).connect(bassVolume);
  synth.volume.value = volume;
  synth.triggerAttackRelease("C3", "32n", time);
  synth.triggerAttackRelease("B2", "32n", time + 0.08);
  disposeLater([synth], 1300);
}

async function playRecipe(recipe, speakerId = "") {
  const graph = await getAudioGraph(speakerId);
  const now = graph.Tone.now();
  recipe(graph, now);
}

function nativeAudioFallback() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("audio_context_unavailable");
  const context = new AudioContextClass();
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.8);
  gain.connect(context.destination);
  for (const [frequency, offset] of [
    [261.63, 0],
    [329.63, 0.12],
    [392, 0.24],
    [523.25, 0.38],
  ]) {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(context.currentTime + offset);
    oscillator.stop(context.currentTime + offset + 0.24);
  }
  window.setTimeout(() => void context.close(), 1200);
}

export async function playMeetTestAudio(speakerId = "") {
  try {
    await playRecipe((graph, now) => {
      glassPing(graph, "C5", now, "32n", -3);
      glassPing(graph, "E5", now + 0.12, "32n", -3);
      glassPing(graph, "G5", now + 0.24, "32n", -3);
      glassPing(graph, "C6", now + 0.38, "16n", -4);
      glassShimmer(graph, now + 0.39, -6);
    }, speakerId);
  } catch {
    nativeAudioFallback();
  }
}

export async function playAnagramScore(score, speakerId = "") {
  const points = Number(score) || 0;
  const notes =
    points >= 3000
      ? ["C6", "E6", "G6", "C7", "E7", "G7"]
      : points >= 2000
        ? ["G5", "B5", "D6", "G6", "B6"]
        : points >= 1400
          ? ["F5", "A5", "C6", "F6", "A6"]
          : points >= 800
            ? ["E5", "G5", "B5", "E6"]
            : points >= 400
              ? ["D5", "F5", "A5", "D6"]
              : ["C5", "E5", "G5"];
  return playRecipe((graph, now) => {
    notes.forEach((note, index) => {
      glassPing(
        graph,
        note,
        now + index * 0.075,
        index === notes.length - 1 ? "8n" : "32n",
        -3,
      );
    });
    if (points >= 800) glassShimmer(graph, now + notes.length * 0.075, -5);
    if (points >= 1400) {
      softNoiseSweep(graph, now + 0.02, "up", -19);
      warmPing(graph, "F3", now, "8n", -7);
      glassPing(graph, "C7", now + 0.42, "8n", -5);
      glassShimmer(graph, now + 0.46, -3);
    }
    if (points >= 2000) {
      voicePing(graph, "G6", now + 0.22, "8n", -6);
      glassPing(graph, "D7", now + 0.52, "8n", -5);
      glassShimmer(graph, now + 0.57, -2);
    }
    if (points >= 3000) {
      warmPing(graph, "C4", now + 0.12, "4n", -6);
      voicePing(graph, "E7", now + 0.62, "4n", -5);
      glassShimmer(graph, now + 0.68, 0);
    }
  }, speakerId);
}

export const meetSoundEffects = {
  activityEnded: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "D6", now, "32n", -3);
      glassPing(graph, "B5", now + 0.11, "32n", -4);
      glassPing(graph, "G5", now + 0.23, "32n", -5);
      glassPing(graph, "D5", now + 0.36, "16n", -7);
      warmPing(graph, "G3", now + 0.38, "16n", -7);
      softNoiseSweep(graph, now + 0.05, "down", -18);
    }, speakerId),
  activityStarted: (speakerId) =>
    playRecipe((graph, now) => {
      warmPing(graph, "G3", now, "16n", -4);
      glassPing(graph, "D5", now + 0.07, "32n", -3);
      glassPing(graph, "G5", now + 0.16, "32n", -2);
      glassPing(graph, "B5", now + 0.26, "32n", -3);
      glassPing(graph, "D6", now + 0.38, "8n", -5);
      glassShimmer(graph, now + 0.39, -6);
      softNoiseSweep(graph, now + 0.02, "up", -18);
    }, speakerId),
  cameraDenied: (speakerId) =>
    playRecipe((graph, now) => {
      warningBuzz(graph, now, -8);
      glassPing(graph, "G4", now + 0.02, "32n", -1);
      glassPing(graph, "D4", now + 0.11, "32n", -2);
      glassPing(graph, "G3", now + 0.22, "8n", -5);
      softNoiseSweep(graph, now + 0.04, "down", -16);
    }, speakerId),
  cameraOff: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "E5", now, "32n", -2);
      glassPing(graph, "B4", now + 0.09, "32n", -3);
      glassPing(graph, "E4", now + 0.19, "16n", -5);
      softNoiseSweep(graph, now + 0.04, "down", -18);
    }, speakerId),
  cameraOn: (speakerId) =>
    playRecipe((graph, now) => {
      softNoiseSweep(graph, now, "up", -18);
      glassPing(graph, "E5", now + 0.02, "32n", -3);
      glassPing(graph, "B5", now + 0.1, "32n", -2);
      glassPing(graph, "E6", now + 0.18, "16n", -4);
      glassShimmer(graph, now + 0.19, -6);
    }, speakerId),
  error: (speakerId) =>
    playRecipe((graph, now) => {
      warningBuzz(graph, now, -6);
      glassPing(graph, "C4", now + 0.02, "32n", -1);
      glassPing(graph, "G3", now + 0.11, "32n", -2);
      glassPing(graph, "C3", now + 0.22, "8n", -5);
      softNoiseSweep(graph, now + 0.03, "down", -15);
    }, speakerId),
  meetJoin: (speakerId) =>
    playRecipe((graph, now) => {
      warmPing(graph, "C4", now, "16n", -3);
      glassPing(graph, "E5", now + 0.08, "32n", -3);
      glassPing(graph, "G5", now + 0.16, "32n", -2);
      glassPing(graph, "C6", now + 0.26, "32n", -2);
      glassPing(graph, "E6", now + 0.38, "8n", -4);
      glassShimmer(graph, now + 0.39, -5);
      softNoiseSweep(graph, now + 0.03, "up", -18);
    }, speakerId),
  meetLeft: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "E6", now, "32n", -2);
      glassPing(graph, "C6", now + 0.11, "32n", -3);
      glassPing(graph, "G5", now + 0.23, "32n", -4);
      glassPing(graph, "C5", now + 0.36, "8n", -6);
      warmPing(graph, "C4", now + 0.38, "16n", -6);
      softNoiseSweep(graph, now + 0.05, "down", -18);
    }, speakerId),
  message: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "E6", now, "32n", -5);
      glassPing(graph, "A6", now + 0.09, "16n", -4);
      glassShimmer(graph, now + 0.1, -9);
    }, speakerId),
  microphoneDidntHear: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "E5", now, "16n", -2);
      glassPing(graph, "C5", now + 0.13, "16n", -4);
      glassPing(graph, "A4", now + 0.27, "8n", -5);
      softNoiseSweep(graph, now + 0.04, "down", -16);
    }, speakerId),
  microphoneDenied: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "F4", now, "16n", 0);
      glassPing(graph, "C4", now + 0.09, "16n", -1);
      glassPing(graph, "F3", now + 0.2, "8n", -4);
      warningBuzz(graph, now + 0.03, -10);
      softNoiseSweep(graph, now + 0.06, "down", -18);
    }, speakerId),
  microphoneError: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "E4", now, "32n", -2);
      glassPing(graph, "B3", now + 0.1, "32n", -3);
      glassPing(graph, "E3", now + 0.22, "16n", -5);
      glassShimmer(graph, now + 0.08, -8);
      softNoiseSweep(graph, now + 0.04, "down", -18);
    }, speakerId),
  microphoneStart: (speakerId) =>
    playRecipe((graph, now) => {
      softNoiseSweep(graph, now, "up", -17);
      glassPing(graph, "C6", now + 0.02, "32n", -3);
      glassPing(graph, "G6", now + 0.09, "32n", -2);
      glassPing(graph, "C7", now + 0.18, "16n", -4);
      glassShimmer(graph, now + 0.2, -5);
    }, speakerId),
  mute: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "D5", now, "32n", -2);
      glassPing(graph, "A4", now + 0.08, "32n", -3);
      glassPing(graph, "D4", now + 0.18, "16n", -5);
      softNoiseSweep(graph, now + 0.03, "down", -18);
    }, speakerId),
  screenShareDenied: (speakerId) =>
    playRecipe((graph, now) => {
      warningBuzz(graph, now, -7);
      glassPing(graph, "A4", now + 0.02, "32n", -1);
      glassPing(graph, "E4", now + 0.11, "32n", -2);
      glassPing(graph, "A3", now + 0.22, "8n", -5);
      softNoiseSweep(graph, now + 0.05, "down", -16);
    }, speakerId),
  screenShareStart: (speakerId) =>
    playRecipe((graph, now) => {
      warmPing(graph, "C4", now, "16n", -2);
      glassPing(graph, "G5", now + 0.07, "32n", -3);
      glassPing(graph, "C6", now + 0.15, "32n", -2);
      glassPing(graph, "G6", now + 0.26, "8n", -4);
      glassShimmer(graph, now + 0.28, -5);
      softNoiseSweep(graph, now + 0.02, "up", -18);
    }, speakerId),
  screenShareStop: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "G5", now, "32n", -2);
      glassPing(graph, "C5", now + 0.1, "32n", -3);
      glassPing(graph, "G4", now + 0.22, "16n", -5);
      warmPing(graph, "C4", now + 0.24, "16n", -5);
      softNoiseSweep(graph, now + 0.04, "down", -18);
    }, speakerId),
  success: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "G5", now, "32n", -3);
      glassPing(graph, "C6", now + 0.08, "32n", -2);
      glassPing(graph, "E6", now + 0.16, "32n", -2);
      glassPing(graph, "G6", now + 0.27, "8n", -4);
      glassShimmer(graph, now + 0.28, -5);
    }, speakerId),
  testAudio: playMeetTestAudio,
  unmute: (speakerId) =>
    playRecipe((graph, now) => {
      softNoiseSweep(graph, now, "up", -18);
      glassPing(graph, "D5", now + 0.02, "32n", -3);
      glassPing(graph, "A5", now + 0.1, "32n", -2);
      glassPing(graph, "D6", now + 0.19, "16n", -4);
      glassShimmer(graph, now + 0.21, -6);
    }, speakerId),
  userJoin: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "A5", now, "32n", -4);
      glassPing(graph, "C6", now + 0.08, "32n", -3);
      glassPing(graph, "E6", now + 0.18, "16n", -4);
      glassShimmer(graph, now + 0.19, -7);
    }, speakerId),
  userLeft: (speakerId) =>
    playRecipe((graph, now) => {
      glassPing(graph, "E6", now, "32n", -3);
      glassPing(graph, "C6", now + 0.11, "32n", -4);
      glassPing(graph, "A5", now + 0.23, "16n", -6);
      softNoiseSweep(graph, now + 0.04, "down", -19);
    }, speakerId),
  voiceModeAiResponding: (speakerId) =>
    playRecipe((graph, now) => {
      voicePing(graph, "E5", now, "32n", -5);
      voicePing(graph, "G5", now + 0.09, "32n", -4);
      voicePing(graph, "B5", now + 0.18, "32n", -4);
      voicePing(graph, "G5", now + 0.29, "32n", -5);
      voicePing(graph, "E6", now + 0.42, "16n", -6);
      voiceAirSweep(graph, now + 0.03, "up", -23);
    }, speakerId),
  voiceModeAiResponseFailed: (speakerId) =>
    playRecipe((graph, now) => {
      voicePing(graph, "E4", now, "32n", -2);
      voicePing(graph, "B3", now + 0.1, "32n", -3);
      voicePing(graph, "G3", now + 0.2, "32n", -5);
      voicePing(graph, "E3", now + 0.32, "16n", -7);
      voiceAirSweep(graph, now + 0.04, "down", -18);
      glassShimmer(graph, now + 0.09, -10);
    }, speakerId),
  voiceModeChanged: (speakerId) =>
    playRecipe((graph, now) => {
      voicePing(graph, "A4", now, "32n", -4);
      voicePing(graph, "D5", now + 0.09, "32n", -3);
      voicePing(graph, "A5", now + 0.18, "32n", -3);
      voicePing(graph, "D6", now + 0.3, "16n", -5);
      glassShimmer(graph, now + 0.31, -7);
    }, speakerId),
  voiceModeConnecting: (speakerId) =>
    playRecipe((graph, now) => {
      voicePing(graph, "A4", now, "32n", -4);
      voicePing(graph, "C5", now + 0.11, "32n", -5);
      voicePing(graph, "E5", now + 0.22, "32n", -5);
      voicePing(graph, "C5", now + 0.33, "32n", -6);
      voicePing(graph, "A4", now + 0.44, "16n", -7);
      voiceAirSweep(graph, now + 0.05, "up", -21);
      glassShimmer(graph, now + 0.48, -9);
    }, speakerId),
  voiceModeFailed: (speakerId) =>
    playRecipe((graph, now) => {
      voicePing(graph, "D5", now, "32n", -3);
      voicePing(graph, "A4", now + 0.1, "32n", -4);
      voicePing(graph, "F4", now + 0.22, "16n", -5);
      glassPing(graph, "D5", now + 0.04, "32n", -5);
      glassShimmer(graph, now + 0.12, -8);
      voiceAirSweep(graph, now + 0.05, "down", -20);
    }, speakerId),
  voiceModeStart: (speakerId) =>
    playRecipe((graph, now) => {
      voiceAirSweep(graph, now, "up", -19);
      voicePing(graph, "C5", now + 0.02, "32n", -3);
      voicePing(graph, "G5", now + 0.1, "32n", -2);
      voicePing(graph, "C6", now + 0.2, "16n", -3);
      glassShimmer(graph, now + 0.21, -6);
    }, speakerId),
  voiceModeStop: (speakerId) =>
    playRecipe((graph, now) => {
      voicePing(graph, "C6", now, "32n", -3);
      voicePing(graph, "G5", now + 0.1, "32n", -4);
      voicePing(graph, "C5", now + 0.22, "16n", -6);
      voiceAirSweep(graph, now + 0.04, "down", -20);
    }, speakerId),
};
