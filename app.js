"use strict";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const TYPES = ["k", "q", "r", "b", "n", "p"];
const WHITE_BACK_RANK = ["r", "n", "b", "q", "k", "b", "n", "r"];
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const PIECE_SYMBOLS = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const UNICODE = {
  w: { ...PIECE_SYMBOLS },
  b: { ...PIECE_SYMBOLS },
};
const STOCKFISH_SCRIPT = "vendor/stockfish/stockfish-nnue-16-single.js";
const STOCKFISH_WASM = "vendor/stockfish/stockfish-nnue-16-single.wasm";
const STOCKFISH_MOVETIME_MS = 600;
const STOCKFISH_LINES = 3;
const STOCKFISH_STARTUP_TIMEOUT_MS = 12000;
const STOCKFISH_MAX_STARTUP_ATTEMPTS = 3;
const STOCKFISH_RETRY_DELAY_MS = 700;
const SAVED_STATE_KEY = "chess-coach-board-state-v2";
const LEGACY_SAVED_STATE_KEYS = ["chess-coach-board-state-v1"];
const MAX_SAVED_HISTORY = 100;
const MAX_EVAL_HISTORY = 140;
const OPENING_BOOK = [
  { moves: [], name: "Starting position", idea: "Develop pieces, fight for the center, and get the king safe." },
  { moves: ["e2e4"], name: "King's Pawn Opening", idea: "White immediately fights for central space and opens lines for the bishop and queen." },
  { moves: ["d2d4"], name: "Queen's Pawn Opening", idea: "White builds a solid center and prepares slower piece development." },
  { moves: ["c2c4"], name: "English Opening", idea: "White controls d5 from the side and often builds pressure before occupying the center." },
  { moves: ["g1f3"], name: "Reti Opening", idea: "White develops first and waits to decide the central pawn structure." },
  { moves: ["e2e4", "e7e5"], name: "Open Game", idea: "Both sides take central space, so fast development and king safety matter immediately." },
  { moves: ["e2e4", "c7c5"], name: "Sicilian Defense", idea: "Black avoids symmetry and challenges White's center from the side." },
  { moves: ["e2e4", "e7e6"], name: "French Defense", idea: "Black builds a solid pawn chain and prepares to challenge White's center with d5." },
  { moves: ["e2e4", "c7c6"], name: "Caro-Kann Defense", idea: "Black supports d5 with a sturdy pawn structure and usually accepts a little less space." },
  { moves: ["e2e4", "d7d5"], name: "Scandinavian Defense", idea: "Black immediately challenges the e4 pawn and accepts early queen activity." },
  { moves: ["e2e4", "d7d6"], name: "Pirc Defense", idea: "Black lets White build a center, then attacks it with pieces and pawn breaks." },
  { moves: ["e2e4", "e7e5", "g1f3"], name: "King's Knight Opening", idea: "White develops while attacking the e5 pawn." },
  { moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"], name: "Ruy Lopez", idea: "White pressures the knight that defends e5 and plays for long-term central control." },
  { moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"], name: "Italian Game", idea: "White develops quickly and points the bishop toward Black's weak f7 square." },
  { moves: ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4"], name: "Scotch Game", idea: "White opens the center early and asks Black to solve development problems." },
  { moves: ["d2d4", "d7d5"], name: "Closed Game", idea: "Both sides share the center, so pawn breaks and piece placement become the main story." },
  { moves: ["d2d4", "d7d5", "c2c4"], name: "Queen's Gambit", idea: "White offers the c-pawn to pull Black away from the center." },
  { moves: ["d2d4", "g8f6", "c2c4", "g7g6"], name: "King's Indian Defense", idea: "Black allows White a broad center, then attacks it with pieces and pawn breaks." },
  { moves: ["d2d4", "g8f6", "c2c4", "e7e6", "b1c3", "f8b4"], name: "Nimzo-Indian Defense", idea: "Black pins the knight and fights White's central control with piece pressure." },
  { moves: ["d2d4", "g8f6", "c2c4", "e7e6", "g1f3", "b7b6"], name: "Queen's Indian Defense", idea: "Black develops the bishop to b7 and contests key central light squares." },
];

const els = {};

const state = {
  board: createInitialBoard(),
  turn: "w",
  castling: { wK: true, wQ: true, bK: true, bQ: true },
  enPassant: null,
  halfmove: 0,
  fullmove: 1,
  orientation: "w",
  selected: null,
  legalTargets: [],
  history: [],
  moveLog: [],
  lastMove: null,
  whiteMode: "manual",
  blackMode: "manual",
  promotionChoice: "q",
  editMode: false,
  freeMove: false,
  palettePiece: null,
  lastLesson: "",
  suggestions: [],
  suggestionFen: "",
  suggestionSource: "stockfish",
  evalHistory: [],
  coachLevel: "intermediate",
  reviewMistakeIndex: -1,
  aiTimer: null,
};

const stockfish = {
  worker: null,
  ready: false,
  loading: false,
  failed: false,
  searching: false,
  searchId: 0,
  fen: "",
  color: "w",
  lines: new Map(),
  debounceTimer: null,
  startupTimer: null,
  retryTimer: null,
  startupAttempts: 0,
  unsupported: false,
  lastError: "",
  status: "Chess engine starting...",
};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  buildPalette();
  bindEvents();
  const restored = restoreSavedState();
  initStockfish();
  syncControls();
  refresh(restored
    ? "Restored your saved board from this browser."
    : "Welcome. Choose a side, ask for a coach move, or make the first move on the board.");
  registerOfflineCache();
});

function bindElements() {
  [
    "board",
    "gameStatus",
    "capturedBlack",
    "capturedWhite",
    "rankLabelsLeft",
    "rankLabelsRight",
    "fileLabels",
    "newWhite",
    "newBlack",
    "fullReset",
    "undoMove",
    "flipBoard",
    "coachMove",
    "copyAiBoardModel",
    "settingsDetails",
    "shareDetails",
    "modelDetails",
    "whiteMode",
    "blackMode",
    "orientation",
    "sideToMove",
    "promotionChoice",
    "freeMove",
    "editBoard",
    "editorPanel",
    "palette",
    "fenInput",
    "loadFen",
    "suggestions",
    "engineStatus",
    "runEngine",
    "lesson",
    "evalGraph",
    "evalSummary",
    "coachLevel",
    "materialSummary",
    "whiteMaterialBar",
    "blackMaterialBar",
    "materialDetails",
    "openingPly",
    "openingInfo",
    "planSummary",
    "whyNotMove",
    "compareMove",
    "whyNotResult",
    "reviewNextMistake",
    "mistakeList",
    "coachQuestion",
    "askCoach",
    "coachAnswer",
    "endgamePhase",
    "endgameHelper",
    "fenText",
    "copyFen",
    "modelCopyBlock",
    "copyModelBlock",
    "modelClipboardBuffer",
    "shareNotice",
    "shareUrl",
    "copyShareLink",
    "shareApp",
    "pieceInventory",
    "moveHistory",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.newWhite.addEventListener("click", () => newGame("w"));
  els.newBlack.addEventListener("click", () => newGame("b"));
  els.fullReset.addEventListener("click", () => {
    if (!window.confirm("Full reset clears the board, move history, settings, saved position, and analysis. Continue?")) return;
    fullReset();
  });
  els.undoMove.addEventListener("click", undo);
  els.flipBoard.addEventListener("click", () => {
    state.orientation = opposite(state.orientation);
    syncControls();
    refresh("Board flipped. The AI model stayed tied to the same real squares.");
  });
  els.coachMove.addEventListener("click", () => playCoachMove());
  els.runEngine.addEventListener("click", () => requestStockfishAnalysis(true));
  els.whiteMode.addEventListener("change", (event) => {
    state.whiteMode = event.target.value;
    refresh(`${colorName("w")} is now set to ${modeName(state.whiteMode)}.`);
  });
  els.blackMode.addEventListener("change", (event) => {
    state.blackMode = event.target.value;
    refresh(`${colorName("b")} is now set to ${modeName(state.blackMode)}.`);
  });
  els.orientation.addEventListener("change", (event) => {
    state.orientation = event.target.value;
    refresh("Board orientation changed.");
  });
  els.sideToMove.addEventListener("change", (event) => {
    state.turn = event.target.value;
    state.selected = null;
    refresh(`${colorName(state.turn)} is now set to move.`);
  });
  els.promotionChoice.addEventListener("change", (event) => {
    state.promotionChoice = event.target.value;
    refresh(`Pawn promotions will become a ${PIECE_NAMES[state.promotionChoice]}.`);
  });
  els.freeMove.addEventListener("change", (event) => {
    state.freeMove = event.target.checked;
    state.selected = null;
    refresh(state.freeMove ? "Free move override is on. You can move pieces without legal-move filtering." : "Free move override is off. Legal chess moves are enforced.");
  });
  els.editBoard.addEventListener("change", (event) => {
    state.editMode = event.target.checked;
    state.selected = null;
    refresh(state.editMode ? "Edit board is on. Pick a palette piece and click squares." : "Edit board is off. Normal play resumed.");
  });
  els.loadFen.addEventListener("click", () => loadFenFromInput());
  els.fenInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadFenFromInput();
  });
  els.copyAiBoardModel.addEventListener("click", () => copyModelBlock());
  els.coachLevel.addEventListener("change", (event) => {
    state.coachLevel = event.target.value;
    refresh(`Coach level set to ${coachLevelName(state.coachLevel)}.`);
  });
  els.compareMove.addEventListener("click", () => compareCandidateMove());
  els.whyNotMove.addEventListener("change", () => compareCandidateMove(false));
  els.reviewNextMistake.addEventListener("click", () => reviewNextMistake());
  els.mistakeList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-ply]");
    if (button) reviewMistakeAt(Number(button.dataset.reviewPly));
  });
  els.askCoach.addEventListener("click", () => answerCoachQuestion());
  els.coachQuestion.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) answerCoachQuestion();
  });
  els.copyShareLink.addEventListener("click", () => copyShareLink());
  els.shareApp.addEventListener("click", () => shareAppLink());
}

function createInitialBoard() {
  const board = Array(64).fill(null);
  for (let c = 0; c < 8; c += 1) {
    board[indexOf(0, c)] = { color: "b", type: WHITE_BACK_RANK[c] };
    board[indexOf(1, c)] = { color: "b", type: "p" };
    board[indexOf(6, c)] = { color: "w", type: "p" };
    board[indexOf(7, c)] = { color: "w", type: WHITE_BACK_RANK[c] };
  }
  return board;
}

function newGame(firstSide) {
  state.board = createInitialBoard();
  state.turn = firstSide;
  state.castling = { wK: true, wQ: true, bK: true, bQ: true };
  state.enPassant = null;
  state.halfmove = 0;
  state.fullmove = 1;
  state.history = [];
  state.moveLog = [];
  state.lastMove = null;
  state.evalHistory = [];
  state.reviewMistakeIndex = -1;
  state.selected = null;
  state.lastLesson = `${colorName(firstSide)} will move first. The AI refreshed from the starting position.`;
  syncControls();
  refresh(state.lastLesson);
}

function fullReset() {
  clearTimeout(state.aiTimer);
  state.board = createInitialBoard();
  state.turn = "w";
  state.castling = { wK: true, wQ: true, bK: true, bQ: true };
  state.enPassant = null;
  state.halfmove = 0;
  state.fullmove = 1;
  state.orientation = "w";
  state.selected = null;
  state.legalTargets = [];
  state.history = [];
  state.moveLog = [];
  state.lastMove = null;
  state.whiteMode = "manual";
  state.blackMode = "manual";
  state.promotionChoice = "q";
  state.editMode = false;
  state.freeMove = false;
  state.palettePiece = null;
  state.lastLesson = "";
  state.suggestions = [];
  state.suggestionFen = "";
  state.suggestionSource = "stockfish";
  state.evalHistory = [];
  state.reviewMistakeIndex = -1;
  state.aiTimer = null;
  [els.settingsDetails, els.shareDetails, els.modelDetails].forEach((panel) => {
    if (panel) panel.open = false;
  });
  resetPaletteSelection();
  refresh("Full reset complete. The board, controls, history, and AI model are back to the default starting position.");
}

function buildPalette() {
  const entries = [{ color: null, type: null, label: "Empty", symbol: "×" }];
  ["w", "b"].forEach((color) => {
    TYPES.forEach((type) => entries.push({ color, type, label: `${colorName(color)} ${PIECE_NAMES[type]}`, symbol: UNICODE[color][type] }));
  });
  els.palette.innerHTML = "";
  entries.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.symbol;
    button.title = entry.label;
    button.setAttribute("aria-label", entry.label);
    button.addEventListener("click", () => {
      state.palettePiece = entry.type ? { color: entry.color, type: entry.type } : null;
      [...els.palette.querySelectorAll("button")].forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
    });
    if (!entry.type) button.classList.add("active");
    els.palette.appendChild(button);
  });
}

function resetPaletteSelection() {
  if (!els.palette) return;
  const buttons = [...els.palette.querySelectorAll("button")];
  buttons.forEach((button, index) => button.classList.toggle("active", index === 0));
}

function syncControls() {
  els.whiteMode.value = state.whiteMode;
  els.blackMode.value = state.blackMode;
  els.orientation.value = state.orientation;
  els.sideToMove.value = state.turn;
  els.promotionChoice.value = state.promotionChoice;
  els.freeMove.checked = state.freeMove;
  els.editBoard.checked = state.editMode;
  els.coachLevel.value = state.coachLevel;
  els.editorPanel.classList.toggle("open", state.editMode);
  if (state.editMode && els.settingsDetails) els.settingsDetails.open = true;
}

function refresh(message = "") {
  clearTimeout(state.aiTimer);
  if (state.selected === null) state.legalTargets = [];
  syncControls();
  const fen = boardToFen();
  if (state.suggestionFen !== fen || state.suggestionSource !== "stockfish") {
    state.suggestions = [];
    state.suggestionFen = fen;
    state.suggestionSource = "stockfish";
  }
  renderBoard();
  renderCaptured();
  renderSuggestions();
  renderModel();
  renderHistory();
  renderStatus();
  renderSharePanel();
  renderGraphs();
  renderLearningTools();
  if (message) renderLesson(message);
  saveCurrentState();
  queueStockfishAnalysis();
  maybeAutoPlay();
}

function renderBoard() {
  els.board.innerHTML = "";
  const ranks = state.orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = state.orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const legalTargets = new Set(state.legalTargets.map((move) => move.to));
  const captures = new Set(state.legalTargets.filter((move) => move.captured || move.enPassant).map((move) => move.to));
  const kingSquare = findKing(state.board, state.turn);
  const checkSquare = kingSquare !== null && isInCheck(state.board, state.turn) ? kingSquare : null;

  ranks.forEach((rank) => {
    files.forEach((file) => {
      const idx = indexOf(rank, file);
      const square = document.createElement("button");
      const piece = state.board[idx];
      square.type = "button";
      square.className = `square ${squareColor(rank, file)}`;
      square.dataset.index = String(idx);
      square.setAttribute("aria-label", `${squareName(idx)} ${piece ? `${colorName(piece.color)} ${PIECE_NAMES[piece.type]}` : "empty"}`);
      if (piece) {
        square.textContent = UNICODE[piece.color][piece.type];
        square.classList.add(piece.color === "w" ? "piece-white" : "piece-black");
      }
      if (state.selected === idx) square.classList.add("selected");
      if (legalTargets.has(idx)) square.classList.add(captures.has(idx) ? "capture" : "legal");
      if (state.lastMove && (state.lastMove.from === idx || state.lastMove.to === idx)) square.classList.add("last-move");
      if (checkSquare === idx) square.classList.add("in-check");
      square.addEventListener("click", () => handleSquareClick(idx));
      els.board.appendChild(square);
    });
  });

  renderCoordinates();
}

function renderCoordinates() {
  const ranks = state.orientation === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = state.orientation === "w" ? FILES : [...FILES].reverse();
  els.rankLabelsLeft.innerHTML = ranks.map((rank) => `<span>${rank}</span>`).join("");
  els.rankLabelsRight.innerHTML = ranks.map((rank) => `<span>${rank}</span>`).join("");
  els.fileLabels.innerHTML = files.map((file) => `<span>${file}</span>`).join("");
}

function handleSquareClick(idx) {
  if (state.editMode) {
    pushHistory("Board edit");
    state.board[idx] = state.palettePiece ? { ...state.palettePiece } : null;
    state.selected = null;
    state.evalHistory = [];
    normalizeCastlingAfterEdit();
    refresh(`Board edited at ${squareName(idx)}. The AI rebuilt its piece map from the new position.`);
    return;
  }

  const piece = state.board[idx];
  if (state.selected === null) {
    if (!piece) {
      renderLesson(`Select a piece first, or turn on Edit board to place pieces directly.`);
      return;
    }
    if (!state.freeMove && piece.color !== state.turn) {
      renderLesson(`It is ${colorName(state.turn)} to move. You can change the side to move in the controls if you want full manual control.`);
      return;
    }
    selectSquare(idx);
    return;
  }

  if (idx === state.selected) {
    clearSelection();
    renderLesson("Selection cleared.");
    return;
  }

  const selectedPiece = state.board[state.selected];
  if (piece && selectedPiece && piece.color === selectedPiece.color && !state.freeMove) {
    selectSquare(idx);
    return;
  }

  const move = state.freeMove ? createFreeMove(state.selected, idx) : state.legalTargets.find((candidate) => candidate.to === idx);
  if (!move) {
    renderLesson(explainIllegalMove(state.selected, idx));
    return;
  }
  commitMove(move, "human");
}

function selectSquare(idx) {
  state.selected = idx;
  state.legalTargets = state.freeMove ? freeTargets(idx) : generateLegalMoves(state, state.board[idx].color).filter((move) => move.from === idx);
  renderBoard();
  const piece = state.board[idx];
  renderLesson(`Selected the ${colorName(piece.color).toLowerCase()} ${PIECE_NAMES[piece.type]} on ${squareName(idx)}. Legal destinations are highlighted.`);
}

function clearSelection() {
  state.selected = null;
  state.legalTargets = [];
  renderBoard();
}

function createFreeMove(from, to) {
  const piece = state.board[from];
  if (!piece || from === to) return null;
  return {
    from,
    to,
    piece: { ...piece },
    captured: state.board[to] ? { ...state.board[to] } : null,
    promotion: piece.type === "p" && isPromotionRank(piece.color, to) ? state.promotionChoice : null,
    free: true,
  };
}

function freeTargets(from) {
  const piece = state.board[from];
  if (!piece) return [];
  return state.board.map((target, idx) => {
    if (idx === from || (target && target.color === piece.color)) return null;
    return createFreeMove(from, idx);
  }).filter(Boolean);
}

function commitMove(move, actor) {
  const side = move.piece.color;
  const beforeSuggestions = currentSuggestionsFor(side);
  const picked = beforeSuggestions.find((candidate) => sameMove(candidate.move, move));
  const best = beforeSuggestions[0];
  pushHistory(describeMove(move));
  applyMove(state, move);
  state.lastMove = { from: move.from, to: move.to };
  state.selected = null;
  state.legalTargets = [];
  const lesson = actor === "ai" ? aiMoveLesson(move, picked || best) : humanMoveLesson(move, picked, best, beforeSuggestions);
  state.lastLesson = lesson;
  refresh(lesson);
}

function pushHistory(label) {
  state.history.push({
    board: cloneBoard(state.board),
    turn: state.turn,
    castling: { ...state.castling },
    enPassant: state.enPassant,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    moveLog: state.moveLog.map((entry) => ({ ...entry })),
    label,
  });
}

function undo() {
  const previous = state.history.pop();
  if (!previous) {
    renderLesson("There is no move to undo yet.");
    return;
  }
  state.board = cloneBoard(previous.board);
  state.turn = previous.turn;
  state.castling = { ...previous.castling };
  state.enPassant = previous.enPassant;
  state.halfmove = previous.halfmove;
  state.fullmove = previous.fullmove;
  state.lastMove = previous.lastMove;
  state.moveLog = previous.moveLog;
  state.selected = null;
  state.legalTargets = [];
  state.evalHistory = state.evalHistory.filter((entry) => entry.ply <= state.moveLog.length);
  refresh(`Undid: ${previous.label}. The AI refreshed from the restored board.`);
}

function playCoachMove() {
  if (!state.suggestions.length) {
    const retryHelp = stockfish.failed
      ? "Press Re-analyze to restart Stockfish, then the coach can choose a move."
      : "Wait for analysis to finish or press Re-analyze.";
    renderLesson(`The engine has not produced a legal coach move for this position yet. ${retryHelp}`);
    return;
  }
  commitMove(state.suggestions[0].move, "ai");
}

function maybeAutoPlay() {
  const mode = state.turn === "w" ? state.whiteMode : state.blackMode;
  if (mode !== "ai" || state.editMode) return;
  const legal = generateLegalMoves(state, state.turn);
  if (!legal.length) return;
  const fen = boardToFen();
  if (state.suggestionSource !== "stockfish" || state.suggestionFen !== fen || !state.suggestions.length) return;
  state.aiTimer = setTimeout(() => {
    const currentMode = state.turn === "w" ? state.whiteMode : state.blackMode;
    if (currentMode === "ai" && !state.editMode) playCoachMove();
  }, 700);
}

function currentSuggestionsFor(color) {
  const fen = boardToFen();
  if (state.turn === color && state.suggestionFen === fen && state.suggestionSource === "stockfish" && state.suggestions.length) {
    return state.suggestions;
  }
  return [];
}

function generateLegalMoves(position, color) {
  const pseudo = generatePseudoMoves(position, color, true);
  return pseudo.filter((move) => {
    const next = clonePosition(position);
    applyMove(next, move, { silent: true });
    return !isInCheck(next.board, color);
  });
}

function generatePseudoMoves(position, color, includeCastling) {
  const moves = [];
  position.board.forEach((piece, idx) => {
    if (!piece || piece.color !== color) return;
    const { rank, file } = coords(idx);
    if (piece.type === "p") addPawnMoves(position, moves, idx, piece, rank, file);
    if (piece.type === "n") addStepMoves(position, moves, idx, piece, [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]);
    if (piece.type === "b") addSlideMoves(position, moves, idx, piece, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
    if (piece.type === "r") addSlideMoves(position, moves, idx, piece, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
    if (piece.type === "q") addSlideMoves(position, moves, idx, piece, [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]);
    if (piece.type === "k") {
      addStepMoves(position, moves, idx, piece, [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]);
      if (includeCastling) addCastlingMoves(position, moves, idx, piece);
    }
  });
  return moves;
}

function addPawnMoves(position, moves, idx, piece, rank, file) {
  const direction = piece.color === "w" ? -1 : 1;
  const startRank = piece.color === "w" ? 6 : 1;
  const oneRank = rank + direction;
  if (inBounds(oneRank, file)) {
    const one = indexOf(oneRank, file);
    if (!position.board[one]) {
      addPawnMoveWithPromotion(moves, idx, one, piece, null);
      const twoRank = rank + direction * 2;
      const two = indexOf(twoRank, file);
      if (rank === startRank && !position.board[two]) {
        moves.push(baseMove(idx, two, piece, null, { doublePawn: true }));
      }
    }
  }
  [-1, 1].forEach((df) => {
    const captureRank = rank + direction;
    const captureFile = file + df;
    if (!inBounds(captureRank, captureFile)) return;
    const to = indexOf(captureRank, captureFile);
    const target = position.board[to];
    if (target && target.color !== piece.color && target.type !== "k") addPawnMoveWithPromotion(moves, idx, to, piece, target);
    if (position.enPassant === to) {
      const capturedSquare = indexOf(rank, captureFile);
      const captured = position.board[capturedSquare];
      if (captured && captured.type === "p" && captured.color !== piece.color) {
        moves.push(baseMove(idx, to, piece, captured, { enPassant: capturedSquare }));
      }
    }
  });
}

function addPawnMoveWithPromotion(moves, from, to, piece, captured) {
  if (isPromotionRank(piece.color, to)) {
    ["q", "r", "b", "n"].forEach((promotion) => {
      moves.push(baseMove(from, to, piece, captured, { promotion }));
    });
  } else {
    moves.push(baseMove(from, to, piece, captured));
  }
}

function addStepMoves(position, moves, idx, piece, deltas) {
  const { rank, file } = coords(idx);
  deltas.forEach(([dr, df]) => {
    const nextRank = rank + dr;
    const nextFile = file + df;
    if (!inBounds(nextRank, nextFile)) return;
    const to = indexOf(nextRank, nextFile);
    const target = position.board[to];
    if (!target) moves.push(baseMove(idx, to, piece, null));
    else if (target.color !== piece.color && target.type !== "k") moves.push(baseMove(idx, to, piece, target));
  });
}

function addSlideMoves(position, moves, idx, piece, deltas) {
  const start = coords(idx);
  deltas.forEach(([dr, df]) => {
    let rank = start.rank + dr;
    let file = start.file + df;
    while (inBounds(rank, file)) {
      const to = indexOf(rank, file);
      const target = position.board[to];
      if (!target) {
        moves.push(baseMove(idx, to, piece, null));
      } else {
        if (target.color !== piece.color && target.type !== "k") moves.push(baseMove(idx, to, piece, target));
        break;
      }
      rank += dr;
      file += df;
    }
  });
}

function addCastlingMoves(position, moves, idx, piece) {
  const rank = piece.color === "w" ? 7 : 0;
  const enemy = opposite(piece.color);
  if (idx !== indexOf(rank, 4) || isInCheck(position.board, piece.color)) return;
  const canKingSide = position.castling[`${piece.color}K`]
    && !position.board[indexOf(rank, 5)]
    && !position.board[indexOf(rank, 6)]
    && position.board[indexOf(rank, 7)]?.type === "r"
    && position.board[indexOf(rank, 7)]?.color === piece.color
    && !isSquareAttacked(position.board, indexOf(rank, 5), enemy)
    && !isSquareAttacked(position.board, indexOf(rank, 6), enemy);
  if (canKingSide) moves.push(baseMove(idx, indexOf(rank, 6), piece, null, { castle: "K" }));

  const canQueenSide = position.castling[`${piece.color}Q`]
    && !position.board[indexOf(rank, 1)]
    && !position.board[indexOf(rank, 2)]
    && !position.board[indexOf(rank, 3)]
    && position.board[indexOf(rank, 0)]?.type === "r"
    && position.board[indexOf(rank, 0)]?.color === piece.color
    && !isSquareAttacked(position.board, indexOf(rank, 3), enemy)
    && !isSquareAttacked(position.board, indexOf(rank, 2), enemy);
  if (canQueenSide) moves.push(baseMove(idx, indexOf(rank, 2), piece, null, { castle: "Q" }));
}

function baseMove(from, to, piece, captured, extras = {}) {
  return {
    from,
    to,
    piece: { ...piece },
    captured: captured ? { ...captured } : null,
    ...extras,
  };
}

function applyMove(position, move, options = {}) {
  const movingColor = position.turn;
  const moveNumber = position.fullmove;
  const movingPiece = { ...move.piece };
  const captured = move.enPassant !== undefined ? position.board[move.enPassant] : position.board[move.to];
  position.board[move.from] = null;
  if (move.enPassant !== undefined) position.board[move.enPassant] = null;
  if (move.castle) {
    const rank = movingPiece.color === "w" ? 7 : 0;
    if (move.castle === "K") {
      position.board[indexOf(rank, 5)] = position.board[indexOf(rank, 7)];
      position.board[indexOf(rank, 7)] = null;
    } else {
      position.board[indexOf(rank, 3)] = position.board[indexOf(rank, 0)];
      position.board[indexOf(rank, 0)] = null;
    }
  }
  if (move.promotion) movingPiece.type = move.promotion;
  position.board[move.to] = movingPiece;

  updateCastlingRights(position, move, captured);
  position.enPassant = move.doublePawn ? midpoint(move.from, move.to) : null;
  position.halfmove = movingPiece.type === "p" || captured ? 0 : position.halfmove + 1;

  if (!options.silent) {
    position.moveLog.push({
      number: moveNumber,
      color: movingPiece.color,
      text: describeMove(move),
      uci: moveToUci(move),
    });
  }
  if (movingColor === "b") position.fullmove += 1;
  position.turn = opposite(movingColor);
}

function updateCastlingRights(position, move, captured) {
  if (move.piece.type === "k") {
    position.castling[`${move.piece.color}K`] = false;
    position.castling[`${move.piece.color}Q`] = false;
  }
  if (move.piece.type === "r") {
    const from = squareName(move.from);
    if (from === "h1") position.castling.wK = false;
    if (from === "a1") position.castling.wQ = false;
    if (from === "h8") position.castling.bK = false;
    if (from === "a8") position.castling.bQ = false;
  }
  if (captured?.type === "r") {
    const to = squareName(move.enPassant !== undefined ? move.enPassant : move.to);
    if (to === "h1") position.castling.wK = false;
    if (to === "a1") position.castling.wQ = false;
    if (to === "h8") position.castling.bK = false;
    if (to === "a8") position.castling.bQ = false;
  }
}

function normalizeCastlingAfterEdit() {
  const wKing = state.board[indexOf(7, 4)];
  const bKing = state.board[indexOf(0, 4)];
  state.castling.wK = Boolean(wKing?.color === "w" && wKing.type === "k" && state.board[indexOf(7, 7)]?.color === "w" && state.board[indexOf(7, 7)]?.type === "r");
  state.castling.wQ = Boolean(wKing?.color === "w" && wKing.type === "k" && state.board[indexOf(7, 0)]?.color === "w" && state.board[indexOf(7, 0)]?.type === "r");
  state.castling.bK = Boolean(bKing?.color === "b" && bKing.type === "k" && state.board[indexOf(0, 7)]?.color === "b" && state.board[indexOf(0, 7)]?.type === "r");
  state.castling.bQ = Boolean(bKing?.color === "b" && bKing.type === "k" && state.board[indexOf(0, 0)]?.color === "b" && state.board[indexOf(0, 0)]?.type === "r");
  state.enPassant = null;
}

function isInCheck(board, color) {
  const king = findKing(board, color);
  if (king === null) return false;
  return isSquareAttacked(board, king, opposite(color));
}

function isSquareAttacked(board, square, byColor) {
  const { rank, file } = coords(square);
  const pawnDir = byColor === "w" ? -1 : 1;
  for (const df of [-1, 1]) {
    const pawnRank = rank - pawnDir;
    const pawnFile = file + df;
    if (inBounds(pawnRank, pawnFile)) {
      const piece = board[indexOf(pawnRank, pawnFile)];
      if (piece?.color === byColor && piece.type === "p") return true;
    }
  }

  for (const [dr, df] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
    const nr = rank + dr;
    const nf = file + df;
    if (inBounds(nr, nf)) {
      const piece = board[indexOf(nr, nf)];
      if (piece?.color === byColor && piece.type === "n") return true;
    }
  }

  for (const [dr, df] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    if (rayAttacked(board, rank, file, dr, df, byColor, ["b", "q"])) return true;
  }
  for (const [dr, df] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    if (rayAttacked(board, rank, file, dr, df, byColor, ["r", "q"])) return true;
  }

  for (const [dr, df] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
    const nr = rank + dr;
    const nf = file + df;
    if (inBounds(nr, nf)) {
      const piece = board[indexOf(nr, nf)];
      if (piece?.color === byColor && piece.type === "k") return true;
    }
  }
  return false;
}

function rayAttacked(board, rank, file, dr, df, byColor, attackers) {
  let nr = rank + dr;
  let nf = file + df;
  while (inBounds(nr, nf)) {
    const piece = board[indexOf(nr, nf)];
    if (piece) return piece.color === byColor && attackers.includes(piece.type);
    nr += dr;
    nf += df;
  }
  return false;
}

function initStockfish() {
  if (stockfish.worker || stockfish.loading) return;
  if (!("Worker" in window) || !("WebAssembly" in window)) {
    stockfish.unsupported = true;
    stockfish.failed = true;
    stockfish.ready = false;
    stockfish.loading = false;
    stockfish.lastError = "Stockfish requires WebAssembly and Web Workers.";
    setStockfishStatus("Stockfish cannot run in this browser.");
    renderSuggestions();
    return;
  }

  clearTimeout(stockfish.retryTimer);
  stockfish.retryTimer = null;
  stockfish.loading = true;
  stockfish.failed = false;
  stockfish.ready = false;
  stockfish.searching = false;
  stockfish.unsupported = false;
  stockfish.startupAttempts += 1;
  const attemptText = stockfish.startupAttempts > 1
    ? `Restarting chess engine (${stockfish.startupAttempts}/${STOCKFISH_MAX_STARTUP_ATTEMPTS})...`
    : "Loading chess engine...";
  setStockfishStatus(attemptText);
  try {
    const scriptUrl = new URL(STOCKFISH_SCRIPT, window.location.href).href;
    const wasmUrl = new URL(STOCKFISH_WASM, window.location.href).href;
    stockfish.worker = new Worker(`${scriptUrl}#${encodeURIComponent(wasmUrl)},worker`);
    stockfish.worker.addEventListener("message", handleStockfishMessage);
    stockfish.worker.addEventListener("error", () => markStockfishFailure("Stockfish could not load in this browser session.", true));
    stockfish.worker.addEventListener("messageerror", () => markStockfishFailure("Stockfish sent a response the browser could not read.", true));
    stockfishPost("uci");
    stockfish.startupTimer = setTimeout(() => {
      if (!stockfish.ready) {
        markStockfishFailure("Stockfish took too long to respond.", true);
      }
    }, STOCKFISH_STARTUP_TIMEOUT_MS);
  } catch {
    markStockfishFailure("Stockfish could not start in this browser session.", true);
  }
}

function resetStockfishWorker() {
  clearTimeout(stockfish.startupTimer);
  clearTimeout(stockfish.retryTimer);
  stockfish.startupTimer = null;
  stockfish.retryTimer = null;
  if (stockfish.worker) stockfish.worker.terminate();
  stockfish.worker = null;
  stockfish.ready = false;
  stockfish.loading = false;
  stockfish.searching = false;
  stockfish.lines = new Map();
}

function markStockfishFailure(message, canRetry) {
  resetStockfishWorker();
  stockfish.lastError = message;
  state.suggestions = [];
  state.suggestionFen = boardToFen();
  state.suggestionSource = "stockfish";

  if (canRetry && stockfish.startupAttempts < STOCKFISH_MAX_STARTUP_ATTEMPTS && !stockfish.unsupported) {
    stockfish.failed = false;
    setStockfishStatus("The chess engine took longer than expected. Retrying...");
    stockfish.retryTimer = setTimeout(() => initStockfish(), STOCKFISH_RETRY_DELAY_MS);
    renderSuggestions();
    return;
  }

  stockfish.failed = true;
  setStockfishStatus("Stockfish needs a restart. Press Re-analyze to retry.");
  renderSuggestions();
}

function restartStockfish() {
  resetStockfishWorker();
  stockfish.failed = false;
  stockfish.unsupported = false;
  stockfish.lastError = "";
  stockfish.startupAttempts = 0;
  state.suggestions = [];
  state.suggestionFen = boardToFen();
  state.suggestionSource = "stockfish";
  setStockfishStatus("Restarting chess engine...");
  renderSuggestions();
  initStockfish();
}

function stockfishPost(command) {
  if (stockfish.worker) stockfish.worker.postMessage(command);
}

function handleStockfishMessage(event) {
  handleStockfishLine(event.data);
}

function handleStockfishLine(message) {
  const line = String(message || "").trim();
  if (!line) return;

  if (line === "uciok") {
    clearTimeout(stockfish.startupTimer);
    stockfishPost(`setoption name MultiPV value ${STOCKFISH_LINES}`);
    stockfishPost("setoption name Use NNUE value false");
    stockfishPost("isready");
    return;
  }

  if (line === "readyok") {
    clearTimeout(stockfish.startupTimer);
    stockfish.ready = true;
    stockfish.loading = false;
    stockfish.failed = false;
    stockfish.unsupported = false;
    stockfish.startupAttempts = 0;
    stockfish.lastError = "";
    setStockfishStatus("Engine ready.");
    queueStockfishAnalysis();
    return;
  }

  if (line.startsWith("info ")) {
    parseStockfishInfo(line);
    return;
  }

  if (line.startsWith("bestmove ")) {
    finishStockfishSearch(line);
  }
}

function parseStockfishInfo(line) {
  if (!stockfish.searching || !line.includes(" pv ")) return;
  const pv = line.split(" pv ")[1].trim().split(/\s+/).filter(Boolean);
  if (!pv.length) return;
  const depth = Number(line.match(/\bdepth (\d+)/)?.[1] || 0);
  const multipv = Number(line.match(/\bmultipv (\d+)/)?.[1] || 1);
  const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!scoreMatch) return;
  stockfish.lines.set(multipv, {
    depth,
    multipv,
    pv,
    uci: pv[0],
    scoreType: scoreMatch[1],
    score: Number(scoreMatch[2]),
    numeric: scoreMatch[1] === "mate" ? mateToCentipawns(Number(scoreMatch[2])) : Number(scoreMatch[2]),
  });
}

function finishStockfishSearch(line) {
  if (!stockfish.searching) return;
  if (line.includes("(none)")) {
    stockfish.searching = false;
    setStockfishStatus("Stockfish sees no legal move in this position.");
    return;
  }
  stockfish.searching = false;
  if (stockfish.fen !== boardToFen() || stockfish.color !== state.turn) return;
  const suggestions = stockfishSuggestionsFromLines();
  if (!suggestions.length) {
    state.suggestions = [];
    state.suggestionFen = stockfish.fen;
    state.suggestionSource = "stockfish";
    renderSuggestions();
    setStockfishStatus("Stockfish finished, but no legal engine line matched this board.");
    return;
  }
  state.suggestions = suggestions;
  state.suggestionFen = stockfish.fen;
  state.suggestionSource = "stockfish";
  recordEvaluation(suggestions[0]);
  renderSuggestions();
  renderGraphs();
  setStockfishStatus("Analysis complete.");
  if (els.lesson?.textContent.includes("Waiting for analysis.") || els.lesson?.textContent.includes("Waiting for Stockfish.")) {
    renderLesson("The board was refreshed and the engine calculated the best candidates.");
  }
  maybeAutoPlay();
}

function queueStockfishAnalysis() {
  clearTimeout(stockfish.debounceTimer);
  stockfish.debounceTimer = setTimeout(() => requestStockfishAnalysis(false), 90);
}

function requestStockfishAnalysis(force) {
  clearTimeout(stockfish.debounceTimer);
  if (!isStockfishPositionReady()) {
    setStockfishStatus("Stockfish needs one white king and one black king.");
    return;
  }
  if (!generateLegalMoves(state, state.turn).length) {
    setStockfishStatus("Stockfish sees no legal move in this position.");
    return;
  }
  if (force && (stockfish.failed || (stockfish.loading && !stockfish.ready))) {
    restartStockfish();
    return;
  }
  if (!stockfish.worker && !stockfish.failed) initStockfish();
  if (stockfish.failed) {
    const status = stockfish.unsupported
      ? "Stockfish cannot run in this browser."
      : "Stockfish needs a restart. Press Re-analyze to retry.";
    setStockfishStatus(status);
    renderSuggestions();
    return;
  }
  if (!stockfish.ready) {
    setStockfishStatus("Loading chess engine...");
    return;
  }

  const fen = boardToFen();
  if (!force && stockfish.searching && stockfish.fen === fen) return;
  if (stockfish.searching) stockfishPost("stop");
  stockfish.searching = true;
  stockfish.searchId += 1;
  stockfish.fen = fen;
  stockfish.color = state.turn;
  stockfish.lines = new Map();
  setStockfishStatus("Analyzing this position...");
  renderSuggestions();
  stockfishPost(`position fen ${fen}`);
  stockfishPost(`go movetime ${STOCKFISH_MOVETIME_MS}`);
}

function stockfishSuggestionsFromLines() {
  const legal = generateLegalMoves(state, state.turn);
  const entries = [...stockfish.lines.values()]
    .sort((a, b) => a.multipv - b.multipv)
    .slice(0, STOCKFISH_LINES);
  const converted = entries.map((entry) => {
    const move = moveFromUciInPosition(state, entry.uci, legal);
    if (!move) return null;
    const after = previewAfter(move);
    const strongestReply = entry.pv[1] ? moveFromUciInPosition(after, entry.pv[1]) : null;
    const reasons = moveReasons(move, state, after, state.turn);
    const lineReason = stockfishLineReason(strongestReply);
    if (lineReason) reasons.unshift(lineReason);
    return {
      move,
      score: entry.numeric,
      delta: entry.numeric,
      engine: true,
      engineDepth: entry.depth,
      engineGap: 0,
      engineScore: entry.score,
      engineScoreType: entry.scoreType,
      enginePv: entry.pv,
      strongestReply,
      replyPenalty: 0,
      reasons: reasons.slice(0, 4),
      concerns: moveConcerns(move, state, after, state.turn, strongestReply, 0),
    };
  }).filter(Boolean);

  if (!converted.length) return [];
  const bestNumeric = converted[0].score;
  return converted.map((item, index) => ({
    ...item,
    rank: index + 1,
    gap: Math.max(0, bestNumeric - item.score),
    engineGap: Math.max(0, bestNumeric - item.score),
    replyPenalty: Math.max(0, bestNumeric - item.score),
  }));
}

function stockfishLineReason(reply) {
  if (reply) {
    return `Best reply to check: ${describeMove(reply)}.`;
  }
  return "";
}

function moveFromUciInPosition(position, uci, legalMoves) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uci || "")) return null;
  const from = squareIndex(uci.slice(0, 2));
  const to = squareIndex(uci.slice(2, 4));
  const promotion = uci[4]?.toLowerCase() || null;
  const piece = position.board[from];
  if (!piece) return null;
  const moves = legalMoves || generateLegalMoves(position, piece.color);
  return moves.find((move) => move.from === from && move.to === to && (move.promotion || null) === promotion)
    || moves.find((move) => move.from === from && move.to === to)
    || null;
}

function isStockfishPositionReady() {
  const whiteKings = state.board.filter((piece) => piece?.color === "w" && piece.type === "k").length;
  const blackKings = state.board.filter((piece) => piece?.color === "b" && piece.type === "k").length;
  return whiteKings === 1 && blackKings === 1;
}

function mateToCentipawns(mate) {
  const sign = mate >= 0 ? 1 : -1;
  return sign * (100000 - Math.min(Math.abs(mate), 99) * 1000);
}

function setStockfishStatus(message) {
  stockfish.status = message;
  if (els.engineStatus) els.engineStatus.textContent = message;
}

function moveReasons(move, before, after, color) {
  const reasons = [];
  const pieceName = PIECE_NAMES[move.piece.type];
  const from = squareName(move.from);
  const to = squareName(move.to);
  if (move.captured) reasons.push(`It wins the ${PIECE_NAMES[move.captured.type]} on ${to}, changing the material balance immediately.`);
  if (move.promotion) reasons.push(`It promotes a pawn to a ${PIECE_NAMES[move.promotion]}, which is usually a decisive material gain.`);
  if (move.castle) reasons.push("It castles, which tucks the king away and connects the rooks.");
  if (isInCheck(after.board, opposite(color))) reasons.push(`It gives check, so the opponent must answer your threat before following their own plan.`);
  if (["d4", "e4", "d5", "e5"].includes(to)) reasons.push(`It claims central space on ${to}; central pieces influence more of the board.`);
  if ((pieceName === "knight" || pieceName === "bishop") && isHomeBackRank(move.from, move.piece.color)) reasons.push(`It develops a ${pieceName} from ${from}, bringing a sleeping piece into the game.`);
  if (move.piece.type === "p" && Math.abs(coords(move.to).rank - coords(move.from).rank) === 2) reasons.push("It uses a two-square pawn move to take space while the path is still open.");
  if (isSquareAttacked(after.board, move.to, opposite(color)) && move.piece.type !== "k") reasons.push(`Be careful: the moved ${pieceName} can be attacked on ${to}, so the tactic must justify that risk.`);
  if (!reasons.length) reasons.push(`It improves the ${pieceName}'s role from ${from} to ${to} without creating an obvious tactical problem.`);
  return reasons.slice(0, 4);
}

function moveConcerns(move, before, after, color, strongestReply, replyPenalty) {
  const concerns = [];
  const opponent = opposite(color);
  const pieceName = PIECE_NAMES[move.piece.type];
  const to = squareName(move.to);
  const attackers = move.piece.type === "k" ? [] : attackersOf(after.board, move.to, opponent);

  if (strongestReply?.captured?.color === color) {
    concerns.push(`${colorName(opponent)} can answer with ${describeMove(strongestReply)}, which wins your ${PIECE_NAMES[strongestReply.captured.type]}.`);
  }
  if (attackers.length) {
    concerns.push(`the ${pieceName} lands on ${to}, a square ${colorName(opponent).toLowerCase()} attacks with ${describeAttackers(attackers)}.`);
  }
  if (move.piece.type === "q" && isHomeBackRank(move.from, color) && undevelopedMinorCount(after.board, color) >= 2) {
    concerns.push("the queen comes out before the minor pieces are developed, so it may become a target instead of helping development.");
  }
  if (move.piece.type === "p" && ["f", "g"].includes(squareName(move.from)[0]) && isHomePawnRank(move.from, color)) {
    concerns.push("the pawn move loosens squares near your king, so watch for diagonal checks or a quick attack.");
  }
  if (replyPenalty > 80 && strongestReply && !concerns.length) {
    concerns.push(`${colorName(opponent)}'s best reply, ${describeMove(strongestReply)}, changes the evaluation by about ${formatPawns(replyPenalty)}, so check that answer before choosing this move.`);
  }
  return concerns.slice(0, 3);
}

function attackersOf(board, square, byColor) {
  const attackers = [];
  board.forEach((piece, idx) => {
    if (!piece || piece.color !== byColor) return;
    if (pieceAttacksSquare(board, idx, piece, square)) attackers.push({ piece, square: idx });
  });
  return attackers;
}

function pieceAttacksSquare(board, from, piece, target) {
  const start = coords(from);
  const end = coords(target);
  const dr = end.rank - start.rank;
  const df = end.file - start.file;
  const absRank = Math.abs(dr);
  const absFile = Math.abs(df);

  if (piece.type === "p") {
    const direction = piece.color === "w" ? -1 : 1;
    return dr === direction && absFile === 1;
  }
  if (piece.type === "n") return (absRank === 2 && absFile === 1) || (absRank === 1 && absFile === 2);
  if (piece.type === "k") return Math.max(absRank, absFile) === 1;
  if (piece.type === "b") return absRank === absFile && clearRay(board, start, end);
  if (piece.type === "r") return (dr === 0 || df === 0) && clearRay(board, start, end);
  if (piece.type === "q") return (absRank === absFile || dr === 0 || df === 0) && clearRay(board, start, end);
  return false;
}

function clearRay(board, start, end) {
  const rankStep = Math.sign(end.rank - start.rank);
  const fileStep = Math.sign(end.file - start.file);
  let rank = start.rank + rankStep;
  let file = start.file + fileStep;
  while (rank !== end.rank || file !== end.file) {
    if (board[indexOf(rank, file)]) return false;
    rank += rankStep;
    file += fileStep;
  }
  return true;
}

function describeAttackers(attackers) {
  const labels = attackers.slice(0, 2).map(({ piece, square }) => `the ${PIECE_NAMES[piece.type]} on ${squareName(square)}`);
  if (attackers.length > 2) labels.push(`${attackers.length - 2} more piece${attackers.length === 3 ? "" : "s"}`);
  return labels.join(", ");
}

function undevelopedMinorCount(board, color) {
  const homeRank = color === "w" ? 7 : 0;
  return [1, 2, 5, 6].filter((file) => {
    const piece = board[indexOf(homeRank, file)];
    return piece?.color === color && (piece.type === "n" || piece.type === "b");
  }).length;
}

function renderSuggestions() {
  const color = state.turn;
  const legal = generateLegalMoves(state, color);
  if (!legal.length) {
    const check = isInCheck(state.board, color);
    els.suggestions.innerHTML = `<div class="suggestion best"><p><strong>${check ? "Checkmate." : "Stalemate."}</strong> No legal moves are available for ${colorName(color).toLowerCase()}.</p></div>`;
    return;
  }
  if (!state.suggestions.length) {
    els.suggestions.innerHTML = `<div class="suggestion empty"><p><strong>${escapeHtml(stockfishSuggestionHeading())}</strong> ${escapeHtml(stockfishSuggestionMessage())}</p></div>`;
    return;
  }
  els.suggestions.innerHTML = state.suggestions.slice(0, 3).map((item, index) => {
    const move = item.move;
    const reasons = suggestionDetails(item).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
    const reviewLabel = reviewLabelForItem(item);
    return `
      <article class="suggestion ${index === 0 ? "best" : ""} ${item.engine ? "engine" : ""}">
        <span class="review-badge ${escapeHtml(reviewClassForLabel(reviewLabel))}">${escapeHtml(reviewLabel)}</span>
        <div class="move-main">
          <div class="suggestion-top">
            <span class="move-name">${index + 1}. ${escapeHtml(describeMove(move))}</span>
            <span class="score">${escapeHtml(suggestionScoreText(item))}</span>
          </div>
          <div class="move-meta">
            <span class="source-pill">Stockfish</span>
          </div>
          <p class="review-line">${escapeHtml(coachSummary(item))}</p>
        </div>
        ${reasons ? `<ul class="review-detail-list">${reasons}</ul>` : ""}
      </article>
    `;
  }).join("");
}

function suggestionDetails(item) {
  const primary = primaryMoveReason(item);
  return (item.reasons || []).filter((reason) => reason !== primary).slice(0, 3);
}

function stockfishSuggestionHeading() {
  if (!isStockfishPositionReady()) return "Stockfish needs both kings.";
  if (stockfish.unsupported) return "Stockfish cannot run here.";
  if (stockfish.failed) return "Chess engine needs a retry.";
  if (stockfish.retryTimer) return "Restarting chess engine.";
  if (stockfish.searching) return "Analyzing this position.";
  if (stockfish.loading || !stockfish.ready) return "Loading chess engine.";
  return "Awaiting analysis.";
}

function stockfishSuggestionMessage() {
  if (!isStockfishPositionReady()) return "Place exactly one white king and one black king, then Stockfish can calculate legal moves.";
  if (stockfish.unsupported) return "This browser needs WebAssembly and Web Workers to run the chess engine. Open the app from the local server link in Safari or Chrome.";
  if (stockfish.failed) return "Press Re-analyze to restart Stockfish. If this page was opened from a file, use the local server link instead.";
  if (stockfish.retryTimer) return "Stockfish took longer than expected, so the coach is restarting it now.";
  if (stockfish.searching) return "The suggestions will appear here as soon as the engine finishes calculating this board.";
  if (stockfish.loading || !stockfish.ready) return "The browser engine is starting. This can take a few seconds the first time.";
  return "Press Re-analyze to calculate move suggestions for this position.";
}

function renderLesson(message) {
  if (message.trim().startsWith("<")) {
    setLesson(message.trim());
    return;
  }
  const best = state.suggestions[0];
  const teacher = best
    ? `<p><strong>Top engine move:</strong> ${escapeHtml(describeMove(best.move))}. ${escapeHtml(coachSummary(best))}</p>`
    : `<p><strong>Waiting for analysis.</strong> Recommendations appear after the engine analyzes this board.</p>`;
  setLesson(`
    <p>${escapeHtml(message)}</p>
    ${teacher}
  `);
}

function setLesson(html) {
  els.lesson.innerHTML = html;
}

function humanMoveLesson(move, picked, best, allSuggestions) {
  const moveText = describeMove(move);
  if (move.free) {
    return `
      <p><strong>You played ${escapeHtml(moveText)} with free move override.</strong></p>
      <p>I accepted it as a board-control action, then refreshed the AI model from the resulting piece placement. Legal coaching resumes from the new position if both kings are present.</p>
    `;
  }
  if (!best) {
    return `
      <p><strong>You played ${escapeHtml(moveText)}.</strong> The engine had not finished analyzing the previous position, so I cannot honestly grade that move yet.</p>
      <p>The board has been refreshed from the new piece placement, and the next recommendation is being calculated now.</p>
    `;
  }
  const rank = picked ? allSuggestions.findIndex((candidate) => sameMove(candidate.move, move)) + 1 : -1;
  const scoreGap = picked ? best.score - picked.score : 180;
  const bestText = describeMove(best.move);
  const moveReasonsText = moveReasons(move, state, previewAfter(move), move.piece.color).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
  const reviewLabel = reviewLabelForGap(scoreGap, sameMove(best.move, move));

  if (sameMove(best.move, move) || scoreGap < 35) {
    return `
      <p><strong>${escapeHtml(reviewLabel)}: ${escapeHtml(moveText)}.</strong> ${sameMove(best.move, move) ? "You matched the top engine move." : "This stays very close to the top engine move."}</p>
      <ul>${moveReasonsText}</ul>
      <p><strong>Review note:</strong> keep checking the opponent's best reply before you commit to the move.</p>
    `;
  }

  const gapText = formatPawns(scoreGap);
  return `
    <p><strong>${escapeHtml(reviewLabel)}: ${escapeHtml(moveText)}.</strong> Better was <strong>${escapeHtml(bestText)}</strong>, with about a ${escapeHtml(gapText)} evaluation swing.</p>
    <ul>${moveReasonsText}</ul>
    <p><strong>Engine note:</strong> ${escapeHtml(nonOptimalReason(move, best))}</p>
    <p><strong>Review note:</strong> compare your candidate move with the engine move and ask which one creates the bigger threat or solves the more urgent problem.</p>
  `;
}

function aiMoveLesson(move, picked) {
  const item = picked || { reasons: [`The engine selected ${describeMove(move)} from its current calculated line.`], delta: 0, engine: true };
  const reasons = item.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("");
  return `
    <p><strong>${colorName(move.piece.color)} AI played ${escapeHtml(describeMove(move))}.</strong></p>
    <p>${escapeHtml(coachSummary(item))}</p>
    <ul>${reasons}</ul>
  `;
}

function nonOptimalReason(move, best) {
  if (best.move.captured && !move.captured) return `the best move wins material on ${squareName(best.move.to)}, while your move lets that chance wait or disappear.`;
  if (best.move.castle && !move.castle) return "the best move improves king safety immediately; your move leaves the king in the center a bit longer.";
  if (isHomeBackRank(move.from, move.piece.color) && !(move.piece.type === "n" || move.piece.type === "b")) return "your move spends time with a less urgent piece while development still matters.";
  if (["d4", "e4", "d5", "e5"].includes(squareName(best.move.to)) && !["d4", "e4", "d5", "e5"].includes(squareName(move.to))) return "the best move contests the center more directly, which usually gives your pieces better future squares.";
  return `the best move creates a stronger combination of safety, activity, and opponent pressure than ${describeMove(move)}.`;
}

function explainIllegalMove(from, to) {
  const piece = state.board[from];
  if (!piece) return "There is no piece selected to move.";
  const pseudo = generatePseudoMoves(state, piece.color, true).filter((move) => move.from === from && move.to === to);
  if (pseudo.length && isInCheck(previewAfter(pseudo[0]).board, piece.color)) {
    return `<p><strong class="warning">Illegal move:</strong> ${escapeHtml(describeMove(pseudo[0]))} would leave your king in check. In chess class terms: your king's safety is the first rule, even when a move looks active.</p>`;
  }
  return `<p><strong class="warning">Illegal move:</strong> ${escapeHtml(PIECE_NAMES[piece.type])} from ${squareName(from)} cannot move to ${squareName(to)} in the current position. Turn on Free move override if you want to control the board outside normal chess rules.</p>`;
}

function coachSummary(item) {
  const idea = reviewSentence(primaryMoveReason(item) || "it improves one of your pieces");
  const concern = plainSentence(item.concerns?.[0] || "");
  if (item.engine) {
    if (item.rank === 1) return `${idea}.${concern ? ` Watch: ${concern}.` : ""}`;
    if (item.engineGap < 35) return `${idea}. This is practically tied with the best move.${concern ? ` Watch: ${concern}.` : ""}`;
    if (item.engineGap < 120) return `${idea}.${concern ? ` Check: ${concern}.` : ` It is only ${formatPawns(item.engineGap)} behind the best move.`}`;
    return `About ${formatPawns(item.engineGap)} worse than the best move. ${concern ? `Main issue: ${concern}.` : `${idea}.`}`;
  }
  if (item.delta > 250) return `This creates a major swing because ${idea}.`;
  if (item.delta > 80) return `This is strong because ${idea}${concern ? ` Watch for this reply: ${concern}.` : "."}`;
  if (item.delta > 20) return `This makes steady progress because ${idea}${concern ? ` Main thing to check: ${concern}.` : "."}`;
  if (item.delta > -40) return concern
    ? `This is playable because ${idea}. The concern is that ${concern}.`
    : `This keeps the position healthy because ${idea}.`;
  return concern
    ? `This move is legal, but the concern is that ${concern}.`
    : `This move is legal, but it does not improve activity, king safety, or pressure as much as the higher-ranked choices.`;
}

function primaryMoveReason(item) {
  const reasons = item.reasons || [];
  if (!item.engine) return reasons[0];
  return reasons.find((reason) => !reason.startsWith("Best reply to check:")) || reasons[0];
}

function reviewLabelForItem(item) {
  if (!item.engine) return "Coach";
  return reviewLabelForGap(item.engineGap, item.rank === 1);
}

function reviewLabelForGap(gap, isBest = false) {
  if (isBest) return "Best move";
  if (gap < 50) return "Excellent";
  if (gap < 100) return "Good";
  if (gap < 200) return "Inaccuracy";
  if (gap < 350) return "Mistake";
  return "Blunder risk";
}

function reviewClassForLabel(label) {
  return label.toLowerCase().replace(/\s+/g, "-");
}

function reviewSentence(text) {
  const clean = String(text).trim().replace(/[.!?]+$/, "");
  if (!clean) return "";
  return clean[0].toUpperCase() + clean.slice(1);
}

function plainSentence(text) {
  const clean = String(text).trim().replace(/[.!?]+$/, "");
  return clean ? clean[0].toLowerCase() + clean.slice(1) : "";
}

function renderModel() {
  const fen = boardToFen();
  if (els.fenText) els.fenText.textContent = fen;
  if (els.fenInput) els.fenInput.value = fen;
  const pieces = inventory();
  if (els.pieceInventory) {
    els.pieceInventory.innerHTML = ["w", "b"].map((color) => {
      const text = pieces[color].length ? pieces[color].join(", ") : "No pieces";
      return `<div class="inventory-row"><strong>${colorName(color)}</strong><span>${escapeHtml(text)}</span></div>`;
    }).join("");
  }
  if (els.modelCopyBlock) els.modelCopyBlock.value = boardModelCopyBlock();
  if (els.modelClipboardBuffer) els.modelClipboardBuffer.value = boardModelCopyBlock();
}

function renderGraphs() {
  renderEvaluationGraph();
}

function recordEvaluation(bestSuggestion) {
  if (!bestSuggestion?.engine) return;
  const fen = boardToFen();
  const ply = state.moveLog.length;
  const score = whitePerspectiveScore(bestSuggestion);
  const mate = whitePerspectiveMate(bestSuggestion);
  const entry = {
    ply,
    fen,
    score,
    mate,
    label: ply ? state.moveLog[ply - 1]?.uci || `Move ${ply}` : "Start",
    display: evaluationDisplay(score, mate),
  };
  const existingIndex = state.evalHistory.findIndex((item) => item.fen === fen || item.ply === ply);
  if (existingIndex >= 0) state.evalHistory[existingIndex] = entry;
  else state.evalHistory.push(entry);
  state.evalHistory = state.evalHistory
    .sort((a, b) => a.ply - b.ply)
    .slice(-MAX_EVAL_HISTORY);
  saveCurrentState();
}

function whitePerspectiveScore(item) {
  const raw = item.engineScoreType === "mate" ? mateToCentipawns(item.engineScore) : item.engineScore;
  return stockfish.color === "w" ? raw : -raw;
}

function whitePerspectiveMate(item) {
  if (item.engineScoreType !== "mate") return null;
  return stockfish.color === "w" ? item.engineScore : -item.engineScore;
}

function renderEvaluationGraph() {
  if (!els.evalGraph || !els.evalSummary) return;
  const points = state.evalHistory.slice().sort((a, b) => a.ply - b.ply);
  if (!points.length) {
    els.evalSummary.textContent = "Waiting for Stockfish";
    els.evalGraph.innerHTML = `
      <rect x="0" y="0" width="320" height="150" rx="10" class="eval-bg"></rect>
      <line x1="18" y1="75" x2="302" y2="75" class="eval-zero"></line>
      <text x="160" y="80" text-anchor="middle" class="eval-empty">Analysis appears after Stockfish finishes</text>
    `;
    return;
  }

  const width = 320;
  const height = 150;
  const pad = 18;
  const graphWidth = width - pad * 2;
  const graphHeight = height - pad * 2;
  const maxAbs = 600;
  const last = points[points.length - 1];
  const xFor = (index) => points.length === 1 ? width / 2 : pad + (index / (points.length - 1)) * graphWidth;
  const yFor = (score) => {
    const clamped = Math.max(-maxAbs, Math.min(maxAbs, score));
    return pad + graphHeight / 2 - (clamped / maxAbs) * (graphHeight / 2);
  };
  const path = points.map((entry, index) => `${index ? "L" : "M"} ${xFor(index).toFixed(1)} ${yFor(entry.score).toFixed(1)}`).join(" ");
  const circles = points.map((entry, index) => {
    const x = xFor(index).toFixed(1);
    const y = yFor(entry.score).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="3.5" class="eval-point"><title>${escapeHtml(entry.label)}: ${escapeHtml(entry.display)}</title></circle>`;
  }).join("");

  els.evalSummary.textContent = last.display;
  els.evalGraph.innerHTML = `
    <rect x="0" y="0" width="320" height="150" rx="10" class="eval-bg"></rect>
    <line x1="${pad}" y1="${pad}" x2="${width - pad}" y2="${pad}" class="eval-guide"></line>
    <line x1="${pad}" y1="${height / 2}" x2="${width - pad}" y2="${height / 2}" class="eval-zero"></line>
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="eval-guide"></line>
    <text x="${pad}" y="${pad - 5}" class="eval-label">White +6</text>
    <text x="${pad}" y="${height - 5}" class="eval-label">Black +6</text>
    <path d="${path}" class="eval-line"></path>
    ${circles}
  `;
}

function renderLearningTools() {
  renderMaterialTool();
  renderOpeningTool();
  renderPlanTool();
  renderWhyNotTool();
  renderMistakeReviewTool();
  renderEndgameTool();
}

function renderMaterialTool() {
  const totals = materialTotals();
  const combined = Math.max(1, totals.white + totals.black);
  const whitePct = Math.max(0, Math.round((totals.white / combined) * 100));
  const blackPct = Math.max(0, 100 - whitePct);
  const diff = totals.white - totals.black;
  els.whiteMaterialBar.style.width = `${whitePct}%`;
  els.blackMaterialBar.style.width = `${blackPct}%`;
  els.materialSummary.textContent = diff === 0
    ? "Material even"
    : `${diff > 0 ? "White" : "Black"} +${Math.abs(diff / 100).toFixed(1)}`;
  els.materialDetails.textContent = `White ${formatMaterial(totals.white)}. Black ${formatMaterial(totals.black)}. Pawns are 1 point, knights and bishops about 3, rooks 5, queen 9.`;
}

function renderOpeningTool() {
  const opening = currentOpening();
  els.openingPly.textContent = `${state.moveLog.length} ply`;
  els.openingInfo.innerHTML = `
    <p><strong>${escapeHtml(opening.name)}</strong></p>
    <p>${escapeHtml(opening.idea)}</p>
  `;
}

function renderPlanTool() {
  els.planSummary.innerHTML = planSummaryHtml();
}

function renderWhyNotTool() {
  const legal = generateLegalMoves(state, state.turn);
  const fen = boardToFen();
  const previousValue = els.whyNotMove.value;
  els.whyNotMove.innerHTML = legal.length
    ? legal.map((move) => `<option value="${escapeHtml(moveToUci(move))}">${escapeHtml(describeMove(move))}</option>`).join("")
    : `<option value="">No legal moves</option>`;
  if (legal.some((move) => moveToUci(move) === previousValue)) els.whyNotMove.value = previousValue;
  els.compareMove.disabled = !legal.length;
  if (els.whyNotResult.dataset.fen !== fen) {
    els.whyNotResult.dataset.fen = fen;
    els.whyNotResult.textContent = legal.length
      ? "Choose a legal move to compare it against the engine's current top move."
      : "No legal move is available in this position.";
  }
}

function renderMistakeReviewTool() {
  const mistakes = mistakeReviewItems();
  if (!mistakes.length) {
    els.mistakeList.innerHTML = `<p class="tool-note">No mistakes are tracked yet. Play a few analyzed moves and this list will show inaccuracies, mistakes, and blunders.</p>`;
    els.reviewNextMistake.disabled = true;
    return;
  }
  els.reviewNextMistake.disabled = false;
  els.mistakeList.innerHTML = mistakes.map((item, index) => `
    <article class="mistake-item">
      <span class="review-badge ${escapeHtml(reviewClassForLabel(item.label))}">${escapeHtml(item.label)}</span>
      <div>
        <strong>${escapeHtml(item.moveText)}</strong>
        <p>${escapeHtml(item.summary)}</p>
      </div>
      <button type="button" data-review-ply="${item.ply}" data-review-index="${index}">Show</button>
    </article>
  `).join("");
}

function renderEndgameTool() {
  const info = endgameInfo();
  els.endgamePhase.textContent = info.phase;
  els.endgameHelper.innerHTML = info.lines.map((line, index) => index === 0
    ? `<p><strong>${escapeHtml(line)}</strong></p>`
    : `<p>${escapeHtml(line)}</p>`
  ).join("");
}

function compareCandidateMove(showLesson = true) {
  const legal = generateLegalMoves(state, state.turn);
  const move = moveFromUciInPosition(state, els.whyNotMove.value, legal);
  if (!move) {
    els.whyNotResult.textContent = "Choose a legal move first.";
    return;
  }
  const best = currentBestSuggestion();
  const matching = state.suggestions.find((item) => sameMove(item.move, move));
  const after = previewAfter(move);
  const reasons = moveReasons(move, state, after, state.turn);
  const concerns = moveConcerns(move, state, after, state.turn, matching?.strongestReply || null, matching?.engineGap || 0);
  let html;
  if (!best) {
    html = `
      <p><strong>${escapeHtml(describeMove(move))}</strong></p>
      <p>Stockfish has not finished this position yet, so I can explain the move but cannot grade it against the best line.</p>
      <p>${escapeHtml(reasons[0] || "It is legal, but wait for analysis to judge it accurately.")}</p>
    `;
  } else if (sameMove(best.move, move)) {
    html = `
      <p><strong>Best move: ${escapeHtml(describeMove(move))}.</strong></p>
      <p>${escapeHtml(coachSummary(best))}</p>
      <p>${escapeHtml(coachLevelDetail("It matches the engine's first choice, so the main study task is to understand the follow-up plan instead of searching for a better move."))}</p>
    `;
  } else {
    const gap = matching?.engineGap ?? 180;
    const label = reviewLabelForGap(gap, false);
    const concern = concerns[0] || nonOptimalReason(move, best);
    html = `
      <p><strong>${escapeHtml(label)}: ${escapeHtml(describeMove(move))}.</strong> Better is <strong>${escapeHtml(describeMove(best.move))}</strong>.</p>
      <p>${escapeHtml(formatPawns(gap))} behind the top engine move. ${escapeHtml(concern)}</p>
      <p>${escapeHtml(coachLevelDetail("Compare which move improves a piece, answers the opponent's threat, and creates the bigger problem for the other side."))}</p>
    `;
  }
  els.whyNotResult.dataset.fen = boardToFen();
  els.whyNotResult.innerHTML = html;
  if (showLesson) setLesson(html);
}

function reviewNextMistake() {
  const mistakes = mistakeReviewItems();
  if (!mistakes.length) return;
  state.reviewMistakeIndex = (state.reviewMistakeIndex + 1) % mistakes.length;
  reviewMistakeAt(mistakes[state.reviewMistakeIndex].ply);
}

function reviewMistakeAt(ply) {
  const item = mistakeReviewItems().find((mistake) => mistake.ply === ply);
  if (!item) return;
  const parsed = parseFen(item.fen);
  if (parsed.ok) {
    pushHistory("Mistake review");
    state.board = parsed.board;
    state.turn = parsed.turn;
    state.castling = parsed.castling;
    state.enPassant = parsed.enPassant;
    state.halfmove = parsed.halfmove;
    state.fullmove = parsed.fullmove;
    const uci = state.moveLog[ply - 1]?.uci || "";
    state.lastMove = /^[a-h][1-8][a-h][1-8]/.test(uci) ? { from: squareIndex(uci.slice(0, 2)), to: squareIndex(uci.slice(2, 4)) } : null;
    state.selected = null;
    state.legalTargets = [];
  }
  const html = `
    <p><strong>${escapeHtml(item.label)} reviewed: ${escapeHtml(item.moveText)}.</strong></p>
    <p>${escapeHtml(item.summary)}</p>
    <p><strong>Study task:</strong> replay the position and ask what the opponent threatens after this move. Then compare it with the engine's recommended move.</p>
  `;
  refresh(html);
}

function answerCoachQuestion() {
  const question = els.coachQuestion.value.trim();
  if (!question) {
    els.coachAnswer.textContent = "Ask about a move, plan, piece, opening, endgame, material, or king safety.";
    return;
  }
  const answer = coachAnswerFor(question);
  els.coachAnswer.innerHTML = answer;
  setLesson(answer);
}

function currentBestSuggestion() {
  const fen = boardToFen();
  if (state.suggestionFen === fen && state.suggestionSource === "stockfish" && state.suggestions.length) {
    return state.suggestions[0];
  }
  return null;
}

function materialTotals() {
  return state.board.reduce((totals, piece) => {
    if (!piece || piece.type === "k") return totals;
    if (piece.color === "w") totals.white += PIECE_VALUES[piece.type];
    else totals.black += PIECE_VALUES[piece.type];
    return totals;
  }, { white: 0, black: 0 });
}

function formatMaterial(value) {
  return `${(value / 100).toFixed(1)} points`;
}

function currentOpening() {
  const played = state.moveLog.map((entry) => entry.uci);
  let match = OPENING_BOOK[0];
  OPENING_BOOK.forEach((opening) => {
    if (opening.moves.length < match.moves.length) return;
    const isMatch = opening.moves.every((move, index) => played[index] === move);
    if (isMatch) match = opening;
  });
  if (played.length > 12 && match.moves.length < 4) {
    return {
      name: "Middlegame position",
      idea: "The opening label is no longer the main guide. Use the plan summary, material bar, and engine line to choose a useful plan.",
      moves: [],
    };
  }
  return match;
}

function planSummaryHtml() {
  const best = currentBestSuggestion();
  const opening = currentOpening();
  const endgame = endgameInfo();
  const plan = [];
  if (best) {
    plan.push(`Candidate move: ${describeMove(best.move)}.`);
    plan.push(primaryMoveReason(best) || coachSummary(best));
  } else {
    plan.push("Wait for Stockfish to finish, then use the top move as your concrete candidate.");
  }
  if (state.moveLog.length <= 10) plan.push(`Opening idea: ${opening.idea}`);
  if (endgame.isEndgame) plan.push(`Endgame idea: ${endgame.lines[1] || endgame.lines[0]}`);
  plan.push(kingSafetyPlan(state.turn));
  return plan.slice(0, coachLevelLimit()).map((line, index) => index === 0
    ? `<p><strong>${escapeHtml(line)}</strong></p>`
    : `<p>${escapeHtml(line)}</p>`
  ).join("");
}

function kingSafetyPlan(color) {
  const king = findKing(state.board, color);
  if (king === null) return "King safety: place both kings before trusting legal-move coaching.";
  if (isInCheck(state.board, color)) return "King safety: first solve the check, then think about plans.";
  const attackers = attackersOf(state.board, king, opposite(color)).length;
  if (attackers) return "King safety: the king is under pressure, so prioritize checks, captures, and defensive resources.";
  return "King safety: no immediate check is present, so you can compare activity, material, and threats.";
}

function coachLevelLimit() {
  if (state.coachLevel === "beginner") return 2;
  if (state.coachLevel === "advanced") return 5;
  return 3;
}

function coachLevelDetail(text) {
  if (state.coachLevel === "beginner") return text.split(",")[0] || text;
  if (state.coachLevel === "advanced") return `${text} Also check forcing replies first: checks, captures, threats, and only then quiet improvements.`;
  return text;
}

function coachLevelName(level) {
  if (level === "beginner") return "Beginner";
  if (level === "advanced") return "Advanced";
  return "Intermediate";
}

function mistakeReviewItems() {
  const points = state.evalHistory.slice().sort((a, b) => a.ply - b.ply);
  const byPly = new Map(points.map((entry) => [entry.ply, entry]));
  const items = [];
  for (const current of points) {
    if (!current.ply) continue;
    const previous = byPly.get(current.ply - 1);
    if (!previous) continue;
    const mover = current.ply % 2 === 1 ? "w" : "b";
    const loss = mover === "w" ? previous.score - current.score : current.score - previous.score;
    if (loss < 80) continue;
    const label = reviewLabelForGap(loss, false);
    const move = state.moveLog[current.ply - 1];
    const moveText = move ? `${current.ply}. ${move.text}` : `Move ${current.ply}`;
    const side = colorName(mover);
    items.push({
      ply: current.ply,
      fen: current.fen,
      label,
      loss,
      moveText,
      summary: `${side}'s move changed the evaluation by about ${formatPawns(loss)}. Look for the opponent's strongest reply and compare this with the engine recommendation.`,
    });
  }
  return items;
}

function endgameInfo() {
  const pieces = state.board.filter(Boolean);
  const nonKings = pieces.filter((piece) => piece.type !== "k");
  const queens = nonKings.filter((piece) => piece.type === "q").length;
  const rooks = nonKings.filter((piece) => piece.type === "r").length;
  const minors = nonKings.filter((piece) => piece.type === "b" || piece.type === "n").length;
  const pawns = nonKings.filter((piece) => piece.type === "p").length;
  if (nonKings.length > 10 || queens > 1) {
    return {
      isEndgame: false,
      phase: "Middlegame",
      lines: [
        "Not an endgame yet.",
        "Focus on king safety, active pieces, pawn breaks, and the best engine candidate.",
      ],
    };
  }
  if (rooks) {
    return {
      isEndgame: true,
      phase: "Rook ending",
      lines: [
        "Rook-ending rules apply.",
        "Activate the rook, put it behind passed pawns, and keep your king active without walking into checks.",
      ],
    };
  }
  if (!rooks && !queens && !minors) {
    return {
      isEndgame: true,
      phase: "King and pawn ending",
      lines: [
        "King-and-pawn ending.",
        "Use opposition, create passed pawns, and calculate pawn races before moving.",
      ],
    };
  }
  if (minors && pawns <= 6) {
    return {
      isEndgame: true,
      phase: "Minor-piece ending",
      lines: [
        "Minor-piece ending.",
        "Improve king activity, attack pawns on both colors when possible, and avoid trading into a lost pawn race.",
      ],
    };
  }
  return {
    isEndgame: true,
    phase: "Simplified ending",
    lines: [
      "Simplified ending.",
      "Centralize the king, improve the worst piece, and convert material into passed pawns.",
    ],
  };
}

function coachAnswerFor(question) {
  const q = question.toLowerCase();
  const best = currentBestSuggestion();
  const opening = currentOpening();
  const endgame = endgameInfo();
  if (q.includes("opening") || q.includes("book")) {
    return `<p><strong>${escapeHtml(opening.name)}.</strong> ${escapeHtml(opening.idea)}</p>`;
  }
  if (q.includes("endgame") || q.includes("ending") || q.includes("pawn race")) {
    return endgame.lines.map((line, index) => index === 0
      ? `<p><strong>${escapeHtml(line)}</strong></p>`
      : `<p>${escapeHtml(line)}</p>`
    ).join("");
  }
  if (q.includes("best") || q.includes("move") || q.includes("play")) {
    if (!best) return `<p><strong>Wait for analysis.</strong> Stockfish has not finished this position yet.</p>`;
    return `<p><strong>Best candidate: ${escapeHtml(describeMove(best.move))}.</strong> ${escapeHtml(coachSummary(best))}</p>`;
  }
  if (q.includes("plan") || q.includes("idea")) return planSummaryHtml();
  if (q.includes("material") || q.includes("points")) {
    const totals = materialTotals();
    const diff = totals.white - totals.black;
    return `<p><strong>Material:</strong> ${diff === 0 ? "Even." : `${diff > 0 ? "White" : "Black"} leads by ${formatPawns(Math.abs(diff))}.`}</p>`;
  }
  if (q.includes("king") || q.includes("safe") || q.includes("check")) {
    return `<p><strong>King safety:</strong> ${escapeHtml(kingSafetyPlan(state.turn))}</p>`;
  }
  return `
    <p><strong>Coach answer:</strong> ${escapeHtml(planTextSummary())}</p>
    <p>${escapeHtml(coachLevelDetail("Use the engine candidate as a guide, but explain it by checking threats, material, king safety, and piece activity."))}</p>
  `;
}

function planTextSummary() {
  const best = currentBestSuggestion();
  if (best) return `Start by considering ${describeMove(best.move)} because ${plainSentence(coachSummary(best))}.`;
  return "Start by identifying checks, captures, threats, and your worst-placed piece.";
}

function renderStatus() {
  const legal = generateLegalMoves(state, state.turn);
  const check = isInCheck(state.board, state.turn);
  const material = materialBalance();
  if (!legal.length) {
    els.gameStatus.textContent = check ? `${colorName(state.turn)} is checkmated` : "Stalemate";
  } else {
    els.gameStatus.textContent = `${colorName(state.turn)} to move${check ? " - in check" : ""} · ${material}`;
  }
}

function renderSharePanel() {
  const info = shareLinkInfo();
  els.shareUrl.value = info.url;
  els.shareNotice.textContent = info.notice;
}

function shareLinkInfo() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  const host = window.location.hostname;
  const isFile = window.location.protocol === "file:";
  const isLoopback = ["localhost", "127.0.0.1", "::1", ""].includes(host);
  if (isFile) {
    return {
      url: window.location.href,
      notice: "This file link only works on this device.",
      localOnly: true,
    };
  }
  if (isLoopback) {
    return {
      url: url.href,
      notice: "This link works on this device. Use the Network URL from serve.py for a phone.",
      localOnly: true,
    };
  }
  return {
    url: url.href,
    notice: "Ready to share with anyone who can reach this address.",
    localOnly: false,
  };
}

async function copyShareLink() {
  const info = shareLinkInfo();
  const copied = await copyText(info.url);
  const extra = info.localOnly
    ? " For your phone or another person on the same Wi-Fi, run python3 serve.py and use the Network URL it prints."
    : " Send it to another person so they can open the same app.";
  renderLesson(`<p><strong>${copied ? "Share link copied." : "Share link selected."}</strong>${escapeHtml(extra)}</p>`);
}

async function shareAppLink() {
  const info = shareLinkInfo();
  if (navigator.share && !info.localOnly) {
    try {
      await navigator.share({
        title: "Chess Coach Board",
        text: "Practice chess with move suggestions and classroom-style explanations.",
        url: info.url,
      });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copyShareLink();
}

async function copyModelBlock() {
  const text = boardModelCopyBlock();
  const fallback = els.modelClipboardBuffer || els.modelCopyBlock || els.fenInput;
  const copied = await copyText(text, fallback);
  renderLesson(`<p><strong>${copied ? "AI board model copied." : "AI board model selected."}</strong> Paste it into an AI chat to ask for move suggestions, explanations, or a second opinion on the current position.</p>`);
}

async function copyText(text, fallbackElement = els.shareUrl) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackElement && "value" in fallbackElement) fallbackElement.value = text;
    fallbackElement?.focus();
    fallbackElement?.select();
    return false;
  }
}

function boardModelCopyBlock() {
  const pieces = inventoryForAi();
  return [
    "Chess position for AI analysis",
    `FEN: ${boardToFen()}`,
    `Side to move: ${colorName(state.turn)}`,
    `Castling rights: ${castlingRightsText()}`,
    `En passant target: ${state.enPassant === null ? "none" : squareName(state.enPassant)}`,
    `Halfmove clock: ${state.halfmove}`,
    `Fullmove number: ${state.fullmove}`,
    "",
    "Pieces seen:",
    `White: ${pieces.w.length ? pieces.w.join("; ") : "No pieces"}`,
    `Black: ${pieces.b.length ? pieces.b.join("; ") : "No pieces"}`,
    "",
    "Ask: Suggest the best moves for the side to move. Explain the tactical ideas, strategic plans, and why weaker candidate moves are less optimal as if teaching a chess student.",
  ].join("\n");
}

function castlingRightsText() {
  const rights = [];
  if (state.castling.wK) rights.push("White king side");
  if (state.castling.wQ) rights.push("White queen side");
  if (state.castling.bK) rights.push("Black king side");
  if (state.castling.bQ) rights.push("Black queen side");
  return rights.length ? rights.join(", ") : "none";
}

function saveCurrentState() {
  try {
    window.localStorage.setItem(SAVED_STATE_KEY, JSON.stringify(savedStateSnapshot()));
  } catch {
    // Saving is a convenience feature; the board should keep working if storage is blocked.
  }
}

function restoreSavedState() {
  const keys = [SAVED_STATE_KEY, ...LEGACY_SAVED_STATE_KEYS];
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      if (applySavedState(JSON.parse(raw))) {
        if (key !== SAVED_STATE_KEY) saveCurrentState();
        return true;
      }
      window.localStorage.removeItem(key);
    } catch {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore storage cleanup failures.
      }
    }
  }
  return false;
}

function savedStateSnapshot() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    board: cloneBoard(state.board),
    turn: state.turn,
    castling: { ...state.castling },
    enPassant: state.enPassant,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
    orientation: state.orientation,
    history: state.history.slice(-MAX_SAVED_HISTORY).map((entry) => ({
      board: cloneBoard(entry.board),
      turn: entry.turn,
      castling: { ...entry.castling },
      enPassant: entry.enPassant,
      halfmove: entry.halfmove,
      fullmove: entry.fullmove,
      lastMove: entry.lastMove ? { ...entry.lastMove } : null,
      moveLog: (entry.moveLog || []).map((move) => ({ ...move })),
      label: entry.label,
    })),
    moveLog: state.moveLog.map((entry) => ({ ...entry })),
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    evalHistory: state.evalHistory.map((entry) => ({ ...entry })),
    coachLevel: state.coachLevel,
    whiteMode: state.whiteMode,
    blackMode: state.blackMode,
    promotionChoice: state.promotionChoice,
    editMode: state.editMode,
    freeMove: state.freeMove,
    palettePiece: state.palettePiece ? { ...state.palettePiece } : null,
  };
}

function applySavedState(saved) {
  if (!saved || saved.version !== 1) return false;
  const board = sanitizeBoard(saved.board);
  if (!board) return false;
  if (!isRestorableSavedBoard(board, saved)) return false;

  state.board = board;
  state.turn = colorOrDefault(saved.turn, "w");
  state.castling = sanitizeCastling(saved.castling);
  state.enPassant = boardIndexOrNull(saved.enPassant);
  state.halfmove = wholeNumberOrDefault(saved.halfmove, 0, 0);
  state.fullmove = wholeNumberOrDefault(saved.fullmove, 1, 1);
  state.orientation = colorOrDefault(saved.orientation, "w");
  state.selected = null;
  state.legalTargets = [];
  state.history = sanitizeHistory(saved.history);
  state.moveLog = sanitizeMoveLog(saved.moveLog);
  state.lastMove = sanitizeLastMove(saved.lastMove);
  state.evalHistory = sanitizeEvalHistory(saved.evalHistory);
  state.coachLevel = coachLevelOrDefault(saved.coachLevel, "intermediate");
  state.whiteMode = modeOrDefault(saved.whiteMode, "manual");
  state.blackMode = modeOrDefault(saved.blackMode, "manual");
  state.promotionChoice = TYPES.includes(saved.promotionChoice) && saved.promotionChoice !== "k" && saved.promotionChoice !== "p"
    ? saved.promotionChoice
    : "q";
  state.editMode = Boolean(saved.editMode);
  state.freeMove = Boolean(saved.freeMove);
  state.palettePiece = sanitizePalettePiece(saved.palettePiece);
  state.lastLesson = "";
  state.suggestions = [];
  state.suggestionFen = "";
  state.suggestionSource = "stockfish";
  state.aiTimer = null;
  return true;
}

function isRestorableSavedBoard(board, saved) {
  const pieceCount = board.filter(Boolean).length;
  if (!pieceCount) return false;
  const whiteKings = board.filter((piece) => piece?.color === "w" && piece.type === "k").length;
  const blackKings = board.filter((piece) => piece?.color === "b" && piece.type === "k").length;
  if (whiteKings === 1 && blackKings === 1) return true;
  return Boolean(saved.editMode || saved.freeMove);
}

function sanitizeHistory(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(-MAX_SAVED_HISTORY).map((entry) => {
    const board = sanitizeBoard(entry?.board);
    if (!board) return null;
    return {
      board,
      turn: colorOrDefault(entry.turn, "w"),
      castling: sanitizeCastling(entry.castling),
      enPassant: boardIndexOrNull(entry.enPassant),
      halfmove: wholeNumberOrDefault(entry.halfmove, 0, 0),
      fullmove: wholeNumberOrDefault(entry.fullmove, 1, 1),
      lastMove: sanitizeLastMove(entry.lastMove),
      moveLog: sanitizeMoveLog(entry.moveLog),
      label: String(entry.label || "Saved move").slice(0, 80),
    };
  }).filter(Boolean);
}

function sanitizeBoard(board) {
  if (!Array.isArray(board) || board.length !== 64) return null;
  const clean = [];
  for (const piece of board) {
    const sanitized = sanitizePiece(piece);
    if (sanitized === undefined) return null;
    clean.push(sanitized);
  }
  return clean;
}

function sanitizePiece(piece) {
  if (piece === null || piece === undefined) return null;
  if (["w", "b"].includes(piece.color) && TYPES.includes(piece.type)) {
    return { color: piece.color, type: piece.type };
  }
  return undefined;
}

function sanitizePalettePiece(piece) {
  const sanitized = sanitizePiece(piece);
  return sanitized === undefined ? null : sanitized;
}

function sanitizeCastling(castling) {
  return {
    wK: Boolean(castling?.wK),
    wQ: Boolean(castling?.wQ),
    bK: Boolean(castling?.bK),
    bQ: Boolean(castling?.bQ),
  };
}

function sanitizeMoveLog(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(-MAX_SAVED_HISTORY * 2).map((entry) => ({
    text: String(entry?.text || "").slice(0, 80),
    uci: String(entry?.uci || "").slice(0, 8),
    color: colorOrDefault(entry?.color, "w"),
  }));
}

function sanitizeEvalHistory(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(-MAX_EVAL_HISTORY).map((entry) => {
    const ply = wholeNumberOrDefault(entry?.ply, 0, 0);
    const score = Number(entry?.score);
    if (!Number.isFinite(score)) return null;
    const mate = entry?.mate === null || entry?.mate === undefined ? null : Number(entry.mate);
    return {
      ply,
      fen: String(entry?.fen || "").slice(0, 120),
      score,
      mate: Number.isFinite(mate) ? mate : null,
      label: String(entry?.label || (ply ? `Move ${ply}` : "Start")).slice(0, 80),
      display: String(entry?.display || evaluationDisplay(score, Number.isFinite(mate) ? mate : null)).slice(0, 80),
    };
  }).filter(Boolean);
}

function sanitizeLastMove(move) {
  if (!move) return null;
  const from = boardIndexOrNull(move.from);
  const to = boardIndexOrNull(move.to);
  return from === null || to === null ? null : { from, to };
}

function boardIndexOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < 64 ? number : null;
}

function colorOrDefault(value, fallback) {
  return ["w", "b"].includes(value) ? value : fallback;
}

function modeOrDefault(value, fallback) {
  return ["manual", "human", "ai"].includes(value) ? value : fallback;
}

function coachLevelOrDefault(value, fallback) {
  return ["beginner", "intermediate", "advanced"].includes(value) ? value : fallback;
}

function wholeNumberOrDefault(value, fallback, min) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min ? Math.floor(number) : fallback;
}

function registerOfflineCache() {
  const canRegister = "serviceWorker" in navigator
    && window.location.protocol !== "file:"
    && window.isSecureContext;
  if (!canRegister) return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

function renderCaptured() {
  const starting = { w: { p: 8, n: 2, b: 2, r: 2, q: 1 }, b: { p: 8, n: 2, b: 2, r: 2, q: 1 } };
  state.board.forEach((piece) => {
    if (piece && piece.type !== "k") starting[piece.color][piece.type] -= 1;
  });
  els.capturedWhite.textContent = capturedString(starting.w, "w");
  els.capturedBlack.textContent = capturedString(starting.b, "b");
}

function capturedString(missing, color) {
  return ["q", "r", "b", "n", "p"].map((type) => UNICODE[color][type].repeat(Math.max(0, missing[type]))).join("");
}

function renderHistory() {
  if (!state.moveLog.length) {
    els.moveHistory.innerHTML = `<li class="muted">No moves yet.</li>`;
    return;
  }
  els.moveHistory.innerHTML = state.moveLog.map((entry, index) => {
    const prefix = entry.color === "w" ? `${Math.floor(index / 2) + 1}.` : `${Math.floor(index / 2) + 1}...`;
    return `<li>${prefix} ${escapeHtml(entry.text)} <span class="muted">(${escapeHtml(entry.uci)})</span></li>`;
  }).join("");
}

function boardToFen() {
  const rows = [];
  for (let rank = 0; rank < 8; rank += 1) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = state.board[indexOf(rank, file)];
      if (!piece) {
        empty += 1;
      } else {
        if (empty) {
          row += String(empty);
          empty = 0;
        }
        const letter = piece.type === "n" ? "n" : piece.type;
        row += piece.color === "w" ? letter.toUpperCase() : letter;
      }
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  const castles = `${state.castling.wK ? "K" : ""}${state.castling.wQ ? "Q" : ""}${state.castling.bK ? "k" : ""}${state.castling.bQ ? "q" : ""}` || "-";
  return `${rows.join("/")} ${state.turn} ${castles} ${state.enPassant === null ? "-" : squareName(state.enPassant)} ${state.halfmove} ${state.fullmove}`;
}

function loadFenFromInput() {
  const result = parseFen(els.fenInput.value.trim());
  if (!result.ok) {
    setLesson(`<p><strong class="warning">FEN could not be loaded:</strong> ${escapeHtml(result.error)}</p>`);
    return;
  }
  pushHistory("FEN load");
  state.board = result.board;
  state.turn = result.turn;
  state.castling = result.castling;
  state.enPassant = result.enPassant;
  state.halfmove = result.halfmove;
  state.fullmove = result.fullmove;
  state.selected = null;
  state.legalTargets = [];
  state.lastMove = null;
  state.evalHistory = [];
  refresh("Loaded FEN. The AI rebuilt its understanding from the imported position.");
}

function parseFen(fen) {
  const parts = fen.split(/\s+/);
  if (parts.length < 4) return { ok: false, error: "Expected at least four FEN fields." };
  const rows = parts[0].split("/");
  if (rows.length !== 8) return { ok: false, error: "Board field must have eight ranks." };
  const board = Array(64).fill(null);
  for (let rank = 0; rank < 8; rank += 1) {
    let file = 0;
    for (const char of rows[rank]) {
      if (/\d/.test(char)) {
        file += Number(char);
      } else {
        const color = char === char.toUpperCase() ? "w" : "b";
        const type = char.toLowerCase() === "n" ? "n" : char.toLowerCase();
        if (!TYPES.includes(type)) return { ok: false, error: `Unknown piece: ${char}` };
        if (file > 7) return { ok: false, error: "A rank has too many squares." };
        board[indexOf(rank, file)] = { color, type };
        file += 1;
      }
    }
    if (file !== 8) return { ok: false, error: "Every rank must total eight squares." };
  }
  if (!["w", "b"].includes(parts[1])) return { ok: false, error: "Side to move must be w or b." };
  const castling = { wK: false, wQ: false, bK: false, bQ: false };
  if (parts[2] !== "-") {
    for (const char of parts[2]) {
      if (char === "K") castling.wK = true;
      else if (char === "Q") castling.wQ = true;
      else if (char === "k") castling.bK = true;
      else if (char === "q") castling.bQ = true;
      else return { ok: false, error: `Unknown castling flag: ${char}` };
    }
  }
  const enPassant = parts[3] === "-" ? null : squareIndex(parts[3]);
  if (enPassant === null && parts[3] !== "-") return { ok: false, error: "Invalid en passant square." };
  return {
    ok: true,
    board,
    turn: parts[1],
    castling,
    enPassant,
    halfmove: Number(parts[4] || 0),
    fullmove: Number(parts[5] || 1),
  };
}

function inventory() {
  const result = { w: [], b: [] };
  state.board.forEach((piece, idx) => {
    if (!piece) return;
    result[piece.color].push(`${UNICODE[piece.color][piece.type]} ${squareName(idx)}`);
  });
  result.w.sort((a, b) => a.localeCompare(b));
  result.b.sort((a, b) => a.localeCompare(b));
  return result;
}

function inventoryForAi() {
  const result = { w: [], b: [] };
  state.board.forEach((piece, idx) => {
    if (!piece) return;
    result[piece.color].push({
      order: pieceSortOrder(piece, idx),
      text: `${PIECE_NAMES[piece.type]} on ${squareName(idx)}`,
    });
  });
  return {
    w: result.w.sort((a, b) => a.order - b.order).map((item) => item.text),
    b: result.b.sort((a, b) => a.order - b.order).map((item) => item.text),
  };
}

function pieceSortOrder(piece, idx) {
  return TYPES.indexOf(piece.type) * 100 + idx;
}

function materialBalance() {
  let white = 0;
  let black = 0;
  state.board.forEach((piece) => {
    if (!piece) return;
    if (piece.color === "w") white += PIECE_VALUES[piece.type];
    else black += PIECE_VALUES[piece.type];
  });
  const diff = white - black;
  if (diff === 0) return "material even";
  return `${diff > 0 ? "White" : "Black"} +${Math.abs(diff / 100).toFixed(1)}`;
}

function previewAfter(move) {
  const next = clonePosition(state);
  applyMove(next, move, { silent: true });
  return next;
}

function clonePosition(position) {
  return {
    board: cloneBoard(position.board),
    turn: position.turn,
    castling: { ...position.castling },
    enPassant: position.enPassant,
    halfmove: position.halfmove,
    fullmove: position.fullmove,
    moveLog: position.moveLog ? position.moveLog.map((entry) => ({ ...entry })) : [],
  };
}

function cloneBoard(board) {
  return board.map((piece) => (piece ? { ...piece } : null));
}

function findKing(board, color) {
  const index = board.findIndex((piece) => piece?.color === color && piece.type === "k");
  return index === -1 ? null : index;
}

function sameMove(a, b) {
  return a && b && a.from === b.from && a.to === b.to && (a.promotion || null) === (b.promotion || null);
}

function describeMove(move) {
  if (move.castle === "K") return "castle kingside";
  if (move.castle === "Q") return "castle queenside";

  const piece = PIECE_NAMES[move.piece.type];
  const from = squareName(move.from);
  const to = squareName(move.to);
  const action = move.enPassant !== undefined
    ? `captures pawn en passant on ${to}`
    : move.captured
      ? `captures ${PIECE_NAMES[move.captured.type]} on ${to}`
      : `moves to ${to}`;
  const promotion = move.promotion ? ` and promotes to ${PIECE_NAMES[move.promotion]}` : "";
  return `${piece} from ${from} ${action}${promotion}`;
}

function moveToUci(move) {
  return `${squareName(move.from)}${squareName(move.to)}${move.promotion || ""}`;
}

function modeName(mode) {
  if (mode === "ai") return "AI auto-play";
  if (mode === "manual") return "manual only";
  return "human with coach";
}

function formatScore(delta) {
  const pawns = delta / 100;
  if (Math.abs(pawns) < 0.05) return "≈ even";
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

function evaluationDisplay(score, mate = null) {
  if (mate !== null) {
    return mate > 0 ? `White mate in ${Math.abs(mate)}` : `Black mate in ${Math.abs(mate)}`;
  }
  if (Math.abs(score) < 15) return "Even";
  const leader = score > 0 ? "White" : "Black";
  return `${leader} +${Math.abs(score / 100).toFixed(2)}`;
}

function suggestionScoreText(item) {
  if (!item.engine) return formatScore(item.delta);
  if (item.engineScoreType === "mate") {
    const mateText = Math.abs(item.engineScore);
    return item.engineScore > 0 ? `mate in ${mateText}` : `mated in ${mateText}`;
  }
  return formatScore(item.engineScore);
}

function formatPawns(centipawns) {
  const pawns = Math.abs(centipawns / 100);
  return `${pawns.toFixed(1)} pawn${pawns === 1 ? "" : "s"}`;
}

function colorName(color) {
  return color === "w" ? "White" : "Black";
}

function opposite(color) {
  return color === "w" ? "b" : "w";
}

function squareColor(rank, file) {
  return (rank + file) % 2 === 0 ? "light" : "dark";
}

function indexOf(rank, file) {
  return rank * 8 + file;
}

function coords(index) {
  return { rank: Math.floor(index / 8), file: index % 8 };
}

function inBounds(rank, file) {
  return rank >= 0 && rank < 8 && file >= 0 && file < 8;
}

function squareName(index) {
  const { rank, file } = coords(index);
  return `${FILES[file]}${8 - rank}`;
}

function squareIndex(square) {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const file = FILES.indexOf(square[0]);
  const rank = 8 - Number(square[1]);
  return indexOf(rank, file);
}

function midpoint(from, to) {
  const a = coords(from);
  const b = coords(to);
  return indexOf((a.rank + b.rank) / 2, a.file);
}

function isPromotionRank(color, index) {
  const rank = coords(index).rank;
  return color === "w" ? rank === 0 : rank === 7;
}

function isHomeBackRank(index, color) {
  return coords(index).rank === (color === "w" ? 7 : 0);
}

function isHomePawnRank(index, color) {
  return coords(index).rank === (color === "w" ? 6 : 1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
