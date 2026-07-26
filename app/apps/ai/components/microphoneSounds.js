const toneScriptUrl = "https://write.munetios.com/tone.js";

let tonePromise;
let audioNodes;

function loadTone() {
  if (window.Tone) return Promise.resolve(window.Tone);
  if (tonePromise) return tonePromise;

  tonePromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(
      `script[src="${toneScriptUrl}"]`,
    );
    const script = existingScript || document.createElement("script");

    const ready = () => {
      if (window.Tone) resolve(window.Tone);
      else reject(new Error("Tone.js did not load."));
    };

    script.addEventListener("load", ready, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Tone.js failed to load.")),
      {
        once: true,
      },
    );

    if (!existingScript) {
      script.async = true;
      script.src = toneScriptUrl;
      document.head.append(script);
    }
  });

  return tonePromise;
}

function getAudioNodes(Tone) {
  if (audioNodes) return audioNodes;

  const limiter = new Tone.Limiter(-1).toDestination();
  const compressor = new Tone.Compressor({
    attack: 0.01,
    ratio: 3,
    release: 0.2,
    threshold: -18,
  }).connect(limiter);
  const reverb = new Tone.Reverb({ decay: 1.2, wet: 0.12 }).connect(compressor);
  const micSynth = new Tone.PolySynth(Tone.Synth, {
    envelope: { attack: 0.002, decay: 0.08, release: 0.18, sustain: 0 },
    oscillator: { type: "fatsine" },
    volume: -1,
  }).connect(reverb);
  const clickSynth = new Tone.Synth({
    envelope: { attack: 0.001, decay: 0.04, release: 0.1, sustain: 0 },
    oscillator: { type: "triangle" },
    volume: -1,
  }).connect(reverb);

  audioNodes = { clickSynth, micSynth };
  return audioNodes;
}

async function play(type) {
  const Tone = await loadTone();
  if (Tone.context.state !== "running") await Tone.start();

  const { clickSynth, micSynth } = getAudioNodes(Tone);
  micSynth.releaseAll();
  const now = Tone.now();

  if (type === "start") {
    clickSynth.triggerAttackRelease("G5", "64n", now);
    micSynth.triggerAttackRelease("C6", "64n", now + 0.04);
    micSynth.triggerAttackRelease("E6", "32n", now + 0.09);
    micSynth.triggerAttackRelease("G6", "32n", now + 0.14);
    return;
  }

  if (type === "success") {
    micSynth.triggerAttackRelease(["C6", "G6"], "32n", now);
    micSynth.triggerAttackRelease("C7", "32n", now + 0.08);
    return;
  }

  micSynth.triggerAttackRelease("F5", "32n", now);
  micSynth.triggerAttackRelease("D5", "32n", now + 0.05);
  micSynth.triggerAttackRelease("B4", "16n", now + 0.1);
}

export const playMicrophoneStart = () => play("start");
export const playMicrophoneSuccess = () => play("success");
export const playMicrophoneDenied = () => play("denied");
