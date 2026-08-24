let Tone;
let limiter;
let compressor;
let reverb;
let delay;
let mainSynth;
let chimeSynth;
let bassSynth;
let micSynth;
let clickSynth;
let cameraSynth;
let shareSynth;
let connectingSynth;
let audioGraphPromise;

async function initializeAudioGraph() {
  if (!audioGraphPromise) {
    audioGraphPromise = import("tone/build/esm/index.js").then((toneModule) => {
      Tone = toneModule;
      limiter = new Tone.Limiter(-1).toDestination();
      compressor = new Tone.Compressor({
        attack: 0.01,
        ratio: 3,
        release: 0.25,
        threshold: -18,
      }).connect(limiter);
      reverb = new Tone.Reverb({ decay: 2.5, wet: 0.35 }).connect(compressor);
      delay = new Tone.FeedbackDelay({
        delayTime: 0.12,
        feedback: 0.12,
        wet: 0.12,
      }).connect(reverb);
      mainSynth = new Tone.PolySynth(Tone.Synth, {
        envelope: {
          attack: 0.02,
          decay: 0.25,
          release: 1.2,
          sustain: 0.2,
        },
        oscillator: { type: "triangle8" },
        volume: -11,
      }).connect(delay);
      chimeSynth = new Tone.PolySynth(Tone.Synth, {
        envelope: {
          attack: 0.005,
          decay: 0.2,
          release: 1.5,
          sustain: 0,
        },
        oscillator: { type: "sine" },
        volume: -11,
      }).connect(delay);
      bassSynth = new Tone.Synth({
        envelope: {
          attack: 0.01,
          decay: 0.2,
          release: 0.8,
          sustain: 0,
        },
        oscillator: { type: "sine" },
        volume: -10,
      }).connect(delay);
      micSynth = new Tone.PolySynth(Tone.Synth, {
        envelope: {
          attack: 0.003,
          decay: 0.08,
          release: 0.25,
          sustain: 0,
        },
        oscillator: { type: "sine" },
        volume: -12,
      }).connect(delay);
      clickSynth = new Tone.Synth({
        envelope: {
          attack: 0.001,
          decay: 0.03,
          release: 0.05,
          sustain: 0,
        },
        oscillator: { type: "triangle" },
        volume: -14,
      }).connect(delay);
      cameraSynth = new Tone.PolySynth(Tone.Synth, {
        envelope: { attack: 0.003, decay: 0.1, release: 0.3, sustain: 0 },
        oscillator: { type: "triangle" },
        volume: -12,
      }).connect(delay);
      shareSynth = new Tone.PolySynth(Tone.Synth, {
        envelope: { attack: 0.003, decay: 0.12, release: 0.35, sustain: 0 },
        oscillator: { type: "sine" },
        volume: -12,
      }).connect(delay);
      connectingSynth = new Tone.PolySynth(Tone.Synth, {
        envelope: { attack: 0.006, decay: 0.16, release: 0.42, sustain: 0.08 },
        oscillator: { type: "sine4" },
        volume: -15,
      }).connect(delay);
    });
  }
  await audioGraphPromise;
}

async function unlockAudio() {
  await initializeAudioGraph();
  if (Tone.context.state !== "running") {
    await Tone.start();
  }
}

function stopOldSounds() {
  mainSynth.releaseAll();
  chimeSynth.releaseAll();
  bassSynth.triggerRelease();
  micSynth.releaseAll();
  clickSynth.triggerRelease();
  cameraSynth.releaseAll();
  shareSynth.releaseAll();
  connectingSynth.releaseAll();
}

async function playVoiceModeConnecting() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  connectingSynth.triggerAttackRelease("D5", "32n", now);
  connectingSynth.triggerAttackRelease("A5", "32n", now + 0.07);
  connectingSynth.triggerAttackRelease(["D6", "F6"], "16n", now + 0.16);
  chimeSynth.triggerAttackRelease("A6", "64n", now + 0.28);
}

async function playVoiceModeStart() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  mainSynth.triggerAttackRelease("C5", "16n", now);
  mainSynth.triggerAttackRelease("E5", "16n", now + 0.08);
  mainSynth.triggerAttackRelease("G5", "8n", now + 0.16);
  chimeSynth.triggerAttackRelease("C6", "16n", now + 0.24);
  chimeSynth.triggerAttackRelease("E6", "32n", now + 0.34);
}

async function playVoiceModeStop() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  mainSynth.triggerAttackRelease("G5", "16n", now);
  mainSynth.triggerAttackRelease("E5", "16n", now + 0.08);
  mainSynth.triggerAttackRelease("C5", "8n", now + 0.16);
  bassSynth.triggerAttackRelease("C3", "8n", now + 0.2);
}

async function playVoiceModeDenied() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  mainSynth.triggerAttackRelease("F4", "16n", now);
  mainSynth.triggerAttackRelease("D4", "8n", now + 0.1);
  chimeSynth.triggerAttackRelease("A4", "32n", now + 0.18);
}

async function playVoiceModeError() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();
  // common, clear error/alert: bright major arpeggio with low bass thud

  clickSynth.triggerAttackRelease("A5", "128n", now);

  mainSynth.triggerAttackRelease(["E5", "Bb5"], "32n", now + 0.02);

  mainSynth.triggerAttackRelease(["C5", "G5"], "16n", now + 0.12);

  cameraSynth.triggerAttackRelease(["Eb4", "C4"], "16n", now + 0.18);

  bassSynth.triggerAttackRelease("C3", "4n", now + 0.15);
}
async function playVoiceTypingStart() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  clickSynth.triggerAttackRelease("G5", "64n", now);

  micSynth.triggerAttackRelease("C6", "64n", now + 0.04);

  micSynth.triggerAttackRelease("E6", "32n", now + 0.09);

  micSynth.triggerAttackRelease("G6", "32n", now + 0.14);
}

async function playVoiceTypingSuccess() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  micSynth.triggerAttackRelease(["C6", "G6"], "32n", now);

  micSynth.triggerAttackRelease("C7", "32n", now + 0.08);
}

async function playVoiceTypingStop() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  micSynth.triggerAttackRelease("G6", "64n", now);
  micSynth.triggerAttackRelease("E6", "64n", now + 0.05);
  micSynth.triggerAttackRelease("C6", "32n", now + 0.1);
  clickSynth.triggerAttackRelease("C5", "64n", now + 0.16);
}

async function playVoiceTypingDenied() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  micSynth.triggerAttackRelease("F5", "32n", now);

  micSynth.triggerAttackRelease("D5", "32n", now + 0.05);

  micSynth.triggerAttackRelease("B4", "16n", now + 0.1);
}
async function playCameraStart() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  cameraSynth.triggerAttackRelease("A4", "64n", now);
  cameraSynth.triggerAttackRelease("D5", "64n", now + 0.06);
  cameraSynth.triggerAttackRelease("A5", "32n", now + 0.12);
}

async function playCameraStop() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  cameraSynth.triggerAttackRelease("A5", "64n", now);
  cameraSynth.triggerAttackRelease("D5", "64n", now + 0.06);
  cameraSynth.triggerAttackRelease("A4", "32n", now + 0.12);
}

async function playCameraDenied() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  cameraSynth.triggerAttackRelease("E5", "32n", now);
  cameraSynth.triggerAttackRelease("C5", "32n", now + 0.06);
  bassSynth.triggerAttackRelease("A3", "16n", now + 0.1);
}

async function playShareStart() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  shareSynth.triggerAttackRelease("D5", "64n", now);
  shareSynth.triggerAttackRelease("A5", "64n", now + 0.05);
  shareSynth.triggerAttackRelease("D6", "32n", now + 0.11);
}

async function playShareStop() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  shareSynth.triggerAttackRelease("D6", "64n", now);
  shareSynth.triggerAttackRelease("A5", "64n", now + 0.05);
  shareSynth.triggerAttackRelease("D5", "32n", now + 0.11);
}

async function playShareDenied() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  shareSynth.triggerAttackRelease("F5", "32n", now);
  shareSynth.triggerAttackRelease("C5", "32n", now + 0.06);
  bassSynth.triggerAttackRelease("D3", "16n", now + 0.1);
}
async function playMute() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  micSynth.triggerAttackRelease("G5", "64n", now);
  micSynth.triggerAttackRelease("C5", "32n", now + 0.06);
}

async function playUnmute() {
  await unlockAudio();
  stopOldSounds();

  const now = Tone.now();

  micSynth.triggerAttackRelease("C5", "64n", now);
  micSynth.triggerAttackRelease("G5", "32n", now + 0.06);
}

export {
  playCameraDenied,
  playCameraStart,
  playCameraStop,
  playMute,
  playShareDenied,
  playShareStart,
  playShareStop,
  playUnmute,
  playVoiceModeConnecting,
  playVoiceModeDenied,
  playVoiceModeError,
  playVoiceModeStart,
  playVoiceModeStop,
  playVoiceTypingDenied,
  playVoiceTypingStart,
  playVoiceTypingStop,
  playVoiceTypingSuccess,
};
