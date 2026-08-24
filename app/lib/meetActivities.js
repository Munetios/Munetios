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

const aiPeerId = "munetios-activity-ai";

function normalizeActivityCheats(value = {}) {
  const enabled = Boolean(value.enabled);
  return {
    aiPlaysWordHunt: enabled && Boolean(value.aiPlaysWordHunt),
    allowAnyAnagramWord: enabled && Boolean(value.allowAnyAnagramWord),
    alwaysShowAllWords: enabled && Boolean(value.alwaysShowAllWords),
    customChessRules: enabled && Boolean(value.customChessRules),
    enabled,
    ignoreChessMoveRules: enabled && Boolean(value.ignoreChessMoveRules),
    ignoreDictionary: enabled && Boolean(value.ignoreDictionary),
    shareFoundWords: enabled && Boolean(value.shareFoundWords),
  };
}

export function compareActivityWords(left, right) {
  return (
    String(right).length - String(left).length ||
    String(left).localeCompare(String(right), "en", { sensitivity: "base" })
  );
}

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

export function parseWordHuntCustomWords(value) {
  if (typeof value !== "string") return null;
  const words = value
    .split(/[\s,;]+/u)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  if (words.some((word) => !/^[a-z]{2,49}$/u.test(word))) return null;
  return [...new Set(words)];
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
  cheats,
  creatorWord = "",
  customBoard = "",
  customWords = [],
  durationSeconds,
  ownerName,
  ownerPeerId,
  type,
}) {
  const activityCheats = normalizeActivityCheats(cheats);
  if (type === "chess") {
    const chess = new Chess();
    return {
      achievementsEligible: !activityCheats.enabled,
      allowOthers: Boolean(allowOthers),
      board: chessBoard(chess),
      check: false,
      cheats: activityCheats,
      competitiveEligible: !activityCheats.enabled,
      draw: false,
      ended: false,
      fen: chess.fen(),
      leaderboardEligible: !activityCheats.enabled,
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
    const state = {
      achievementsEligible: !activityCheats.enabled,
      allowOthers: Boolean(allowOthers),
      board: createWordHuntBoard(normalizedBoardSize, customBoard),
      boardSize: normalizedBoardSize,
      cheats: activityCheats,
      competitiveEligible: !activityCheats.enabled,
      customDictionaryVersion: 1,
      customWords,
      dictionarySize: meetAnagramsDictionarySize + customWords.length,
      ended: false,
      endsAt: now + duration * 1000,
      leaderboardEligible: !activityCheats.enabled,
      players: [
        { name: ownerName, peerId: ownerPeerId, score: 0 },
        ...(activityCheats.aiPlaysWordHunt
          ? [{ isAi: true, name: "Munetios AI", peerId: aiPeerId, score: 0 }]
          : []),
      ],
      startedAt: now,
      submittedWords: [],
      type,
      winnerPeerIds: [],
    };
    return activityCheats.alwaysShowAllWords || activityCheats.aiPlaysWordHunt
      ? { ...state, allWords: availableWordsForState(state), aiWordIndex: 0 }
      : state;
  }
  const normalizedCreatorWord = isValidAnagramCreatorWord(creatorWord)
    ? String(creatorWord).trim().toLowerCase()
    : "";
  return {
    achievementsEligible: !activityCheats.enabled,
    allowOthers: Boolean(allowOthers),
    cheats: activityCheats,
    competitiveEligible: !activityCheats.enabled,
    customWords: normalizedCreatorWord ? [normalizedCreatorWord] : [],
    dictionarySize: meetAnagramsDictionarySize,
    ended: false,
    endsAt: now + duration * 1000,
    letters: shuffledLetters(creatorWord),
    leaderboardEligible: !activityCheats.enabled,
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
    path.length > boardLength ||
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
  if (state.submittedWords.some((entry) => entry.word === word)) {
    return { error: "activity_word_already_used" };
  }
  if (
    !state.cheats?.ignoreDictionary &&
    !wordSet.has(word) &&
    !state.customWords?.includes(word)
  ) {
    return { error: "activity_invalid_word" };
  }
  const score = anagramsScore(word.length);
  const recipients = state.cheats?.shareFoundWords
    ? state.players
    : [state.players[playerIndex]];
  return {
    points: score,
    state: {
      ...state,
      players: state.players.map((player) =>
        recipients.some((recipient) => recipient.peerId === player.peerId)
          ? { ...player, score: player.score + score }
          : player,
      ),
      submittedWords: [
        ...state.submittedWords,
        ...recipients.map((recipient) => ({
          peerId: recipient.peerId,
          score,
          shared: recipient.peerId !== peerId,
          word,
        })),
      ],
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
  if (
    !player ||
    (!state.cheats?.customChessRules && player.color !== state.turn) ||
    state.ended
  ) {
    return { error: "activity_not_your_turn" };
  }
  const from = Number(payload.from);
  const to = Number(payload.to);
  const fromSquare = chessSquare(from);
  const toSquare = chessSquare(to);
  if (!fromSquare || !toSquare) {
    return { error: "activity_invalid_move" };
  }
  if (state.cheats?.ignoreChessMoveRules) {
    const board = [...state.board];
    const piece = board[from];
    const target = board[to];
    if (
      !piece ||
      piece[0] !== player.color[0] ||
      target?.[0] === player.color[0]
    ) {
      return { error: "activity_invalid_move" };
    }
    board[to] = piece;
    board[from] = null;
    const capturedKing = target?.[1] === "k";
    return {
      points: capturedKing ? 1 : 0,
      state: {
        ...state,
        board,
        check: false,
        draw: false,
        ended: capturedKing,
        lastMove: { from, peerId, to },
        turn: player.color === "white" ? "black" : "white",
        winnerPeerId: capturedKing ? peerId : null,
      },
    };
  }
  const fenParts = String(state.fen || "").split(" ");
  if (state.cheats?.customChessRules && fenParts.length === 6) {
    fenParts[1] = player.color[0];
  }
  const chess = new Chess(fenParts.join(" ") || undefined);
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
    (!state.cheats?.allowAnyAnagramWord &&
      !wordSet.has(word) &&
      !state.customWords?.includes(word)) ||
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
    allWords: availableWordsForState(state),
    ended: true,
    endedByTimer: true,
    winnerPeerIds: state.players
      .filter((player) => player.score === highest)
      .map((player) => player.peerId),
  };
}

function wordExistsOnBoard(word, board, boardSize) {
  const search = (position, offset, visited) => {
    if (board[position].toLowerCase() !== word[offset]) return false;
    if (offset === word.length - 1) return true;
    const row = Math.floor(position / boardSize);
    const column = position % boardSize;
    visited.add(position);
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
        const nextRow = row + rowOffset;
        const nextColumn = column + columnOffset;
        const next = nextRow * boardSize + nextColumn;
        if (
          (rowOffset || columnOffset) &&
          nextRow >= 0 &&
          nextRow < boardSize &&
          nextColumn >= 0 &&
          nextColumn < boardSize &&
          !visited.has(next) &&
          search(next, offset + 1, visited)
        ) {
          visited.delete(position);
          return true;
        }
      }
    }
    visited.delete(position);
    return false;
  };
  return board.some((_, index) => search(index, 0, new Set()));
}

function availableWordsForState(state) {
  if (state.type !== "anagrams" && state.type !== "wordhunt") return [];
  const candidates = new Set([...wordSet, ...(state.customWords || [])]);
  const words = [...candidates].filter((word) => {
    if (word.length < 2) return false;
    if (state.type === "anagrams") {
      return word.length <= state.letters.length && lettersFit(word, state.letters);
    }
    return (
      word.length <= state.board.length &&
      lettersFit(word, state.board.join("")) &&
      wordExistsOnBoard(word, state.board, state.boardSize)
    );
  });
  return words.sort(compareActivityWords);
}

export function advanceMeetActivityState(state, now = Date.now()) {
  if (
    state?.type !== "wordhunt" ||
    state.ended ||
    !state.cheats?.aiPlaysWordHunt
  ) {
    return state;
  }
  const allWords = state.allWords || availableWordsForState(state);
  const targetIndex = Math.min(
    allWords.length,
    Math.floor(Math.max(0, now - Number(state.startedAt)) / 2500),
  );
  if (state.allWords && Number(state.aiWordIndex || 0) === targetIndex) {
    return state;
  }
  let next = { ...state, allWords };
  for (let index = Number(state.aiWordIndex || 0); index < targetIndex; index += 1) {
    const word = allWords[index];
    if (!word || next.submittedWords.some((entry) => entry.word === word)) continue;
    const score = anagramsScore(word.length);
    const recipients = next.cheats?.shareFoundWords
      ? next.players
      : next.players.filter((player) => player.peerId === aiPeerId);
    next = {
      ...next,
      players: next.players.map((player) =>
        recipients.some((recipient) => recipient.peerId === player.peerId)
          ? { ...player, score: player.score + score }
          : player,
      ),
      submittedWords: [
        ...next.submittedWords,
        ...recipients.map((recipient) => ({
          peerId: recipient.peerId,
          score,
          shared: recipient.peerId !== aiPeerId,
          word,
        })),
      ],
    };
  }
  return { ...next, aiWordIndex: targetIndex };
}

export function activityForPeer(activity, peerId) {
  if (
    !activity ||
    (activity.type !== "anagrams" && activity.type !== "wordhunt")
  ) {
    return activity;
  }
  const ended = Boolean(activity.state?.ended);
  const {
    allWords,
    customWords: _customWords,
    ...visibleState
  } = activity.state || {};
  const revealAllWords = ended || activity.state?.cheats?.alwaysShowAllWords;
  return {
    ...activity,
    state: {
      ...visibleState,
      players: (activity.state?.players || []).map((player) => ({
        ...player,
        score: ended || player.peerId === peerId ? player.score : null,
      })),
      submittedWords: ended ? activity.state?.submittedWords || [] : [],
      ...(revealAllWords ? { allWords: allWords || availableWordsForState(activity.state) } : {}),
    },
  };
}
