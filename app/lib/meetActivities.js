import { createRequire } from "node:module";
import { Chess } from "chess.js";

const require = createRequire(import.meta.url);
const englishWords = require("an-array-of-english-words");

const properNouns = [
  "aaron",
  "abigail",
  "africa",
  "alaska",
  "alice",
  "amazon",
  "amelia",
  "andrew",
  "angela",
  "apollo",
  "arizona",
  "arthur",
  "asia",
  "athens",
  "atlanta",
  "austin",
  "australia",
  "barcelona",
  "benjamin",
  "berlin",
  "boston",
  "brazil",
  "brooklyn",
  "california",
  "canada",
  "caroline",
  "charles",
  "charlotte",
  "chicago",
  "china",
  "christopher",
  "colorado",
  "daniel",
  "david",
  "denver",
  "diana",
  "dublin",
  "edward",
  "egypt",
  "elena",
  "elijah",
  "elizabeth",
  "emily",
  "emma",
  "europe",
  "florida",
  "france",
  "gabriel",
  "georgia",
  "germany",
  "grace",
  "hawaii",
  "henry",
  "houston",
  "india",
  "ireland",
  "isabella",
  "italy",
  "jackson",
  "jacob",
  "james",
  "japan",
  "jennifer",
  "jessica",
  "jordan",
  "joseph",
  "julia",
  "julian",
  "katherine",
  "london",
  "losangeles",
  "lucas",
  "madrid",
  "maria",
  "mary",
  "matthew",
  "melbourne",
  "mexico",
  "michael",
  "miami",
  "milan",
  "montana",
  "munetios",
  "nevada",
  "newyork",
  "noah",
  "olivia",
  "orlando",
  "oscar",
  "paris",
  "patrick",
  "peter",
  "portugal",
  "rome",
  "samuel",
  "seattle",
  "singapore",
  "sofia",
  "spain",
  "sydney",
  "thomas",
  "tokyo",
  "victoria",
  "virginia",
  "william",
];

const wordSet = new Set(
  [...englishWords, ...properNouns]
    .map((word) => String(word).toLowerCase())
    .filter((word) => /^[a-z]{2,32}$/u.test(word)),
);
const anagramWords = [...wordSet].filter(
  (word) => word.length >= 8 && word.length <= 12,
);
const timerOptions = new Set([60, 300, 600, 1800, 3600]);
const wordHuntBoardSizes = new Set([4, 5, 6, 7]);
const wordHuntLetterPool =
  "EEEEEEEEEEEEAAAAAAAAAIIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTTLLLLSSSSUUUUDDDDGGGBBCCMMPPFFHHVVWWYYKJXQZ";

export const meetActivityTypes = new Set(["anagrams", "chess", "wordhunt"]);
export const meetAnagramsDictionarySize = wordSet.size;
export const meetWordHuntBoardSizes = wordHuntBoardSizes;

function chessBoard(chess) {
  return chess
    .board()
    .flatMap((row) =>
      row.map((piece) => (piece ? `${piece.color}${piece.type}` : null)),
    );
}

function shuffledLetters(creatorWord = "") {
  const normalizedCreatorWord = String(creatorWord || "")
    .trim()
    .toLowerCase();
  const source =
    (isValidAnagramCreatorWord(normalizedCreatorWord) &&
      normalizedCreatorWord) ||
    anagramWords[Math.floor(Math.random() * anagramWords.length)] ||
    "triangle";
  const letters = [...source.toUpperCase()];
  for (let index = letters.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [letters[index], letters[swap]] = [letters[swap], letters[index]];
  }
  return letters.join("");
}

export function anagramsScore(length) {
  if (length >= 8) return 3000;
  if (length === 7) return 2000;
  if (length === 6) return 1400;
  if (length === 5) return 800;
  if (length === 4) return 400;
  return length >= 2 ? 100 : 0;
}

export function isValidAnagramCreatorWord(value) {
  const word = String(value || "")
    .trim()
    .toLowerCase();
  return /^[a-z]{2,12}$/u.test(word);
}

export function isValidWordHuntBoard(value, boardSize) {
  const size = Number(boardSize);
  const letters = String(value || "").replace(/[^a-z]/giu, "");
  return wordHuntBoardSizes.has(size) && letters.length === size * size;
}

function createWordHuntBoard(boardSize, customBoard = "") {
  const size = wordHuntBoardSizes.has(Number(boardSize))
    ? Number(boardSize)
    : 4;
  const normalized = String(customBoard || "")
    .replace(/[^a-z]/giu, "")
    .toUpperCase();
  if (normalized.length === size * size) return [...normalized];
  const board = Array.from(
    { length: size * size },
    () =>
      wordHuntLetterPool[Math.floor(Math.random() * wordHuntLetterPool.length)],
  );
  ["G", "A", "M", "E"].forEach((letter, index) => {
    board[index] = letter;
  });
  return board;
}

export function createMeetActivityState({
  allowOthers = true,
  boardSize,
  creatorWord = "",
  customBoard = "",
  durationSeconds,
  ownerName,
  ownerPeerId,
  type,
}) {
  if (type === "chess") {
    const chess = new Chess();
    return {
      allowOthers: Boolean(allowOthers),
      board: chessBoard(chess),
      check: false,
      draw: false,
      ended: false,
      fen: chess.fen(),
      lastMove: null,
      players: [
        { color: "white", name: ownerName, peerId: ownerPeerId, score: 0 },
      ],
      turn: "white",
      type,
      winnerPeerId: null,
    };
  }
  const duration = timerOptions.has(Number(durationSeconds))
    ? Number(durationSeconds)
    : 300;
  const now = Date.now();
  if (type === "wordhunt") {
    const normalizedBoardSize = wordHuntBoardSizes.has(Number(boardSize))
      ? Number(boardSize)
      : 4;
    return {
      allowOthers: Boolean(allowOthers),
      board: createWordHuntBoard(normalizedBoardSize, customBoard),
      boardSize: normalizedBoardSize,
      dictionarySize: meetAnagramsDictionarySize,
      ended: false,
      endsAt: now + duration * 1000,
      players: [{ name: ownerName, peerId: ownerPeerId, score: 0 }],
      startedAt: now,
      submittedWords: [],
      type,
      winnerPeerIds: [],
    };
  }
  const normalizedCreatorWord = isValidAnagramCreatorWord(creatorWord)
    ? String(creatorWord).trim().toLowerCase()
    : "";
  return {
    allowOthers: Boolean(allowOthers),
    customWords: normalizedCreatorWord ? [normalizedCreatorWord] : [],
    dictionarySize: meetAnagramsDictionarySize,
    ended: false,
    endsAt: now + duration * 1000,
    letters: shuffledLetters(creatorWord),
    players: [{ name: ownerName, peerId: ownerPeerId, score: 0 }],
    startedAt: now,
    submittedWords: [],
    type: "anagrams",
    winnerPeerIds: [],
  };
}

function validWordHuntPath(path, boardSize, boardLength) {
  if (
    !Array.isArray(path) ||
    path.length < 2 ||
    path.length > 12 ||
    !wordHuntBoardSizes.has(Number(boardSize))
  ) {
    return false;
  }
  const visited = new Set();
  for (let position = 0; position < path.length; position += 1) {
    const index = Number(path[position]);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= boardLength ||
      visited.has(index)
    ) {
      return false;
    }
    if (position > 0) {
      const previous = Number(path[position - 1]);
      const rowDelta = Math.abs(
        Math.floor(index / boardSize) - Math.floor(previous / boardSize),
      );
      const columnDelta = Math.abs(
        (index % boardSize) - (previous % boardSize),
      );
      if (rowDelta > 1 || columnDelta > 1 || rowDelta + columnDelta === 0) {
        return false;
      }
    }
    visited.add(index);
  }
  return true;
}

function applyWordHuntWord(state, peerId, payload) {
  if (state.ended || Date.now() >= state.endsAt) {
    return { error: "activity_timer_ended" };
  }
  const playerIndex = state.players.findIndex(
    (entry) => entry.peerId === peerId,
  );
  if (playerIndex < 0) return { error: "activity_join_required" };
  const path = Array.isArray(payload.path) ? payload.path.map(Number) : [];
  if (!validWordHuntPath(path, state.boardSize, state.board.length)) {
    return { error: "activity_invalid_word" };
  }
  const word = path
    .map((index) => state.board[index])
    .join("")
    .toLowerCase();
  if (
    !wordSet.has(word) ||
    state.submittedWords.some(
      (entry) => entry.word === word && entry.peerId === peerId,
    )
  ) {
    return { error: "activity_invalid_word" };
  }
  const score = anagramsScore(word.length);
  return {
    points: score,
    state: {
      ...state,
      players: state.players.map((player, index) =>
        index === playerIndex
          ? { ...player, score: player.score + score }
          : player,
      ),
      submittedWords: [...state.submittedWords, { peerId, score, word }].slice(
        -500,
      ),
    },
  };
}

export function joinMeetActivity(state, peerId, name) {
  if (!state || state.ended || !state.allowOthers) {
    return { error: "activity_join_disabled" };
  }
  if (state.players.some((player) => player.peerId === peerId))
    return { state };
  if (state.type === "chess" && state.players.length >= 2) {
    return { error: "activity_full" };
  }
  const player =
    state.type === "chess"
      ? { color: "black", name, peerId, score: 0 }
      : { name, peerId, score: 0 };
  return { state: { ...state, players: [...state.players, player] } };
}

function chessSquare(index) {
  if (!Number.isInteger(index) || index < 0 || index > 63) return "";
  return `${"abcdefgh"[index % 8]}${8 - Math.floor(index / 8)}`;
}

function applyChessMove(state, peerId, payload) {
  const player = state.players.find((entry) => entry.peerId === peerId);
  if (!player || player.color !== state.turn || state.ended) {
    return { error: "activity_not_your_turn" };
  }
  const from = Number(payload.from);
  const to = Number(payload.to);
  const fromSquare = chessSquare(from);
  const toSquare = chessSquare(to);
  if (!fromSquare || !toSquare) {
    return { error: "activity_invalid_move" };
  }
  const chess = new Chess(state.fen || undefined);
  let move;
  try {
    move = chess.move({
      from: fromSquare,
      promotion: "q",
      to: toSquare,
    });
  } catch {
    return { error: "activity_invalid_move" };
  }
  if (!move) return { error: "activity_invalid_move" };
  const ended = chess.isGameOver();
  const draw = chess.isDraw();
  const won = ended && !draw;
  return {
    points: won ? 1 : 0,
    state: {
      ...state,
      board: chessBoard(chess),
      check: chess.inCheck(),
      draw,
      ended,
      fen: chess.fen(),
      lastMove: { from, peerId, to },
      turn: chess.turn() === "w" ? "white" : "black",
      winnerPeerId: won ? peerId : null,
    },
  };
}

function lettersFit(word, letters) {
  const available = new Map();
  for (const letter of letters.toLowerCase()) {
    available.set(letter, (available.get(letter) || 0) + 1);
  }
  for (const letter of word) {
    const count = available.get(letter) || 0;
    if (!count) return false;
    available.set(letter, count - 1);
  }
  return true;
}

function applyAnagramWord(state, peerId, payload) {
  if (state.ended || Date.now() >= state.endsAt) {
    return { error: "activity_timer_ended" };
  }
  const playerIndex = state.players.findIndex(
    (entry) => entry.peerId === peerId,
  );
  if (playerIndex < 0) return { error: "activity_join_required" };
  const word = String(payload.word || "")
    .trim()
    .toLowerCase();
  if (
    (!wordSet.has(word) && !state.customWords?.includes(word)) ||
    !lettersFit(word, state.letters) ||
    state.submittedWords.some(
      (entry) => entry.word === word && entry.peerId === peerId,
    )
  ) {
    return { error: "activity_invalid_word" };
  }
  const score = anagramsScore(word.length);
  const players = state.players.map((player, index) =>
    index === playerIndex ? { ...player, score: player.score + score } : player,
  );
  return {
    points: score,
    state: {
      ...state,
      players,
      submittedWords: [...state.submittedWords, { peerId, score, word }].slice(
        -200,
      ),
    },
  };
}

export function updateMeetActivityState(state, peerId, payload) {
  if (!state || state.ended) return { error: "activity_not_active" };
  if (state.type === "chess") return applyChessMove(state, peerId, payload);
  if (state.type === "wordhunt")
    return applyWordHuntWord(state, peerId, payload);
  return applyAnagramWord(state, peerId, payload);
}

export function finalizeMeetActivityState(state) {
  if (!state || state.ended) return state;
  if (state.type === "chess") return { ...state, ended: true };
  const highest = Math.max(0, ...state.players.map((player) => player.score));
  return {
    ...state,
    ended: true,
    winnerPeerIds: state.players
      .filter((player) => player.score === highest)
      .map((player) => player.peerId),
  };
}

export function activityForPeer(activity, peerId) {
  if (
    !activity ||
    (activity.type !== "anagrams" && activity.type !== "wordhunt")
  ) {
    return activity;
  }
  const ended = Boolean(activity.state?.ended);
  const { customWords: _customWords, ...visibleState } = activity.state || {};
  return {
    ...activity,
    state: {
      ...visibleState,
      players: (activity.state?.players || []).map((player) => ({
        ...player,
        score: ended || player.peerId === peerId ? player.score : null,
      })),
      submittedWords: ended ? activity.state?.submittedWords || [] : [],
    },
  };
}
