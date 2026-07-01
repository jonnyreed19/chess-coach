"use strict";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const TYPES = ["k", "q", "r", "b", "n", "p"];
const WHITE_BACK_RANK = ["r", "n", "b", "q", "k", "b", "n", "r"];
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const PIECE_NAMES = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const UNICODE = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};
const STOCKFISH_SCRIPT = "vendor/stockfish/stockfish-nnue-16-single.js";
const STOCKFISH_WASM = "vendor/stockfish/stockfish-nnue-16-single.wasm";
const STOCKFISH_MOVETIME_MS = 600;
const STOCKFISH_LINES = 3;
const STOCKFISH_STARTUP_TIMEOUT_MS = 12000;
const STOCKFISH_MAX_STARTUP_ATTEMPTS = 3;
const STOCKFISH_RETRY_DELAY_MS = 700;

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
  initStockfish();
  syncControls();
  refresh("Welcome. Choose a side, ask for a coach move, or make the first move on the board.");
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
    "fenText",
    "copyFen",
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
  els.fullReset.addEventListener("click", fullReset);
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
  els.copyFen.addEventListener("click", async () => {
    const fen = boardToFen();
    try {
      await navigator.clipboard.writeText(fen);
      setLesson(`<p><strong>FEN copied.</strong> The current board model is ready to paste elsewhere.</p>`);
    } catch {
      setLesson(`<p><strong>Current FEN:</strong> <code>${escapeHtml(fen)}</code></p>`);
    }
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
  if (message) renderLesson(message);
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
  renderSuggestions();
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
  els.fenText.textContent = fen;
  els.fenInput.value = fen;
  const pieces = inventory();
  els.pieceInventory.innerHTML = ["w", "b"].map((color) => {
    const text = pieces[color].length ? pieces[color].join(", ") : "No pieces";
    return `<div class="inventory-row"><strong>${colorName(color)}</strong><span>${escapeHtml(text)}</span></div>`;
  }).join("");
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    els.shareUrl.focus();
    els.shareUrl.select();
    return false;
  }
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
