// 走棋流程完整测试
const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

function createEmptyBoard() {
  return Array.from({ length: 9 }, () => Array(10).fill('.'));
}

function boardFromFen(fen) {
  const parts = fen.split(' ');
  const board = createEmptyBoard();
  const rows = parts[0].split('/');
  rows.forEach((rowStr, rowIdx) => {
    let col = 0;
    for (const ch of rowStr) {
      if (ch >= '0' && ch <= '9') col += parseInt(ch);
      else { board[col][9 - rowIdx] = ch; col++; }
    }
  });
  return { board, turn: parts[1] || 'w' };
}

function isRed(p) {
  return p !== '.' && p === p.toUpperCase() && 'KABNRCP'.includes(p.toUpperCase());
}

function inBounds(c, r) { return c >= 0 && c < 9 && r >= 0 && r < 10; }

function getLegalMoves(state, col, row) {
  const piece = state.board[col][row];
  if (piece === '.') return [];
  const red = isRed(piece);
  const type = piece.toLowerCase();
  const moves = [];

  const tryM = (tc, tr) => {
    if (!inBounds(tc, tr)) return false;
    const t = state.board[tc][tr];
    if (t === '.') { moves.push({ col: tc, row: tr }); return true; }
    if ((red && !isRed(t)) || (!red && isRed(t))) moves.push({ col: tc, row: tr });
    return false;
  };

  const inP = (c, r) => {
    if (c < 3 || c > 5) return false;
    return red ? (r >= 0 && r <= 2) : (r >= 7 && r <= 9);
  };

  switch (type) {
    case 'k': [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dc,dr]) => { const tc=col+dc,tr=row+dr; if(inP(tc,tr)) tryM(tc,tr); }); break;
    case 'a': [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dc,dr]) => { const tc=col+dc,tr=row+dr; if(inP(tc,tr)) tryM(tc,tr); }); break;
    case 'p': {
      const fw = red ? 1 : -1;
      const fr = row + fw;
      if (inBounds(col, fr)) {
        tryM(col, fr);
        if ((red && row >= 5) || (!red && row <= 4)) {
          tryM(col - 1, fr);
          tryM(col + 1, fr);
        }
      }
      break;
    }
    case 'r': [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dc,dr]) => {
      let tc=col+dc, tr=row+dr;
      while (inBounds(tc, tr)) { if (!tryM(tc, tr)) break; tc+=dc; tr+=dr; }
    }); break;
    case 'c': [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dc,dr]) => {
      let tc=col+dc, tr=row+dr;
      while (inBounds(tc, tr) && state.board[tc][tr] === '.') {
        moves.push({ col: tc, row: tr });
        tc += dc; tr += dr;
      }
      if (inBounds(tc, tr)) {
        tc += dc; tr += dr;
        while (inBounds(tc, tr)) {
          if (state.board[tc][tr] !== '.') {
            if ((red && !isRed(state.board[tc][tr])) || (!red && isRed(state.board[tc][tr]))) {
              moves.push({ col: tc, row: tr });
            }
            break;
          }
          tc += dc; tr += dr;
        }
      }
    }); break;
    case 'n': [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]].forEach(([dc,dr]) => {
      const tc=col+dc, tr=row+dr;
      if (!inBounds(tc, tr)) return;
      const lc = col + (Math.abs(dc)===2 ? dc/2 : 0);
      const lr = row + (Math.abs(dr)===2 ? dr/2 : 0);
      if (inBounds(lc, lr) && state.board[lc][lr] !== '.') return;
      tryM(tc, tr);
    }); break;
    case 'b': [[2,2],[2,-2],[-2,2],[-2,-2]].forEach(([dc,dr]) => {
      const tc=col+dc, tr=row+dr;
      if (!inBounds(tc, tr)) return;
      if (inBounds(col+dc/2, row+dr/2) && state.board[col+dc/2][row+dr/2] !== '.') return;
      if ((red && tr > 4) || (!red && tr < 5)) return;
      tryM(tc, tr);
    }); break;
  }
  return moves;
}

// 测试
const state = boardFromFen(START_FEN);

console.log('=== 初始棋盘 ===');
console.log('turn:', state.turn);
console.log('红兵 (0,3):', state.board[0][3]);
console.log('红炮 (1,2):', state.board[1][2]);

// 测试1: 选择红兵
console.log('\n=== 测试1: 选择红兵 (0,3) ===');
const targets1 = getLegalMoves(state, 0, 3);
console.log('合法走法:', targets1.length, '步');
console.log('走法:', JSON.stringify(targets1));

// 测试2: 选择红炮
console.log('\n=== 测试2: 选择红炮 (1,2) ===');
const targets2 = getLegalMoves(state, 1, 2);
console.log('合法走法:', targets2.length, '步');
console.log('前5步:', JSON.stringify(targets2.slice(0, 5)));

// 测试3: 走兵
console.log('\n=== 测试3: 走兵七进一 ===');
const move1 = { from: { col: 6, row: 3 }, to: { col: 6, row: 4 } };
const t1 = getLegalMoves(state, move1.from.col, move1.from.row);
console.log('(6,3) 合法走法:', t1.length);
const isLegal1 = t1.some(m => m.col === move1.to.col && m.row === move1.to.row);
console.log('(6,4) 合法?', isLegal1);

if (isLegal1) {
  const nb = state.board.map(r => [...r]);
  nb[move1.to.col][move1.to.row] = nb[move1.from.col][move1.from.row];
  nb[move1.from.col][move1.from_row] = '.';
  console.log('走棋成功! (6,3)=.', nb[6][3], '(6,4)=', nb[6][4]);
}

// 测试4: 走炮
console.log('\n=== 测试4: 走炮二平五 ===');
const move2 = { from: { col: 7, row: 2 }, to: { col: 4, row: 2 } };
const t2 = getLegalMoves(state, move2.from.col, move2.from.row);
console.log('(7,2) 合法走法:', t2.length);
const isLegal2 = t2.some(m => m.col === move2.to.col && m.row === move2.to.row);
console.log('(4,2) 合法?', isLegal2);
