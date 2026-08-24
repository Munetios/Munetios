"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const chessGlyphs = {
  bb: "♝",
  bk: "♚",
  bn: "♞",
  bp: "♟",
  bq: "♛",
  br: "♜",
  wb: "♗",
  wk: "♔",
  wn: "♘",
  wp: "♙",
  wq: "♕",
  wr: "♖",
};

function formattedTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function send(type, payload) {
  window.parent.postMessage(
    { payload, source: "munetios-activity", type },
    window.location.origin,
  );
}

function compareWords(left, right) {
  return (
    String(right).length - String(left).length ||
    String(left).localeCompare(String(right), undefined, {
      sensitivity: "base",
    })
  );
}

function orderedActivityPlayers(state) {
  const longestWords = new Map();
  for (const entry of state.submittedWords || []) {
    const current = longestWords.get(entry.peerId) || "";
    if (compareWords(entry.word, current) < 0) {
      longestWords.set(entry.peerId, entry.word);
    }
  }
  return [...state.players].sort(
    (left, right) =>
      Number(right.score || 0) - Number(left.score || 0) ||
      String(longestWords.get(right.peerId) || "").length -
        String(longestWords.get(left.peerId) || "").length ||
      String(left.name).localeCompare(String(right.name), undefined, {
        sensitivity: "base",
      }),
  );
}

function FinalLeaderboard({ copy, localPeerId, state }) {
  const orderedPlayers = orderedActivityPlayers(state);
  const topScore = Number(orderedPlayers[0]?.score || 0);
  const localPlayer = orderedPlayers.find(
    (player) => player.peerId === localPeerId,
  );
  const tiedWinners = orderedPlayers.filter(
    (player) => Number(player.score || 0) === topScore,
  );
  const outcome = !localPlayer
    ? copy.meetActivityEnded
    : Number(localPlayer.score || 0) !== topScore
      ? copy.meetActivityYouLost
      : tiedWinners.length > 1
        ? copy.meetActivityYouTied
        : copy.meetActivityYouWon;
  const longestWordFor = (peerId) =>
    (state.submittedWords || [])
      .filter((entry) => entry.peerId === peerId)
      .map((entry) => entry.word)
      .sort(compareWords)[0] || "—";
  return (
    <section className="activity-results">
      <h2 className="activity-outcome">{outcome}</h2>
      <div className="activity-final-scores">
        {orderedPlayers.slice(0, 2).map((entry, index) => (
          <article
            className={`activity-result-card liquid-glass is-${index === 0 ? "first" : "second"}`}
            key={entry.peerId}
          >
            <span className="activity-result-rank">{index + 1}</span>
            <div>
              <small>
                {index === 0
                  ? copy.meetActivityFirstPlace
                  : copy.meetActivitySecondPlace}
              </small>
              <strong>{entry.name}</strong>
              <small>
                {copy.meetActivityPoints.replace(
                  "{score}",
                  Number(entry.score || 0).toLocaleString(),
                )}
              </small>
              <small>
                {copy.meetActivityLongestWord.replace(
                  "{word}",
                  longestWordFor(entry.peerId),
                )}
              </small>
            </div>
          </article>
        ))}
      </div>
      {state.competitiveEligible === false
        ? <p className="activity-competitive-warning liquid-glass">
            <icon>warning</icon>
            {copy.meetActivityCompetitiveDisabled}
          </p>
        : null}
    </section>
  );
}

async function createMusic(type) {
  const Tone = await import("tone/build/esm/index.js");
  await Tone.start();
  const isChess = type === "chess";
  const isWordHunt = type === "wordhunt";
  const limiter = new Tone.Limiter(-4).toDestination();
  const reverb = new Tone.Reverb({
    decay: isChess ? 5.5 : isWordHunt ? 2.4 : 3.8,
    preDelay: 0.04,
    wet: isWordHunt ? 0.28 : 0.42,
  }).connect(limiter);
  await reverb.ready;
  const filter = new Tone.Filter({
    frequency: isChess ? 1200 : isWordHunt ? 2600 : 1900,
    rolloff: -24,
    type: "lowpass",
  }).connect(reverb);
  const musicVolume = new Tone.Volume(
    isChess ? -23 : isWordHunt ? -24 : -21,
  ).connect(filter);
  const pad = new Tone.PolySynth(Tone.FMSynth, {
    envelope: { attack: 1.1, decay: 1.8, release: 4.5, sustain: 0.28 },
    harmonicity: 1.5,
    modulationIndex: 2.2,
    oscillator: { type: "sine" },
  }).connect(musicVolume);
  const melody = new Tone.Synth({
    envelope: { attack: 0.03, decay: 0.45, release: 1.4, sustain: 0.08 },
    oscillator: { type: "triangle" },
  }).connect(musicVolume);
  const chords = isChess
    ? [
        ["C3", "G3", "B3", "E4"],
        ["A2", "E3", "G3", "C4"],
        ["F2", "C3", "E3", "A3"],
        ["G2", "D3", "F3", "B3"],
      ]
    : isWordHunt
      ? [
          ["D3", "A3", "D4", "F4"],
          ["F3", "C4", "F4", "A4"],
          ["C3", "G3", "C4", "E4"],
          ["G3", "D4", "G4", "B4"],
        ]
      : [
          ["C3", "G3", "C4", "E4"],
          ["D3", "A3", "D4", "F4"],
          ["E3", "B3", "E4", "G4"],
          ["G2", "D3", "G3", "C4"],
        ];
  const melodyNotes = isChess
    ? ["E4", null, "G4", "B4", null, "A4", "G4", null]
    : isWordHunt
      ? ["D5", "F5", "A5", null, "G5", "E5", "C5", "D5", "A4", null, "C5", "E5"]
      : ["G4", "A4", "C5", null, "E5", "D5", "C5", "A4"];
  const chordSequence = new Tone.Sequence(
    (time, chord) => pad.triggerAttackRelease(chord, "1m", time),
    chords,
    "1m",
  );
  const melodySequence = new Tone.Sequence(
    (time, note) => {
      if (note) melody.triggerAttackRelease(note, "8n", time, 0.34);
    },
    melodyNotes,
    isWordHunt ? "8n" : "4n",
  );
  chordSequence.start(0);
  melodySequence.start(isChess ? "2m" : isWordHunt ? "2n" : "1m");
  Tone.Transport.bpm.value = isChess ? 54 : isWordHunt ? 96 : 76;
  Tone.Transport.start();
  return () => {
    chordSequence.dispose();
    melodySequence.dispose();
    pad.dispose();
    melody.dispose();
    musicVolume.dispose();
    filter.dispose();
    reverb.dispose();
    limiter.dispose();
  };
}

function Chess({ activity, copy, localPeerId }) {
  const state = activity.state;
  const [selected, setSelected] = useState(null);
  const player = state.players.find((entry) => entry.peerId === localPeerId);
  const chooseSquare = (index) => {
    if (
      !player ||
      state.ended ||
      (!state.cheats?.customChessRules && state.turn !== player.color)
    ) {
      return;
    }
    if (selected === null) {
      if (state.board[index]?.[0] === player.color[0]) setSelected(index);
      return;
    }
    send("update", { from: selected, to: index });
    setSelected(null);
  };
  const winner = state.players.find(
    (entry) => entry.peerId === state.winnerPeerId,
  );
  const resultState = {
    ...state,
    players: state.players.map((entry) => ({
      ...entry,
      score: entry.peerId === state.winnerPeerId ? 1 : 0,
    })),
  };
  return (
    <main className="activity-game activity-chess">
      <div className="activity-scorebar liquid-glass">
        {state.players.map((entry) => (
          <span
            className={state.turn === entry.color ? "is-current" : ""}
            key={entry.peerId}
          >
            <strong>{entry.name}</strong>
            <small>
              {entry.color === "white"
                ? copy.meetActivityWhite
                : copy.meetActivityBlack}
            </small>
          </span>
        ))}
      </div>
      {!player && !state.ended
        ? <button
            className="activity-primary"
            disabled={!state.allowOthers || state.players.length >= 2}
            onClick={() => send("join")}
            type="button"
          >
            {state.allowOthers
              ? copy.meetActivityJoin
              : copy.meetActivityJoiningDisabled}
          </button>
        : null}
      <div
        className={`activity-chess-board${player?.color === "black" ? " is-flipped" : ""}`}
      >
        {state.board.map((piece, index) => (
          <button
            aria-label={`${copy.meetActivityChessSquare} ${index + 1}`}
            className={[
              selected === index ? "is-selected" : "",
              state.lastMove?.from === index || state.lastMove?.to === index
                ? "is-last-move"
                : "",
            ].join(" ")}
            key={`${Math.floor(index / 8)}-${index % 8}`}
            onClick={() => chooseSquare(index)}
            type="button"
          >
            {piece ? chessGlyphs[piece] : ""}
          </button>
        ))}
      </div>
      {state.check && !state.ended
        ? <output className="activity-status liquid-glass">Check</output>
        : null}
      {state.ended
        ? <>
            <FinalLeaderboard
              copy={copy}
              localPeerId={localPeerId}
              state={resultState}
            />
            <p className="activity-result liquid-glass">
              {winner
                ? copy.meetActivityChessWinner.replace("{name}", winner.name)
                : copy.meetActivityEnded}
            </p>
          </>
        : null}
      {activity.ownerPeerId === localPeerId && !state.ended
        ? <button
            className="activity-secondary"
            onClick={() => send("end")}
            type="button"
          >
            {copy.meetActivityEnd}
          </button>
        : null}
    </main>
  );
}

function _FinalWords({ copy, state }) {
  if (!state.ended) return null;
  const playerNames = new Map(
    state.players.map((player) => [player.peerId, player.name]),
  );
  return (
    <section className="activity-final-words liquid-glass">
      <h3>{copy.meetActivityFinalWords}</h3>
      {state.submittedWords?.length
        ? <div>
            {state.submittedWords.map((entry, index) => (
              <span
                className="is-valid"
                key={`${entry.peerId}-${entry.word}-${index}`}
              >
                <strong>{entry.word}</strong>
                <small>
                  {playerNames.get(entry.peerId) || copy.meetParticipant} · +
                  {Number(entry.score || 0).toLocaleString()}
                </small>
              </span>
            ))}
          </div>
        : <p>{copy.meetActivityNoWords}</p>}
    </section>
  );
}

function PlayerWordsList({ copy, state }) {
  if (!state.ended) return null;
  const players = orderedActivityPlayers(state).map((player) => ({
    ...player,
    words: [
      ...new Set(
        (state.submittedWords || [])
          .filter((entry) => entry.peerId === player.peerId)
          .map((entry) => String(entry.word || "").trim())
          .filter(Boolean),
      ),
    ].sort(compareWords),
  }));
  return (
    <section className="activity-player-words liquid-glass">
      <h3>{copy.meetActivityFinalWords}</h3>
      <div className="activity-player-word-cards">
        {players.map((player) => (
          <article key={player.peerId}>
            <header>
              <strong>{player.name}</strong>
              <small>
                {copy.meetActivityPoints.replace(
                  "{score}",
                  Number(player.score || 0).toLocaleString(),
                )}
              </small>
            </header>
            {player.words.length
              ? <div className="activity-player-word-list">
                  {player.words.map((word) => (
                    <span key={word}>
                      <strong>{word}</strong>
                      <small>{word.length}</small>
                    </span>
                  ))}
                </div>
              : <p>{copy.meetActivityNoWords}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

function AllWordsReveal({ copy, state }) {
  const automaticallyRevealed = Boolean(state.cheats?.alwaysShowAllWords);
  const [revealed, setRevealed] = useState(automaticallyRevealed);
  const revealAvailable = Boolean(state.endedByTimer || automaticallyRevealed);
  if (!revealAvailable) return null;
  const words = [...(state.allWords || [])].sort(compareWords);
  return (
    <section className="activity-final-words liquid-glass">
      <header>
        <h3>{copy.meetActivityAllWords}</h3>
        <button
          className="activity-reveal-words"
          onClick={() => setRevealed((current) => !current)}
          type="button"
        >
          <icon>{revealed ? "visibility_off" : "visibility"}</icon>
          {revealed
            ? copy.meetActivityHideAllWords
            : copy.meetActivityRevealAllWords}
        </button>
      </header>
      {revealed
        ? words.length
          ? <div className="activity-all-words">
              {words.map((word) => (
                <span key={word}>
                  <strong>{word}</strong>
                  <small>{word.length}</small>
                </span>
              ))}
            </div>
          : <p>{copy.meetActivityNoWords}</p>
        : null}
    </section>
  );
}

function Anagrams({ activity, copy, localPeerId }) {
  const state = activity.state;
  const [word, setWord] = useState("");
  const [now, setNow] = useState(Date.now());
  const player = state.players.find((entry) => entry.peerId === localPeerId);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const secondsLeft = Math.max(0, (Number(state.endsAt) - now) / 1000);
  const ended = state.ended || secondsLeft <= 0;
  const orderedPlayers = useMemo(
    () => (ended ? orderedActivityPlayers(state) : state.players),
    [ended, state],
  );
  const letterSlots = useMemo(() => {
    const occurrences = new Map();
    return Array.from(state.letters, (letter) => {
      const occurrence = (occurrences.get(letter) || 0) + 1;
      occurrences.set(letter, occurrence);
      return { id: `${letter}-${occurrence}`, letter };
    });
  }, [state.letters]);
  const submit = (event) => {
    event.preventDefault();
    if (!word.trim()) return;
    send("update", { word });
    setWord("");
  };
  return (
    <main className="activity-game activity-anagrams">
      <header className="activity-anagrams-header liquid-glass">
        <strong>{formattedTime(secondsLeft)}</strong>
        <small>
          {copy.meetActivityDictionaryCount.replace(
            "{count}",
            Number(state.dictionarySize || 0).toLocaleString(),
          )}
        </small>
      </header>
      <div className="activity-anagrams-letters">
        {letterSlots.map(({ id, letter }) => (
          <span key={id}>{letter}</span>
        ))}
      </div>
      {!player && !ended
        ? <button
            className="activity-primary"
            disabled={!state.allowOthers}
            onClick={() => send("join")}
            type="button"
          >
            {state.allowOthers
              ? copy.meetActivityJoin
              : copy.meetActivityJoiningDisabled}
          </button>
        : null}
      {player && !ended
        ? <form
            className="activity-anagrams-form liquid-glass"
            onSubmit={submit}
          >
            <input
              aria-label={copy.meetActivityWord}
              autoComplete="off"
              maxLength={12}
              onChange={(event) =>
                setWord(event.target.value.replace(/[^a-z]/giu, ""))
              }
              placeholder={copy.meetActivityWordPlaceholder}
              value={word}
            />
            <button disabled={word.length < 2} type="submit">
              <icon>send</icon>
            </button>
          </form>
        : null}
      {!ended
        ? <section className="activity-private-score liquid-glass">
            <strong>{player?.name || copy.meetParticipant}</strong>
            <small>
              {copy.meetActivityPoints.replace(
                "{score}",
                Number(player?.score || 0).toLocaleString(),
              )}
            </small>
          </section>
        : <FinalLeaderboard
            copy={copy}
            localPeerId={localPeerId}
            state={state}
          />}
      {ended
        ? <p className="activity-result liquid-glass">
            {copy.meetActivityAnagramsWinner.replace(
              "{name}",
              orderedPlayers[0]?.name || copy.meetParticipant,
            )}
          </p>
        : null}
      <PlayerWordsList copy={copy} state={state} />
      <AllWordsReveal copy={copy} state={state} />
      {activity.ownerPeerId === localPeerId && !state.ended
        ? <button
            className="activity-secondary"
            onClick={() => send("end")}
            type="button"
          >
            {copy.meetActivityEnd}
          </button>
        : null}
    </main>
  );
}

function WordHunt({ activity, copy, localPeerId, updateResult }) {
  const state = activity.state;
  const [lastAttempt, setLastAttempt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [path, setPath] = useState([]);
  const [pendingRequest, setPendingRequest] = useState(null);
  const draggingRef = useRef(false);
  const pathRef = useRef([]);
  const player = state.players.find((entry) => entry.peerId === localPeerId);
  const ended = state.ended || Number(state.endsAt) <= now;
  const orderedPlayers = useMemo(
    () => (ended ? orderedActivityPlayers(state) : state.players),
    [ended, state],
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!pendingRequest || updateResult?.requestId !== pendingRequest.id)
      return;
    setLastAttempt({
      status: updateResult.ok ? "valid" : "invalid",
      word: pendingRequest.word,
    });
    setPendingRequest(null);
  }, [pendingRequest, updateResult]);

  const currentWord = path.map((index) => state.board[index]).join("");
  const appendTile = (index) => {
    setPath((current) => {
      if (!current.length) {
        pathRef.current = [index];
        return pathRef.current;
      }
      const last = current.at(-1);
      if (index === current.at(-2)) {
        pathRef.current = current.slice(0, -1);
        return pathRef.current;
      }
      if (current.includes(index)) return current;
      const rowDelta = Math.abs(
        Math.floor(index / state.boardSize) -
          Math.floor(last / state.boardSize),
      );
      const columnDelta = Math.abs(
        (index % state.boardSize) - (last % state.boardSize),
      );
      if (rowDelta <= 1 && columnDelta <= 1) {
        pathRef.current = [...current, index];
        return pathRef.current;
      }
      return current;
    });
  };
  const tileAtPoint = (clientX, clientY) => {
    const tile = document
      .elementFromPoint(clientX, clientY)
      ?.closest("[data-word-hunt-index]");
    return tile ? Number(tile.dataset.wordHuntIndex) : null;
  };
  const startDrag = (event, index) => {
    if (!player || ended) return;
    event.preventDefault();
    event.currentTarget.parentElement?.setPointerCapture?.(event.pointerId);
    setLastAttempt(null);
    pathRef.current = [index];
    setPath(pathRef.current);
    draggingRef.current = true;
  };
  const moveDrag = (event) => {
    if (!draggingRef.current) return;
    const index = tileAtPoint(event.clientX, event.clientY);
    if (Number.isInteger(index)) appendTile(index);
  };
  const finishDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const submittedPath = pathRef.current;
    const word = submittedPath.map((index) => state.board[index]).join("");
    if (submittedPath.length < 2) {
      setLastAttempt({ status: "invalid", word });
      pathRef.current = [];
      setPath([]);
      return;
    }
    const requestId =
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setPendingRequest({ id: requestId, word });
    send("update", { path: submittedPath, requestId });
    pathRef.current = [];
    setPath([]);
  };

  return (
    <main className="activity-game activity-word-hunt">
      <header className="activity-anagrams-header liquid-glass">
        <strong>
          {formattedTime(Math.max(0, (Number(state.endsAt) - now) / 1000))}
        </strong>
        <small>
          {copy.meetActivityDictionaryCount.replace(
            "{count}",
            Number(state.dictionarySize || 0).toLocaleString(),
          )}
        </small>
      </header>
      <output
        className={`activity-word-hunt-attempt${lastAttempt ? ` is-${lastAttempt.status}` : ""}`}
      >
        {currentWord || lastAttempt?.word || copy.meetActivityDragWord}
      </output>
      {!player && !ended
        ? <button
            className="activity-primary"
            disabled={!state.allowOthers}
            onClick={() => send("join")}
            type="button"
          >
            {state.allowOthers
              ? copy.meetActivityJoin
              : copy.meetActivityJoiningDisabled}
          </button>
        : null}
      <div
        className="activity-word-hunt-board"
        onPointerCancel={finishDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        style={{ "--word-hunt-size": state.boardSize }}
      >
        {state.board.map((letter, index) => (
          <button
            className={path.includes(index) ? "is-selected" : ""}
            data-word-hunt-index={index}
            disabled={!player || ended}
            key={`${index}-${letter}`}
            onPointerDown={(event) => startDrag(event, index)}
            tabIndex={-1}
            type="button"
          >
            {letter}
          </button>
        ))}
      </div>
      {!ended
        ? <section className="activity-private-score liquid-glass">
            <strong>{player?.name || copy.meetParticipant}</strong>
            <small>
              {copy.meetActivityPoints.replace(
                "{score}",
                Number(player?.score || 0).toLocaleString(),
              )}
            </small>
          </section>
        : <>
            <FinalLeaderboard
              copy={copy}
              localPeerId={localPeerId}
              state={state}
            />
            <p className="activity-result liquid-glass">
              {copy.meetActivityAnagramsWinner.replace(
                "{name}",
                orderedPlayers[0]?.name || copy.meetParticipant,
              )}
            </p>
          </>}
      <PlayerWordsList copy={copy} state={state} />
      <AllWordsReveal copy={copy} state={state} />
      {activity.ownerPeerId === localPeerId && !state.ended
        ? <button
            className="activity-secondary"
            onClick={() => send("end")}
            type="button"
          >
            {copy.meetActivityEnd}
          </button>
        : null}
    </main>
  );
}

export default function ActivityExperience({ activityName }) {
  const [payload, setPayload] = useState(null);
  const [musicOn, setMusicOn] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);
  const musicStartingRef = useRef(false);
  const stopMusicRef = useRef(null);

  useEffect(() => {
    const receive = (event) => {
      if (
        event.origin !== window.location.origin ||
        event.data?.source !== "munetios-meet"
      ) {
        return;
      }
      if (event.data.type === "state") {
        setPayload(event.data);
      } else if (event.data.type === "update-result") {
        setUpdateResult({
          ok: Boolean(event.data.ok),
          requestId: event.data.requestId,
        });
      }
    };
    window.addEventListener("message", receive);
    send("ready");
    return () => {
      window.removeEventListener("message", receive);
      stopMusicRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!payload?.activity || musicOn || stopMusicRef.current) return;
    const beginMusic = (event) => {
      if (
        event.target.closest?.(".activity-music") ||
        musicStartingRef.current
      ) {
        return;
      }
      musicStartingRef.current = true;
      document.removeEventListener("pointerdown", beginMusic);
      void createMusic(activityName)
        .then((stopMusic) => {
          stopMusicRef.current = stopMusic;
          setMusicOn(true);
        })
        .catch(() => {})
        .finally(() => {
          musicStartingRef.current = false;
        });
    };
    document.addEventListener("pointerdown", beginMusic);
    return () => document.removeEventListener("pointerdown", beginMusic);
  }, [activityName, musicOn, payload?.activity]);

  const toggleMusic = async () => {
    if (musicOn) {
      stopMusicRef.current?.();
      stopMusicRef.current = null;
      setMusicOn(false);
      return;
    }
    try {
      stopMusicRef.current = await createMusic(activityName);
      setMusicOn(true);
    } catch {}
  };

  if (!payload?.activity || payload.activity.type !== activityName) {
    return <main className="activity-loading" />;
  }
  return (
    <div className="activity-root" data-meet-record-content>
      <button
        aria-label="Music"
        aria-pressed={musicOn}
        className="activity-music liquid-glass"
        onClick={() => void toggleMusic()}
        type="button"
      >
        <icon>{musicOn ? "music_off" : "music_note"}</icon>
      </button>
      {activityName === "chess"
        ? <Chess {...payload} />
        : activityName === "wordhunt"
          ? <WordHunt {...payload} updateResult={updateResult} />
          : <Anagrams {...payload} />}
    </div>
  );
}
