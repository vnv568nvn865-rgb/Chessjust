/**
 * ChessCoach - مدرب الشطرنج
 * يحول نتائج Stockfish إلى شرح تعليمي مفهوم
 * يعتمد الشرح على الوضعية الفعلية وليس تفسيرات مخترعة
 */

class ChessCoach {
  constructor() {
    // قيم القطع بالسنتيبون
    this.PIECE_VALUES = { p: 100, n: 325, b: 340, r: 500, q: 900, k: 0 };

    // أسماء القطع بالعربية
    this.PIECE_NAMES_AR = {
      p: 'بيدق', n: 'حصان', b: 'فيل', r: 'قلعة', q: 'وزير', k: 'ملك',
      P: 'بيدق', N: 'حصان', B: 'فيل', R: 'قلعة', Q: 'وزير', K: 'ملك'
    };

    // Unicode للقطع
    this.UNICODE_PIECES = {
      K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
      k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'
    };

    // أنماط الأخطاء الشائعة وأوزانها
    this.ERROR_PATTERNS = {
      HANGING_PIECE: { nameAr: 'تعليق قطعة', weight: 3 },
      MISSED_TACTIC: { nameAr: 'إضاعة تكتيك', weight: 2 },
      KING_SAFETY: { nameAr: 'ضعف أمان الملك', weight: 3 },
      PAWN_STRUCTURE: { nameAr: 'ضعف بنية البيادق', weight: 1 },
      MISSED_CHECKMATE: { nameAr: 'إضاعة كش ملك', weight: 5 },
      POOR_DEVELOPMENT: { nameAr: 'ضعف التطوير', weight: 2 },
      MISSED_MATERIAL: { nameAr: 'إضاعة مادة', weight: 2 },
      LOSING_INITIATIVE: { nameAr: 'فقدان المبادرة', weight: 1 }
    };
  }

  // تحليل وضعية من FEN وإرجاع المعلومات الأساسية
  parsePosition(fen) {
    if (!fen) return null;
    const parts = fen.split(' ');
    const board = parts[0];
    const turn = parts[1] || 'w';
    const castling = parts[2] || '-';
    const enpassant = parts[3] || '-';
    const halfMoves = parseInt(parts[4] || '0');
    const fullMoves = parseInt(parts[5] || '1');

    const pieces = {};
    let row = 7, col = 0;

    for (const ch of board) {
      if (ch === '/') { row--; col = 0; continue; }
      if (ch >= '1' && ch <= '8') { col += parseInt(ch); continue; }
      const sq = col + row * 8;
      pieces[sq] = ch;
      col++;
    }

    return { pieces, turn, castling, enpassant, halfMoves, fullMoves, fen };
  }

  // حساب المادة من وضعية
  countMaterial(position) {
    const white = { p: 0, n: 0, b: 0, r: 0, q: 0 };
    const black = { p: 0, n: 0, b: 0, r: 0, q: 0 };

    for (const piece of Object.values(position.pieces)) {
      const lower = piece.toLowerCase();
      if (lower === 'k') continue;
      if (piece === piece.toUpperCase()) {
        white[lower] = (white[lower] || 0) + 1;
      } else {
        black[lower] = (black[lower] || 0) + 1;
      }
    }

    const whiteTotal = Object.entries(white).reduce((sum, [p, c]) => sum + this.PIECE_VALUES[p] * c, 0);
    const blackTotal = Object.entries(black).reduce((sum, [p, c]) => sum + this.PIECE_VALUES[p] * c, 0);

    return { white, black, whiteTotal, blackTotal, diff: whiteTotal - blackTotal };
  }

  // إيجاد الملك في الوضعية
  findKing(position, isWhite) {
    const kingPiece = isWhite ? 'K' : 'k';
    for (const [sq, piece] of Object.entries(position.pieces)) {
      if (piece === kingPiece) return parseInt(sq);
    }
    return -1;
  }

  // تقدير أمان الملك (بدائي لكن كافٍ للشرح)
  evaluateKingSafety(position, isWhite) {
    const kingSq = this.findKing(position, isWhite);
    if (kingSq < 0) return { score: 0, issues: [] };

    const kingCol = kingSq % 8;
    const kingRow = Math.floor(kingSq / 8);
    const issues = [];
    let score = 0;

    // هل الملك في المنتصف في مرحلة اللعبة الوسطى؟
    if (kingCol >= 2 && kingCol <= 5) {
      const totalPieces = Object.keys(position.pieces).length;
      if (totalPieces > 20) { // مرحلة اللعبة الوسطى
        issues.push('الملك في المنتصف');
        score -= 30;
      }
    }

    // هل البيادق أمام الملك موجودة؟
    const pawnChar = isWhite ? 'P' : 'p';
    const pawnDirection = isWhite ? 1 : -1;
    let pawnsInFront = 0;
    for (let dc = -1; dc <= 1; dc++) {
      const c = kingCol + dc;
      if (c < 0 || c > 7) continue;
      const r = kingRow + pawnDirection;
      if (r < 0 || r > 7) continue;
      const sq = c + r * 8;
      if (position.pieces[sq] === pawnChar) pawnsInFront++;
    }

    if (pawnsInFront === 0) {
      issues.push('لا بيادق أمام الملك');
      score -= 40;
    } else if (pawnsInFront === 1) {
      issues.push('بيدق واحد فقط يحمي الملك');
      score -= 15;
    }

    return { score, issues, kingSq, kingRow, kingCol, pawnsInFront };
  }

  // شرح سبب النقلة بناءً على التحليل الفعلي
  explainMoveDifference(posBefore, posAfter, playerMove, bestMove, cpLoss, engineAnalysis) {
    const reasons = [];
    const tactical = [];

    if (!posBefore || !posAfter) return { reasons: ['تحليل غير متاح'], tactical: [] };

    const matBefore = this.countMaterial(posBefore);
    const matAfter = this.countMaterial(posAfter);
    const isWhite = posBefore.turn === 'w';

    // 1. تحقق من خسارة مادية
    const playerMatBefore = isWhite ? matBefore.whiteTotal : matBefore.blackTotal;
    const playerMatAfter = isWhite ? matAfter.whiteTotal : matAfter.blackTotal;
    const oppMatBefore = isWhite ? matBefore.blackTotal : matBefore.whiteTotal;
    const oppMatAfter = isWhite ? matAfter.blackTotal : matAfter.whiteTotal;

    const playerLost = playerMatBefore - playerMatAfter;
    const oppLost = oppMatBefore - oppMatAfter;
    const materialDiff = playerLost - oppLost;

    if (materialDiff > 200) {
      reasons.push(`خسارة مادية: فقدت ما يعادل ${(materialDiff / 100).toFixed(1)} بيادق من قيمة القطع`);
      tactical.push('HANGING_PIECE');
    } else if (materialDiff > 50) {
      reasons.push(`خسارة مادية بسيطة (${(materialDiff / 100).toFixed(1)} بيادق)`);
    }

    // 2. تحقق من أمان الملك
    const safeBefore = this.evaluateKingSafety(posBefore, isWhite);
    const safeAfter = this.evaluateKingSafety(posAfter, isWhite);

    if (safeAfter.score < safeBefore.score - 20) {
      if (safeAfter.issues.length > 0) {
        reasons.push('ضعف أمان الملك: ' + safeAfter.issues.join(', '));
        tactical.push('KING_SAFETY');
      }
    }

    // 3. تحقق من وجود تهديد جديد للخصم
    const oppSafeBefore = this.evaluateKingSafety(posBefore, !isWhite);
    const oppSafeAfter = this.evaluateKingSafety(posAfter, !isWhite);
    if (oppSafeAfter.score > oppSafeBefore.score + 20) {
      reasons.push('النقلة تخلق ضغطاً على ملك الخصم');
    }

    // 4. شرح من خلال نتيجة Stockfish
    if (engineAnalysis && engineAnalysis.lines && engineAnalysis.lines.length > 0) {
      const bestLine = engineAnalysis.lines[0];
      if (bestLine.pv && bestLine.pv.length > 0) {
        const bestMoveUci = bestLine.pv[0];
        if (bestMoveUci !== playerMove && cpLoss > 30) {
          reasons.push(`أفضل نقلة كانت: ${this.formatMove(bestMoveUci)} — تحافظ على ${AnalysisEngine.scoreToText(bestLine.score)} تقييم`);
        }

        // محاولة فهم المتسلسلة الأفضل
        if (bestLine.pv.length >= 2) {
          const followUp = bestLine.pv[1];
          if (cpLoss > 100) {
            reasons.push(`بعد ${this.formatMove(bestMoveUci)} كان سيأتي ${this.formatMove(followUp)} مع استمرار ضغط قوي`);
          }
        }
      }

      // فحص إذا كان هناك كش ملك في الخط المقترح
      if (bestLine.score && bestLine.score.type === 'mate') {
        const mateIn = Math.abs(bestLine.score.value);
        if (isWhite === (bestLine.score.value > 0)) {
          reasons.push(`❗ أضعت فرصة للفوز بالكش ملك في ${mateIn} نقلة!`);
          tactical.push('MISSED_CHECKMATE');
        }
      }
    }

    // 5. إذا لم يكن هناك سبب واضح لكن الفقدان كبير
    if (reasons.length === 0 && cpLoss > 50) {
      if (cpLoss > 150) {
        reasons.push('النقلة تعطي الخصم ميزة حاسمة في الوضعية');
      } else {
        reasons.push('النقلة تضعف وضعيتك الاستراتيجية');
        tactical.push('LOSING_INITIATIVE');
      }
    }

    // 6. لماذا كانت نقلة اللاعب سيئة - توضيح إضافي
    const whyBad = this._generateWhyBadExplanation(cpLoss, tactical, matAfter, safeAfter, isWhite);

    return { reasons, tactical: [...new Set(tactical)], whyBad };
  }

  // توليد شرح "لماذا كانت النقلة سيئة"
  _generateWhyBadExplanation(cpLoss, tacticalErrors, matAfter, safeAfter, isWhite) {
    if (cpLoss < 15) return null; // النقلة جيدة

    const points = [];

    if (tacticalErrors.includes('HANGING_PIECE')) {
      points.push('علّقت قطعة دون تغطية كافية');
    }
    if (tacticalErrors.includes('MISSED_CHECKMATE')) {
      points.push('أضعت فرصة للفوز الفوري بالكش ملك');
    }
    if (tacticalErrors.includes('KING_SAFETY')) {
      points.push('النقلة فتحت خطوطاً على ملكك أو أزالت حمايته');
    }
    if (tacticalErrors.includes('LOSING_INITIATIVE')) {
      points.push('النقلة تعطي الخصم دور المبادرة');
    }

    if (points.length === 0) {
      if (cpLoss > 150) points.push('النقلة تغير ميزان اللعبة بشكل كبير لصالح الخصم');
      else if (cpLoss > 70) points.push('النقلة تعطي الخصم ميزة ملموسة');
      else points.push('النقلة ليست مثالية لهذه الوضعية');
    }

    return points;
  }

  // تنسيق رمز النقلة (UCI إلى قراءة أسهل)
  formatMove(uci) {
    if (!uci || uci.length < 4) return uci;
    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);
    const promo = uci.length > 4 ? '=' + uci[4].toUpperCase() : '';
    return `${from}→${to}${promo}`;
  }

  // توليد ملخص المباراة
  generateGameSummary(movesAnalysis, playerColor) {
    if (!movesAnalysis || movesAnalysis.length === 0) {
      return { accuracy: 0, summary: 'لا يوجد تحليل متاح', keyMoments: [], strengths: [], weaknesses: [] };
    }

    const playerMoves = movesAnalysis.filter(m => m.isPlayerMove);
    const totalCpLoss = playerMoves.reduce((sum, m) => sum + (m.cpLoss || 0), 0);
    const avgCpLoss = playerMoves.length > 0 ? totalCpLoss / playerMoves.length : 0;

    // حساب الدقة من CP loss فقط. نستخدم نفس منحنى النقلة، دون نظام الاحتمالات القديم.
    const moveAccs = playerMoves
      .map(m => typeof m.cpLoss === 'number' ? AnalysisEngine.moveAccuracy(m.cpLoss, 0, -m.cpLoss) : null)
      .filter(v => typeof v === 'number');
    const accuracy = moveAccs.length
      ? Math.round(moveAccs.reduce((a,b)=>a+b,0) / moveAccs.length)
      : 0;

    // تحديد أهم اللحظات (النقلات التي غيرت التقييم بشكل كبير)
    const keyMoments = movesAnalysis
      .filter(m => m.cpLoss > 50)
      .sort((a, b) => b.cpLoss - a.cpLoss)
      .slice(0, 5)
      .map(m => ({
        moveNumber: m.moveNumber,
        move: m.move,
        cpLoss: m.cpLoss,
        classification: AnalysisEngine.classifyMove(m.cpLoss),
        explanation: m.explanation
      }));

    // إحصاء أنواع الأخطاء
    const counts = { brilliant: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    playerMoves.forEach(m => {
      const cls = AnalysisEngine.classifyMove(m.cpLoss || 0);
      counts[cls.type]++;
    });

    // نقاط القوة والضعف
    const strengths = [], weaknesses = [];

    if (counts.blunder === 0) strengths.push('لم تقع في أخطاء فادحة');
    if (counts.brilliant > 0 || counts.excellent > 1) strengths.push(`نفذت ${counts.brilliant + counts.excellent} نقلة ممتازة`);
    if (accuracy >= 85) strengths.push('دقة عالية في اللعب بشكل عام');

    if (counts.blunder > 0) weaknesses.push(`وقعت في ${counts.blunder} خطأ فادح`);
    if (counts.mistake > 1) weaknesses.push(`${counts.mistake} أخطاء في التنفيذ`);
    if (counts.inaccuracy > 3) weaknesses.push('الكثير من النقلات غير الدقيقة');
    if (accuracy < 70) weaknesses.push('الدقة العامة تحتاج إلى تحسين');

    return {
      accuracy,
      avgCpLoss: Math.round(avgCpLoss),
      totalMoves: playerMoves.length,
      counts,
      keyMoments,
      strengths,
      weaknesses,
      summary: this._generateTextSummary(accuracy, counts, keyMoments)
    };
  }

  _generateTextSummary(accuracy, counts, keyMoments) {
    let text = `دقة اللعب: ${accuracy}%\n`;
    if (accuracy >= 90) text += 'لعبة ممتازة جداً!';
    else if (accuracy >= 80) text += 'لعبة جيدة مع بعض الأخطاء البسيطة';
    else if (accuracy >= 70) text += 'أداء متوسط - هناك مجال للتحسين';
    else if (accuracy >= 60) text += 'لعبة تحتاج إلى مراجعة في النقاط الأساسية';
    else text += 'كثير من الأخطاء - راجع النقلات الرئيسية للتعلم';

    if (counts.blunder > 0) text += `\nتجنب الأخطاء الفادحة: وقعت في ${counts.blunder}`;

    return text;
  }

  // تحديد أنماط الأخطاء من عدة مباريات
  detectErrorPatterns(gamesData) {
    const patternCounts = {};
    const patternMoves = {};

    for (const game of gamesData) {
      if (!game.movesAnalysis) continue;
      for (const move of game.movesAnalysis) {
        if (!move.isPlayerMove || !move.tactical) continue;
        for (const pattern of move.tactical) {
          patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
          if (!patternMoves[pattern]) patternMoves[pattern] = [];
          patternMoves[pattern].push({ game: game.gameId, moveNumber: move.moveNumber, move: move.move });
        }
      }
    }

    return Object.entries(patternCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([pattern, count]) => ({
        pattern,
        nameAr: this.ERROR_PATTERNS[pattern]?.nameAr || pattern,
        count,
        percentage: Math.round(count / gamesData.length * 100),
        examples: patternMoves[pattern]?.slice(0, 3) || [],
        trainingTip: this._getTrainingTip(pattern)
      }));
  }

  // نصيحة تدريبية لكل نوع خطأ
  _getTrainingTip(pattern) {
    const tips = {
      HANGING_PIECE: 'قبل كل نقلة، تحقق: هل قطعتي مهددة؟ هل قطعة الخصم بدون حماية؟',
      MISSED_TACTIC: 'دَرّب على الألغاز التكتيكية يومياً لتحسين رؤية التهديدات',
      KING_SAFETY: 'اقرص قلعك في وقت مبكر وحافظ على البيادق أمام الملك',
      PAWN_STRUCTURE: 'تجنب البيادق المضاعفة والمعزولة قدر الإمكان',
      MISSED_CHECKMATE: 'دَرّب على ألغاز الكش ملك لتحسين رؤية النهايات التكتيكية',
      POOR_DEVELOPMENT: 'في الافتتاح: طور قطعك بسرعة قبل الهجوم',
      MISSED_MATERIAL: 'خذ وقتك لحساب التبادلات وتأكد من أنها في صالحك',
      LOSING_INITIATIVE: 'العب نقلات نشطة تهدد الخصم بدلاً من الدفاع السلبي'
    };
    return tips[pattern] || 'راجع هذا النوع من الأخطاء مع أمثلة من مبارياتك';
  }
}

if (typeof window !== 'undefined') window.ChessCoach = ChessCoach;
if (typeof module !== 'undefined') module.exports = ChessCoach;
             
