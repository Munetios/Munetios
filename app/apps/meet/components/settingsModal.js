"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CustomToggle from "../../../components/customToggle";
import DropdownWrapper from "../../../components/dropdownwrapper";
import LoadingSpinner from "../../../components/loadingSpinner";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { formatUserDateTime } from "../../../lib/dateTimePreferences";
import { playMeetTestAudio, prepareMeetAudio } from "./meetSounds";

const localSettingsKey = "munetios.meet.settings";
const localDevicesKey = "munetios.meet.devices";
const defaults = {
  activitiesSound: true,
  allowOthersJoinActivity: true,
  blockedEmails: [],
  blockedPeople: [],
  contactsOnly: false,
  desktopNotifications: true,
  leaveWhenAlone: false,
  noiseCancellation: true,
  ttsVoice: "",
  useActivities: true,
};
const panels = [
  ["general", "settings", "meetSettingsGeneral"],
  ["history", "history", "meetSettingsCallHistory"],
  ["records", "video_file", "meetSettingsRecords"],
  ["activities", "extension", "meetSettingsActivities"],
];

function Toggle({ checked, description, label, onChange }) {
  return (
    <div className="meet-settings-toggle">
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <CustomToggle checked={checked} label={label} onChange={onChange} />
    </div>
  );
}

function DeviceSelect({ copy, devices, label, onChange, value }) {
  const selected = devices.find((device) => device.deviceId === value);
  return (
    <label className="meet-device-field">
      <span>{label}</span>
      <DropdownWrapper
        align="left"
        ariaLabel={label}
        buttonClassName="meet-device-trigger liquid-glass"
        panelClassName="w-[min(32rem,calc(100vw-2rem))]"
        trigger={
          <>
            <span>{selected?.label || copy.meetDefaultDevice}</span>
            <icon>expand_more</icon>
          </>
        }
      >
        <button
          className="meet-menu-item"
          data-dropdown-close
          onClick={() => onChange("")}
          role="menuitem"
          type="button"
        >
          <icon>
            {value ? "radio_button_unchecked" : "radio_button_checked"}
          </icon>
          <span>{copy.meetDefaultDevice}</span>
        </button>
        {devices.map((device, index) => (
          <button
            className="meet-menu-item"
            data-dropdown-close
            key={device.deviceId}
            onClick={() => onChange(device.deviceId)}
            role="menuitem"
            type="button"
          >
            <icon>
              {value === device.deviceId
                ? "radio_button_checked"
                : "radio_button_unchecked"}
            </icon>
            <span>{device.label || `${label} ${index + 1}`}</span>
          </button>
        ))}
      </DropdownWrapper>
    </label>
  );
}

function VoiceSelect({ copy, onChange, value, voices }) {
  const selected = voices.find((voice) => voice.voiceURI === value);
  const chooseVoice = (voice) => {
    const select = () => onChange(voice?.voiceURI || "");
    if (!voice || voice.localService !== false) {
      select();
      return;
    }
    showModal(
      ({ close }) => (
        <div className="grid gap-4">
          <p className="m-0 text-sm leading-6 text-white/75">
            {copy.meetCloudVoicePrivacyDescription}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              className="min-h-10 rounded-full border border-white/10 bg-white/5 px-4 text-sm font-bold text-white"
              onClick={close}
              type="button"
            >
              {copy.cancel}
            </button>
            <button
              className="min-h-10 rounded-full border border-white/10 bg-[color-mix(in_srgb,var(--accent)_45%,transparent)] px-4 text-sm font-bold text-white"
              onClick={() => {
                select();
                close();
              }}
              type="button"
            >
              {copy.continue}
            </button>
          </div>
        </div>
      ),
      {
        ariaLabel: copy.accountSettingsPrivacy,
        title: copy.accountSettingsPrivacy,
        width: "min(32rem, calc(100vw - 1rem))",
        zIndex: 5400,
      },
    );
  };

  return (
    <label className="meet-device-field">
      <span>{copy.meetTtsVoice}</span>
      <DropdownWrapper
        align="left"
        ariaLabel={copy.meetTtsVoice}
        buttonClassName="meet-device-trigger liquid-glass"
        panelClassName="w-[min(32rem,calc(100vw-2rem))] max-h-80 overflow-y-auto"
        trigger={
          <>
            <span>
              {selected
                ? `${selected.name} (${selected.lang})`
                : copy.meetDefaultDevice}
            </span>
            <icon>expand_more</icon>
          </>
        }
      >
        <button
          className="meet-menu-item"
          data-dropdown-close
          onClick={() => chooseVoice(null)}
          role="menuitem"
          type="button"
        >
          <icon>
            {value ? "radio_button_unchecked" : "radio_button_checked"}
          </icon>
          <span>{copy.meetDefaultDevice}</span>
        </button>
        {voices.map((voice) => (
          <button
            className="meet-menu-item"
            data-dropdown-close
            key={`${voice.voiceURI}-${voice.lang}`}
            onClick={() => chooseVoice(voice)}
            role="menuitem"
            type="button"
          >
            <icon>
              {value === voice.voiceURI
                ? "radio_button_checked"
                : voice.localService === false
                  ? "cloud"
                  : "radio_button_unchecked"}
            </icon>
            <span>{`${voice.name} (${voice.lang})`}</span>
          </button>
        ))}
      </DropdownWrapper>
    </label>
  );
}

function BlockedPeople({
  copy,
  emails,
  onEmailsChange,
  onPeopleChange,
  people,
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [emailItems, setEmailItems] = useState(emails);
  const [peopleItems, setPeopleItems] = useState(people);
  const updateEmails = (next) => {
    setEmailItems(next);
    onEmailsChange(next);
  };
  const updatePeople = (next) => {
    setPeopleItems(next);
    onPeopleChange(next);
  };
  const add = (event) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError(copy.meetInvalidEmail);
      return;
    }
    updateEmails([...new Set([...emailItems, normalized])]);
    setEmail("");
    setError("");
  };
  return (
    <div className="meet-blocked-people">
      <p>{copy.meetBlockedPeopleDescription}</p>
      <form onSubmit={add}>
        <input
          aria-label={copy.meetBlockedEmail}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={copy.meetBlockedEmail}
          type="email"
          value={email}
        />
        <button type="submit">{copy.meetAddBlockedPerson}</button>
      </form>
      {error ? <p className="meet-settings-error">{error}</p> : null}
      {peopleItems.length || emailItems.length
        ? <ul>
            {peopleItems.map((person) => (
              <li key={person.id}>
                <span>{person.name}</span>
                <button
                  onClick={() =>
                    updatePeople(
                      peopleItems.filter((item) => item.id !== person.id),
                    )
                  }
                  type="button"
                >
                  {copy.meetUnblock}
                </button>
              </li>
            ))}
            {emailItems.map((blockedEmail) => (
              <li key={blockedEmail}>
                <span>{blockedEmail}</span>
                <button
                  onClick={() =>
                    updateEmails(
                      emailItems.filter((item) => item !== blockedEmail),
                    )
                  }
                  type="button"
                >
                  {copy.meetUnblock}
                </button>
              </li>
            ))}
          </ul>
        : <p>{copy.meetNoBlockedPeople}</p>}
    </div>
  );
}

function openBlockedPeople(copy, emails, people, onChange) {
  showModal(
    <BlockedPeople
      copy={copy}
      emails={emails}
      onEmailsChange={(blockedEmails) => onChange({ blockedEmails })}
      onPeopleChange={(blockedPeople) => onChange({ blockedPeople })}
      people={people}
    />,
    {
      ariaLabel: copy.meetBlockedPeople,
      title: copy.meetBlockedPeople,
      width: "min(36rem, calc(100vw - 1rem))",
      zIndex: 5200,
    },
  );
}

function formatRecordingSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function RecordingsPanel({ copy, signedIn }) {
  const [payload, setPayload] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    if (!signedIn) return;
    setFailed(false);
    fetch("/api/meet/recordings", {
      cache: "no-store",
      credentials: "include",
    })
      .then((response) => {
        if (!response.ok) throw new Error("recordings_load_failed");
        return response.json();
      })
      .then(setPayload)
      .catch(() => setFailed(true));
  }, [signedIn]);
  useEffect(() => {
    load();
    window.addEventListener("munetios:meetrecordingschange", load);
    return () =>
      window.removeEventListener("munetios:meetrecordingschange", load);
  }, [load]);
  if (!signedIn) {
    return (
      <div className="meet-settings-card">
        <p>{copy.meetRecordingsSignInDescription}</p>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="meet-settings-card">
        <p>{copy.meetRecordingsLoadFailed}</p>
        <button
          className="meet-settings-primary-link"
          onClick={load}
          type="button"
        >
          {copy.retry}
        </button>
      </div>
    );
  }
  if (!payload) {
    return (
      <div className="meet-settings-card">
        <LoadingSpinner label={copy.loading} />
      </div>
    );
  }
  const used = formatRecordingSize(payload.capacity?.usedBytes);
  const limit = formatRecordingSize(payload.capacity?.limitBytes);
  return (
    <div className="meet-settings-stack">
      <section className="meet-settings-card">
        <strong>{copy.storage}</strong>
        <p>
          {used} / {limit} {copy.storageUsed}
        </p>
      </section>
      {payload.recordings.length
        ? <div className="meet-recordings-list">
            {payload.recordings.map((recording) => (
              <article className="meet-settings-card" key={recording.id}>
                <span>
                  <strong>{recording.name}</strong>
                  <small>
                    {formatUserDateTime(recording.createdAt)} ·{" "}
                    {formatRecordingSize(recording.size)}
                  </small>
                </span>
                <div>
                  <a download href={`/api/meet/recordings/${recording.id}`}>
                    <icon>download</icon>
                    {copy.download}
                  </a>
                  <button
                    onClick={async () => {
                      const response = await fetch(
                        `/api/meet/recordings/${recording.id}`,
                        { credentials: "include", method: "DELETE" },
                      ).catch(() => null);
                      if (!response?.ok) {
                        showToast({
                          message: copy.meetRecordingDeleteFailed,
                          type: "error",
                        });
                        return;
                      }
                      load();
                    }}
                    type="button"
                  >
                    <icon>delete</icon>
                    {copy.delete}
                  </button>
                </div>
              </article>
            ))}
          </div>
        : <div className="meet-settings-card">
            <p>{copy.meetNoRecordings}</p>
          </div>}
    </div>
  );
}

function MeetSettingsContent({ copy, signedIn }) {
  const [activePanel, setActivePanel] = useState("general");
  const [settings, setSettings] = useState(defaults);
  const [devices, setDevices] = useState({
    audioinput: [],
    audiooutput: [],
    videoinput: [],
  });
  const [selectedDevices, setSelectedDevices] = useState({
    camera: "",
    microphone: "",
    speaker: "",
  });
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [voices, setVoices] = useState([]);
  const microphoneTestRef = useRef(null);
  const settingsRef = useRef(defaults);
  settingsRef.current = settings;

  const loadDevices = useCallback(async (requestPermission = false) => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    if (requestPermission) {
      const permissionStream = await navigator.mediaDevices
        .getUserMedia({ audio: true, video: true })
        .catch(() => null);
      for (const track of permissionStream?.getTracks() || []) track.stop();
    }
    const available = await navigator.mediaDevices.enumerateDevices();
    setDevices({
      audioinput: available.filter((device) => device.kind === "audioinput"),
      audiooutput: available.filter((device) => device.kind === "audiooutput"),
      videoinput: available.filter((device) => device.kind === "videoinput"),
    });
  }, []);

  useEffect(() => {
    prepareMeetAudio();
    const loadVoices = () =>
      setVoices(window.speechSynthesis?.getVoices() || []);
    loadVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    try {
      setSelectedDevices({
        camera: "",
        microphone: "",
        speaker: "",
        ...JSON.parse(window.localStorage.getItem(localDevicesKey) || "{}"),
      });
    } catch {}
    const loadSettings = () => {
      fetch("/api/meet", { cache: "no-store", credentials: "include" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (payload?.authenticated) {
            setSettings({ ...defaults, ...payload.settings });
            return;
          }
          try {
            setSettings({
              ...defaults,
              ...JSON.parse(
                window.localStorage.getItem(localSettingsKey) || "{}",
              ),
            });
          } catch {}
        })
        .catch(() => undefined);
    };
    loadSettings();
    window.addEventListener("munetios:meetdatachange", loadSettings);
    void loadDevices();
    return () => {
      window.removeEventListener("munetios:meetdatachange", loadSettings);
      window.speechSynthesis?.removeEventListener?.(
        "voiceschanged",
        loadVoices,
      );
    };
  }, [loadDevices]);

  useEffect(
    () => () => {
      microphoneTestRef.current?.stop();
    },
    [],
  );

  const persist = async (next) => {
    settingsRef.current = next;
    setSettings(next);
    if (!signedIn) {
      window.localStorage.setItem(localSettingsKey, JSON.stringify(next));
      window.dispatchEvent(new Event("munetios:meetdatachange"));
      return;
    }
    const response = await fetch("/api/meet", {
      body: JSON.stringify({ settings: next }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    }).catch(() => null);
    if (!response?.ok) {
      showToast({ message: copy.meetSaveFailed, type: "error" });
      return;
    }
    window.dispatchEvent(new Event("munetios:meetdatachange"));
  };
  const update = (patch) => void persist({ ...settingsRef.current, ...patch });
  const updateDevices = (patch) => {
    const next = { ...selectedDevices, ...patch };
    setSelectedDevices(next);
    window.localStorage.setItem(localDevicesKey, JSON.stringify(next));
  };

  const stopMicrophoneTest = () => {
    microphoneTestRef.current?.stop();
    microphoneTestRef.current = null;
    setTestingMicrophone(false);
    setMicrophoneLevel(0);
  };
  const testMicrophone = async () => {
    if (testingMicrophone) {
      stopMicrophoneTest();
      return;
    }
    const stream = await navigator.mediaDevices
      ?.getUserMedia({
        audio: selectedDevices.microphone
          ? {
              autoGainControl: true,
              deviceId: { exact: selectedDevices.microphone },
              echoCancellation: true,
              noiseSuppression: settings.noiseCancellation,
            }
          : {
              autoGainControl: true,
              echoCancellation: true,
              noiseSuppression: settings.noiseCancellation,
            },
      })
      .catch(() => null);
    if (!stream) {
      showToast({ message: copy.aiMicrophoneDeniedToast, type: "error" });
      return;
    }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    const values = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const updateLevel = () => {
      analyser.getByteFrequencyData(values);
      setMicrophoneLevel(
        Math.min(
          100,
          Math.round(
            values.reduce((sum, value) => sum + value, 0) / values.length,
          ),
        ),
      );
      frame = window.requestAnimationFrame(updateLevel);
    };
    const stop = () => {
      window.cancelAnimationFrame(frame);
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    };
    microphoneTestRef.current = { stop };
    setTestingMicrophone(true);
    updateLevel();
    void loadDevices();
  };

  return (
    <div className="meet-settings-layout">
      <aside aria-label={copy.meetSettingsNav}>
        {panels.map(([id, icon, key]) => (
          <button
            aria-current={activePanel === id ? "page" : undefined}
            className={activePanel === id ? "is-active" : ""}
            key={id}
            onClick={() => setActivePanel(id)}
            type="button"
          >
            <icon>{icon}</icon>
            <span>{copy[key]}</span>
          </button>
        ))}
      </aside>
      <section className="meet-settings-content">
        <h2>{copy[panels.find(([id]) => id === activePanel)?.[2]]}</h2>
        {activePanel === "general"
          ? <div className="meet-settings-stack">
              <section className="meet-settings-card">
                <DeviceSelect
                  copy={copy}
                  devices={devices.audioinput}
                  label={copy.meetMicrophone}
                  onChange={(microphone) => updateDevices({ microphone })}
                  value={selectedDevices.microphone}
                />
                <DeviceSelect
                  copy={copy}
                  devices={devices.videoinput}
                  label={copy.meetCamera}
                  onChange={(camera) => updateDevices({ camera })}
                  value={selectedDevices.camera}
                />
                <DeviceSelect
                  copy={copy}
                  devices={devices.audiooutput}
                  label={copy.meetSpeaker}
                  onChange={(speaker) => updateDevices({ speaker })}
                  value={selectedDevices.speaker}
                />
                <VoiceSelect
                  copy={copy}
                  onChange={(ttsVoice) => update({ ttsVoice })}
                  value={settings.ttsVoice}
                  voices={voices}
                />
                <div className="meet-device-tests">
                  <button
                    onClick={() =>
                      playMeetTestAudio(selectedDevices.speaker).catch(() =>
                        showToast({
                          message: copy.meetAudioTestFailed,
                          type: "error",
                        }),
                      )
                    }
                    type="button"
                  >
                    <icon>volume_up</icon>
                    {copy.meetTestAudio}
                  </button>
                  <button onClick={testMicrophone} type="button">
                    <icon>{testingMicrophone ? "stop" : "mic"}</icon>
                    {testingMicrophone
                      ? copy.meetStopTest
                      : copy.meetTestMicrophone}
                  </button>
                </div>
                {testingMicrophone
                  ? <div
                      aria-label={copy.meetTestingMicrophone}
                      aria-valuemax="100"
                      aria-valuemin="0"
                      aria-valuenow={microphoneLevel}
                      className="meet-microphone-meter"
                      role="progressbar"
                    >
                      <span style={{ width: `${microphoneLevel}%` }} />
                    </div>
                  : null}
              </section>
              <section className="meet-settings-card">
                <Toggle
                  checked={settings.noiseCancellation}
                  description={copy.meetNoiseCancellationDescription}
                  label={copy.meetNoiseCancellation}
                  onChange={(noiseCancellation) =>
                    update({ noiseCancellation })
                  }
                />
                <Toggle
                  checked={settings.leaveWhenAlone}
                  description={copy.meetLeaveWhenAloneDescription}
                  label={copy.meetLeaveWhenAlone}
                  onChange={(leaveWhenAlone) => update({ leaveWhenAlone })}
                />
                <Toggle
                  checked={settings.contactsOnly}
                  label={copy.meetContactsOnly}
                  onChange={(contactsOnly) => update({ contactsOnly })}
                />
                <Toggle
                  checked={settings.desktopNotifications}
                  label={copy.meetDesktopNotifications}
                  onChange={async (desktopNotifications) => {
                    if (
                      desktopNotifications &&
                      "Notification" in window &&
                      Notification.permission === "default"
                    ) {
                      const permission = await Notification.requestPermission();
                      update({
                        desktopNotifications: permission === "granted",
                      });
                      return;
                    }
                    update({ desktopNotifications });
                  }}
                />
                <button
                  className="meet-settings-row-button"
                  onClick={() =>
                    openBlockedPeople(
                      copy,
                      settings.blockedEmails,
                      settings.blockedPeople,
                      update,
                    )
                  }
                  type="button"
                >
                  <span>
                    <strong>{copy.meetBlockedPeople}</strong>
                    <small>{copy.meetViewBlockedPeople}</small>
                  </span>
                  <icon>chevron_right</icon>
                </button>
              </section>
            </div>
          : activePanel === "history"
            ? <div className="meet-settings-card">
                <p>{copy.meetCallHistoryDescription}</p>
                <a
                  className="meet-settings-primary-link"
                  href="/apps/meet/history"
                >
                  {copy.meetOpenCallHistory}
                </a>
              </div>
            : activePanel === "activities"
              ? <div className="meet-settings-card">
                  <Toggle
                    checked={settings.useActivities}
                    label={copy.meetUseActivities}
                    onChange={(useActivities) => update({ useActivities })}
                  />
                  <Toggle
                    checked={settings.allowOthersJoinActivity}
                    label={copy.meetAllowJoinActivity}
                    onChange={(allowOthersJoinActivity) =>
                      update({ allowOthersJoinActivity })
                    }
                  />
                  <Toggle
                    checked={settings.activitiesSound}
                    label={copy.meetActivitiesSound}
                    onChange={(activitiesSound) => update({ activitiesSound })}
                  />
                </div>
              : <RecordingsPanel copy={copy} signedIn={signedIn} />}
      </section>
    </div>
  );
}

export function openMeetSettingsModal({ copy, signedIn }) {
  showModal(<MeetSettingsContent copy={copy} signedIn={signedIn} />, {
    ariaLabel: copy.settings,
    contentClassName: "overflow-hidden",
    height: "min(46rem, calc(100dvh - 1rem))",
    title: copy.settings,
    width: "min(64rem, calc(100vw - 1rem))",
  });
}
