/**
 * ChessMini - مكتبة شطرنج صغيرة ومستقلة
 * تدير الوضعيات وتطبق النقلات وتولّد FEN صحيح
 * تعمل بدون أي مكتبات خارجية
 * تُستخدم احتياطياً إذا لم يكن chess.js موجوداً
 */

class ChessMini {
  constructor() {
    this.reset();
  }

  reset() {
    this._board = new Array(64).fill(null);
    this._turn = 'w';
    this._castling = { K: true, Q: true, k: true, q: true };
    this._enPassant = -1;
    this._halfMoves = 0;
    this._fullMoves = 1;
    this._history = [];

    // قيمة القطع
    this.PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  }

  // تحويل الإحداثيات
  static fileRank(sq) { return [sq % 8, Math.floor(sq / 8)]; }
  static sq(file, rank) { return file + rank * 8; }
  static sqName(sq) {
    const [f, r] = ChessMini.fileRank(sq);
    return String.fromCharCode(97 + f) + (r + 1);
  }
  static nameToSq(name) {
    if (!name || name.length < 2) return -1;
    return (name.charCodeAt(0) - 97) + (parseInt(name[1]) - 1) * 8;
  }

  // تحميل من FEN
  load(fen) {
    this.reset();
    if (!fen) return false;
    const parts = fen.split(' ');

    // 1. الرقعة
    let rank = 7, file = 0;
    for (const ch of parts[0]) {
      if (ch === '/') { rank--; file = 0; continue; }
      if (ch >= '1' && ch <= '8') { file += parseInt(ch); continue; }
      this._board[file + rank * 8] = ch;
      file++;
    }

    // 2. الدور
    this._turn = parts[1] === 'b' ? 'b' : 'w';

    // 3. حقوق التبييت
    const cas = parts[2] || '-';
    this._castling = {
      K: cas.includes('K'), Q: cas.includes('Q'),
      k: cas.includes('k'), q: cas.includes('q')
    };

    // 4. En passant
    this._enPassant = (parts[3] && parts[3] !== '-') ? ChessMini.nameToSq(parts[3]) : -1;

    // 5. العدادات
    this._halfMoves = parseInt(parts[4] || '0');
    this._fullMoves = parseInt(parts[5] || '1');

    return true;
  }

  // توليد FEN
  fen() {
    let fenStr = '';

    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this._board[f + r * 8];
        if (!p) { empty++; continue; }
        if (empty) { fenStr += empty; empty = 0; }
        fenStr += p;
      }
      if (empty) fenStr += empty;
      if (r > 0) fenStr += '/';
    }

    const cas = [
      this._castling.K ? 'K' : '',
      this._castling.Q ? 'Q' : '',
      this._castling.k ? 'k' : '',
      this._castling.q ? 'q' : ''
    ].join('') || '-';

    const ep = this._enPassant >= 0 ? ChessMini.sqName(this._enPassant) : '-';
    return `${fenStr} ${this._turn} ${cas} ${ep} ${this._halfMoves} ${this._fullMoves}`;
  }

  // الحصول على قطعة في مربع
  get(sq) { return this._board[sq] || null; }

  // هل القطعة بيضاء؟
  isWhite(piece) { return piece === piece.toUpperCase(); }

  // تطبيق نقلة بصيغة SAN
  move(san) {
    if (!san) return null;

    // تنظيف السان من الرموز
    const cleanSan = san.replace(/[+#!?]/g, '');

    // التبييت
    if (cleanSan === 'O-O' || cleanSan === '0-0') {
      return this._applyCastling(this._turn === 'w', true);
    }
    if (cleanSan === 'O-O-O' || cleanSan === '0-0-0') {
      return this._applyCastling(this._turn === 'w', false);
    }

    // تحليل SAN
    const parsed = this._parseSAN(cleanSan);
    if (!parsed) return null;

    // إيجاد القطعة التي تستطيع اللعب
    const fromSq = this._findPiece(parsed);
    if (fromSq < 0) return null;

    const toSq = parsed.toSq;
    const piece = this._board[fromSq];
    const captured = this._board[toSq];

    // تطبيق النقلة
    const moveObj = {
      from: fromSq, to: toSq,
      piece, captured,
      promotion: parsed.promotion,
      san,
      fenBefore: this.fen()
    };

    this._board[toSq] = parsed.promotion ?
      (this._turn === 'w' ? parsed.promotion.toUpperCase() : parsed.promotion.toLowerCase()) :
      piece;
    this._board[fromSq] = null;

    // En Passant تطبيق
    if (piece.toLowerCase() === 'p' && toSq === this._enPassant) {
      const epCaptureSq = toSq + (this._turn === 'w' ? -8 : 8);
      moveObj.epCapture = epCaptureSq;
      this._board[epCaptureSq] = null;
    }

    // تحديث En Passant الجديد
    const [fromF, fromR] = ChessMini.fileRank(fromSq);
    const [toF, toR] = ChessMini.fileRank(toSq);

    if (piece.toLowerCase() === 'p' && Math.abs(toR - fromR) === 2) {
      this._enPassant = ChessMini.sq(fromF, (fromR + toR) / 2);
    } else {
      this._enPassant = -1;
    }

    // تحديث التبييت
    if (piece === 'K') { this._castling.K = false; this._castling.Q = false; }
    if (piece === 'k') { this._castling.k = false; this._castling.q = false; }
    if (fromSq === ChessMini.sq(7, 0)) this._castling.K = false;
    if (fromSq === ChessMini.sq(0, 0)) this._castling.Q = false;
    if (fromSq === ChessMini.sq(7, 7)) this._castling.k = false;
    if (fromSq === ChessMini.sq(0, 7)) this._castling.q = false;
    if (toSq === ChessMini.sq(7, 0)) this._castling.K = false;
    if (toSq === ChessMini.sq(0, 0)) this._castling.Q = false;
    if (toSq === ChessMini.sq(7, 7)) this._castling.k = false;
    if (toSq === ChessMini.sq(0, 7)) this._castling.q = false;

    // تحديث العدادات
    if (piece.toLowerCase() === 'p' || captured) {
      this._halfMoves = 0;
    } else {
      this._halfMoves++;
    }

    if (this._turn === 'b') this._fullMoves++;
    this._turn = this._turn === 'w' ? 'b' : 'w';

    this._history.push(moveObj);
    moveObj.fenAfter = this.fen();
    return moveObj;
  }

  // تطبيق التبييت
  _applyCastling(isWhite, kingSide) {
    const rank = isWhite ? 0 : 7;
    const kingFrom = ChessMini.sq(4, rank);
    const rookFrom = ChessMini.sq(kingSide ? 7 : 0, rank);
    const kingTo = ChessMini.sq(kingSide ? 6 : 2, rank);
    const rookTo = ChessMini.sq(kingSide ? 5 : 3, rank);

    const king = this._board[kingFrom];
    const rook = this._board[rookFrom];

    this._board[kingFrom] = null;
    this._board[rookFrom] = null;
    this._board[kingTo] = king;
    this._board[rookTo] = rook;

    if (isWhite) { this._castling.K = false; this._castling.Q = false; }
    else { this._castling.k = false; this._castling.q = false; }

    this._enPassant = -1;
    this._halfMoves++;
    if (this._turn === 'b') this._fullMoves++;
    this._turn = this._turn === 'w' ? 'b' : 'w';

    return { castling: kingSide ? 'K' : 'Q' };
  }

  // تحليل صيغة SAN
  _parseSAN(san) {
    let pieceType = 'p';
    let fromFile = -1, fromRank = -1;
    let toSq = -1;
    let promotion = null;
    let capture = false;

    let s = san;

    // ترقية
    if (s.includes('=')) {
      const parts = s.split('=');
      promotion = parts[1][0].toLowerCase();
      s = parts[0];
    }

    // نوع القطعة
    if (/^[NBRQK]/.test(s)) {
      pieceType = s[0].toLowerCase();
      s = s.slice(1);
    }

    // إزالة x للأسر
    if (s.includes('x')) { capture = true; s = s.replace('x', ''); }

    // الوجهة (آخر حرفين)
    if (s.length >= 2) {
      toSq = ChessMini.nameToSq(s.slice(-2));
      s = s.slice(0, -2);
    }

    if (toSq < 0) return null;

    // المصدر (إن وُجد)
    if (s.length >= 2) {
      fromFile = s.charCodeAt(0) - 97;
      fromRank = parseInt(s[1]) - 1;
    } else if (s.length === 1) {
      if (/[a-h]/.test(s)) fromFile = s.charCodeAt(0) - 97;
      else if (/[1-8]/.test(s)) fromRank = parseInt(s) - 1;
    }

    return { pieceType, fromFile, fromRank, toSq, promotion, capture };
  }

  // إيجاد القطعة التي تستطيع اللعب
  _findPiece(parsed) {
    const { pieceType, fromFile, fromRank, toSq } = parsed;
    const isW = this._turn === 'w';
    const searchPiece = isW ? pieceType.toUpperCase() : pieceType.toLowerCase();

    for (let sq = 0; sq < 64; sq++) {
      if (this._board[sq] !== searchPiece) continue;
      const [f, r] = ChessMini.fileRank(sq);
      if (fromFile >= 0 && f !== fromFile) continue;
      if (fromRank >= 0 && r !== fromRank) continue;
      if (this._canReach(sq, toSq, pieceType, isW)) return sq;
    }
    return -1;
  }

  // هل يمكن للقطعة الوصول من sq إلى toSq؟ (تحقق بسيط)
  _canReach(from, to, pieceType, isWhite) {
    const [ff, fr] = ChessMini.fileRank(from);
    const [tf, tr] = ChessMini.fileRank(to);
    const df = tf - ff, dr = tr - fr;
    const adf = Math.abs(df), adr = Math.abs(dr);

    switch (pieceType) {
      case 'p': {
        const dir = isWhite ? 1 : -1;
        // التقدم
        if (df === 0) {
          if (dr === dir && !this._board[to]) return true;
          if (dr === 2 * dir && fr === (isWhite ? 1 : 6) && !this._board[to] && !this._board[ChessMini.sq(ff, fr + dir)]) return true;
        }
        // الأسر
        if (adf === 1 && dr === dir) {
          if (this._board[to] && this.isWhite(this._board[to]) !== isWhite) return true;
          if (to === this._enPassant) return true;
        }
        return false;
      }
      case 'n':
        return (adf === 2 && adr === 1) || (adf === 1 && adr === 2);
      case 'b':
        if (adf !== adr) return false;
        return this._clearDiagonal(from, to);
      case 'r':
        if (df !== 0 && dr !== 0) return false;
        return this._clearLine(from, to);
      case 'q':
        if (adf === adr) return this._clearDiagonal(from, to);
        if (df === 0 || dr === 0) return this._clearLine(from, to);
        return false;
      case 'k':
        return adf <= 1 && adr <= 1;
      default:
        return false;
    }
  }

  // مسار قطري خالٍ؟
  _clearDiagonal(from, to) {
    const [ff, fr] = ChessMini.fileRank(from);
    const [tf, tr] = ChessMini.fileRank(to);
    const sf = Math.sign(tf - ff), sr = Math.sign(tr - fr);
    let f = ff + sf, r = fr + sr;
    while (f !== tf || r !== tr) {
      if (this._board[ChessMini.sq(f, r)]) return false;
      f += sf; r += sr;
    }
    return true;
  }

  // مسار أفقي/رأسي خالٍ؟
  _clearLine(from, to) {
    const [ff, fr] = ChessMini.fileRank(from);
    const [tf, tr] = ChessMini.fileRank(to);
    const sf = Math.sign(tf - ff), sr = Math.sign(tr - fr);
    let f = ff + sf, r = fr + sr;
    while (f !== tf || r !== tr) {
      if (this._board[ChessMini.sq(f, r)]) return false;
      f += sf; r += sr;
    }
    return true;
  }

  // تاريخ النقلات
  history() { return [...this._history]; }
}

// تصدير
if (typeof window !== 'undefined') window.ChessMini = ChessMini;
if (typeof module !== 'undefined') module.exports = ChessMini;
