// ═══════════════════════════════════════════════════════════════
// VANGUARD 1-HOUR BOT — Runs 24/7 on Render
// Uses Binance 1h candles + Polymarket hourly markets
// ═══════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import { createServer } from 'http';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrvbmzjsivxlcodsdvrb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpydmJtempzaXZ4bGNvZHNkdnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTkxNTYsImV4cCI6MjA4ODEzNTE1Nn0.gBu0RL9tHBCjYmkiupziTPAsVX3s8TovUdMhjWPjiLw';
const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
};
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL_1H || process.env.DISCORD_WEBHOOK_URL || null;

// ── 1-hour specific config ──
const WINDOW_SECS  = 3600;  // 1 hour
const INTERVAL     = '1h';  // Binance candle interval
const SOURCE       = 'vanguard-bot-1h';
const SLUG_PREFIX  = 'btc-updown-1h-';
const LIVE_PRED_ID = 3;     // id=3 in live_prediction table
const BOT_TAG      = '[BOT-1H]';

// ── State ──
const state = {
  btcPrice: null,
  priceToBeat: null,
  ptbSource: null,
  currentWindowStart: 0,
  upPct: null,
  downPct: null,
  wins: 0,
  losses: 0,
  skips: 0,
  predictionMade: false,
  predictionDirection: null,
  predictionPTB: null,
  analysisDone: false,
  analysisPrice: null,
  analysisOddsUp: null,
  analysisOddsDown: null,
};

// ── Keep-alive HTTP server ──
const PORT = process.env.PORT_1H || process.env.PORT || 3002;
createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    bot: '1h', status: 'running',
    uptime: Math.floor(process.uptime()),
    wins: state.wins, losses: state.losses, skips: state.skips,
    btcPrice: state.btcPrice, priceToBeat: state.priceToBeat,
    prediction: state.predictionDirection,
  }));
}).listen(PORT, () => console.log(BOT_TAG + ' Health server on port ' + PORT));

let chainlinkSnapshotPrice = null;
let chainlinkSnapshotWindow = 0;
let priceBuffer = [];

// ═══════════════════════════════════════════
// TA INDICATORS
// ═══════════════════════════════════════════

function ema(data, period) {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i-1] * (1-k));
  return result;
}

function rsi(closes, period = 14) {
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  let avgGain = gains.slice(0, period).reduce((a,b) => a+b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a,b) => a+b, 0) / period;
  const result = new Array(period).fill(null);
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period-1) + gains[i]) / period;
    avgLoss = (avgLoss * (period-1) + losses[i]) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function macd(closes) {
  const emaFast = ema(closes, 12), emaSlow = ema(closes, 26);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(macdLine, 9);
  return { histogram: macdLine.map((v, i) => v - signalLine[i]) };
}

function vwap(highs, lows, closes, volumes) {
  let cumVol = 0, cumTP = 0;
  return closes.map((c, i) => {
    const tp = (highs[i] + lows[i] + c) / 3;
    cumVol += volumes[i]; cumTP += tp * volumes[i];
    return cumVol > 0 ? cumTP / cumVol : c;
  });
}

function computeTA(candles) {
  if (!candles || candles.length < 30) return null;
  const closes = candles.map(c => c.close);
  const highs   = candles.map(c => c.high);
  const lows    = candles.map(c => c.low);
  const vols    = candles.map(c => c.volume);
  const last    = candles.length - 1;

  const ema9  = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const vwapData = vwap(highs, lows, closes, vols);

  const aligned = ema9[last] > ema21[last] && ema21[last] > ema50[last] ? 'BULLISH' :
                  ema9[last] < ema21[last] && ema21[last] < ema50[last] ? 'BEARISH' : 'MIXED';

  const rsiDelta      = rsi14[last] != null && rsi14[last-1] != null ? rsi14[last] - rsi14[last-1] : 0;
  const macdHistDelta = macdData.histogram[last] - macdData.histogram[last-1];
  const ret1 = ((closes[last] - closes[last-1]) / closes[last-1]) * 100;
  const ret3 = last >= 3 ? ((closes[last] - closes[last-3]) / closes[last-3]) * 100 : 0;
  const ema9Slope = last >= 3 ? ((ema9[last] - ema9[last-3]) / ema9[last-3]) * 100 : 0;

  return {
    rsi: rsi14[last], rsiDelta,
    macdHist: macdData.histogram[last], macdHistDelta,
    macdCrossing: Math.sign(macdData.histogram[last]) !== Math.sign(macdData.histogram[last-1]),
    emaAligned: aligned, ema9Slope,
    vwapDist: ((closes[last] - vwapData[last]) / vwapData[last]) * 100,
    ret1, ret3,
  };
}

// ═══════════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════════

async function fetchCandles(interval = INTERVAL, limit = 100) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
    if (!res.ok) return null;
    const raw = await res.json();
    return raw.map(c => ({
      time: c[0], open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]),
    }));
  } catch(e) { console.error(BOT_TAG, 'Binance error:', e.message); return null; }
}

async function fetchPolymarket() {
  try {
    const now          = Math.floor(Date.now() / 1000);
    const currentStart = Math.floor(now / WINDOW_SECS) * WINDOW_SECS;
    const timestamps   = [currentStart, currentStart + WINDOW_SECS, currentStart - WINDOW_SECS];

    let bestMarket = null, bestTs = 0;
    for (const ts of timestamps) {
      const url = 'https://gamma-api.polymarket.com/markets?slug=' + SLUG_PREFIX + ts;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (!data || data.length === 0) continue;
      const market = data[0];
      if (market.closed && !market.acceptingOrders) continue;
      if (!bestMarket || ts === currentStart) {
        bestMarket = market; bestTs = ts;
        if (ts === currentStart) break;
      }
    }
    if (!bestMarket) {
      console.log(BOT_TAG, 'Polymarket: no active market found for slugs tried');
      return null;
    }

    const gammaOdds = JSON.parse(bestMarket.outcomePrices || '[]');
    const upPct   = (parseFloat(gammaOdds[0] || 0) * 100).toFixed(1);
    const downPct = (parseFloat(gammaOdds[1] || 0) * 100).toFixed(1);

    let startingPrice = null, ptbSrc = null;
    if (bestTs === currentStart && bestMarket.startPrice) {
      startingPrice = parseFloat(bestMarket.startPrice);
      if (startingPrice > 0) ptbSrc = 'polymarket';
      else { console.log(BOT_TAG, 'Polymarket: startPrice is 0/invalid'); startingPrice = null; }
    } else {
      console.log(BOT_TAG, 'Polymarket: no startPrice on market (market may not have opened yet)');
    }

    return { startingPrice, ptbSource: ptbSrc, upPct, downPct,
      timeLeft: Math.max(0, (bestTs + WINDOW_SECS) - now), startTimestamp: bestTs };
  } catch(e) { console.error(BOT_TAG, 'Polymarket error:', e.message); return null; }
}

// For 1h, PTB = Binance 1h candle open at window start
async function fetchPTBFallback() {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / WINDOW_SECS) * WINDOW_SECS;
  if (chainlinkSnapshotPrice && chainlinkSnapshotWindow === windowStart) return chainlinkSnapshotPrice;
  try {
    const startMs = windowStart * 1000;
    // Use the 1h candle open that started this window
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=${startMs}&limit=1`);
    if (res.ok) { const d = await res.json(); if (d && d.length > 0) return parseFloat(d[0][1]); }
  } catch(e) {}
  return null;
}

// ═══════════════════════════════════════════
// SUPABASE
// ═══════════════════════════════════════════

async function publishLivePrediction({ direction, ptb, btcPrice, confidence, confPct, bullScore, bearScore, signalsText }) {
  const row = {
    id: LIVE_PRED_ID, direction: direction || 'pending',
    ptb: ptb || null, btc_price: btcPrice || null,
    confidence: confidence || null, conf_pct: confPct || null,
    bull_score: bullScore || 0, bear_score: bearScore || 0,
    signals: signalsText || '', updated_at: new Date().toISOString(),
  };
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/live_prediction', {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.error(BOT_TAG, 'Live pred error:', res.status, await res.text());
    else console.log(BOT_TAG, 'Live prediction published:', direction);
  } catch(e) { console.error(BOT_TAG, 'Live pred exception:', e.message); }
}

async function savePrediction(windowStart, ptb, endPrice, predictedOver) {
  const actualOver = endPrice > ptb;
  const correct    = predictedOver === actualOver;
  const row = { ts: windowStart, ptb, end_price: endPrice, over: correct, source: SOURCE };
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/predictions_1h', {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      if (res.status === 409) { console.log(BOT_TAG, 'Already saved for window', windowStart); return; }
      console.error(BOT_TAG, 'Save error:', res.status, await res.text());
    } else {
      const result = correct ? 'WIN' : 'LOSS';
      if (correct) state.wins++; else state.losses++;
      const total = state.wins + state.losses;
      const wr = total > 0 ? ((state.wins / total) * 100).toFixed(1) : '0';
      console.log(BOT_TAG, `${result} | ${predictedOver ? 'UP' : 'DOWN'} | PTB $${ptb.toFixed(2)} → End $${endPrice.toFixed(2)} | W:${state.wins} L:${state.losses} WR:${wr}%`);
      await discordResult(correct, predictedOver, ptb, endPrice);
    }
  } catch(e) { console.error(BOT_TAG, 'Save exception:', e.message); }
}

async function saveSkip(windowStart, ptb, reason) {
  state.skips++;
  const row = { ts: windowStart, ptb: ptb || null, end_price: null, over: null, source: SOURCE + '-skip' };
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/predictions_1h', {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.warn(BOT_TAG, 'Skip save failed:', res.status);
    else console.log(BOT_TAG, 'Skip saved | Reason:', reason);
  } catch(e) { console.error(BOT_TAG, 'Skip save error:', e.message); }
  await discordSkip(reason);
}

async function loadStats() {
  try {
    const url = SUPABASE_URL + '/rest/v1/predictions_1h?select=ts,over&source=eq.' + SOURCE + '&order=ts.desc&limit=1000';
    const res = await fetch(url, { headers: SB_HEADERS });
    if (!res.ok) return;
    const data = await res.json();
    const seen = {}; let w = 0, l = 0;
    for (const p of data) {
      const ts = Number(p.ts);
      if (seen[ts]) continue; seen[ts] = true;
      if (p.over === null || p.over === undefined) continue;
      const over = (p.over === true || p.over === 'true' || p.over === 't' || p.over === 1 || p.over === '1');
      if (over) w++; else l++;
    }
    state.wins = w; state.losses = l;
    console.log(BOT_TAG, `Loaded stats: ${w}W / ${l}L`);
  } catch(e) { console.error(BOT_TAG, 'Load stats error:', e.message); }
}

// ═══════════════════════════════════════════
// DISCORD
// ═══════════════════════════════════════════

async function sendDiscord(payload) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
  } catch(e) { console.error(BOT_TAG, 'Discord error:', e.message); }
}

async function discordPrediction(direction, confLabel, confPct, bullScore, bearScore, signals) {
  const isUp = direction === 'up';
  const total = state.wins + state.losses;
  const wr = total > 0 ? ((state.wins / total) * 100).toFixed(1) : '0';
  const windowTime = new Date(state.currentWindowStart * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  await sendDiscord({
    username: 'Vanguard 1H Bot', avatar_url: 'https://i.imgur.com/AfFp7pu.png',
    embeds: [{
      title: `${isUp ? '🟢' : '🔴'}  BTC 1H Call — ${isUp ? '⬆️ UP' : '⬇️ DOWN'}`,
      color: isUp ? 0x00c853 : 0xff1744,
      fields: [
        { name: '📍 PTB',        value: `**$${state.priceToBeat ? state.priceToBeat.toFixed(2) : '--'}**`, inline: true },
        { name: '💰 BTC',        value: `**$${state.btcPrice ? state.btcPrice.toFixed(2) : '--'}**`,       inline: true },
        { name: '🔥 Confidence', value: `**${confLabel}** (${confPct.toFixed(0)}%)`,                       inline: true },
        { name: '📊 Scores',     value: `🐂 \`${bullScore.toFixed(1)}\`  🐻 \`${bearScore.toFixed(1)}\``, inline: true },
        { name: '📈 Market',     value: `Up: **${state.upPct || '--'}%** | Down: **${state.downPct || '--'}%**`, inline: true },
        { name: '🏆 Record',     value: `${state.wins}W / ${state.losses}L (${wr}% WR)`,                   inline: true },
        { name: '🔍 Signals',    value: signals ? `\`${signals.slice(0, 500)}\`` : '--',                    inline: false },
      ],
      footer: { text: `1H Window: ${windowTime}  •  Vanguard 1H Bot` },
      timestamp: new Date().toISOString(),
    }],
  });
}

async function discordSkip(reason) {
  const total = state.wins + state.losses;
  const wr = total > 0 ? ((state.wins / total) * 100).toFixed(1) : '0';
  await sendDiscord({
    username: 'Vanguard 1H Bot', avatar_url: 'https://i.imgur.com/AfFp7pu.png',
    embeds: [{
      title: '🚫  NO TRADE — 1H SKIP', color: 0x555555,
      description: reason || 'No high-probability setup.',
      fields: [
        { name: '📍 PTB', value: state.priceToBeat ? `$${state.priceToBeat.toFixed(2)}` : '--', inline: true },
        { name: '💰 BTC', value: state.btcPrice    ? `$${state.btcPrice.toFixed(2)}` : '--',    inline: true },
        { name: '🏆 Record', value: `${state.wins}W / ${state.losses}L (${wr}% WR) | Skips: ${state.skips}`, inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
  });
}

async function discordResult(correct, predictedOver, ptb, endPrice) {
  const total = state.wins + state.losses;
  const wr = total > 0 ? ((state.wins / total) * 100).toFixed(1) : '0';
  await sendDiscord({
    username: 'Vanguard 1H Bot', avatar_url: 'https://i.imgur.com/AfFp7pu.png',
    embeds: [{
      title: `${correct ? '✅' : '❌'}  ${correct ? 'WIN' : 'LOSS'} — Predicted ${predictedOver ? '⬆️ UP' : '⬇️ DOWN'}`,
      color: correct ? 0x00e676 : 0xff5252,
      description: `BTC **${endPrice > ptb ? '⬆️ went UP' : '⬇️ went DOWN'}** from PTB`,
      fields: [
        { name: '📍 PTB',       value: `$${ptb.toFixed(2)}`,       inline: true },
        { name: '🏁 End Price', value: `$${endPrice.toFixed(2)}`,  inline: true },
        { name: '📉 Delta',     value: `${endPrice > ptb ? '+' : ''}${(endPrice - ptb).toFixed(2)}`, inline: true },
        { name: '🏆 Record',    value: `**${state.wins}W / ${state.losses}L** — ${wr}% WR`, inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
  });
}

// ═══════════════════════════════════════════
// PREDICTION ENGINE
// ═══════════════════════════════════════════

async function makePrediction() {
  const ptb   = state.priceToBeat;
  const price = state.btcPrice;

  if (!ptb || !price) {
    console.log(BOT_TAG, 'makePrediction: no PTB or price — will retry next tick');
    return; // do NOT set predictionMade so we retry
  }

  const signals = [];
  let bullScore = 0, bearScore = 0;
  const diff    = price - ptb;
  const pctDiff = (diff / ptb) * 100;
  const absPct  = Math.abs(pctDiff);

  // Signal 1: Price vs PTB (higher weight for 1h — price position is more meaningful)
  if (absPct > 0.3) {
    if (diff > 0) { bullScore += 6; signals.push(`PTB +${pctDiff.toFixed(3)}% STRONG`); }
    else           { bearScore += 6; signals.push(`PTB ${pctDiff.toFixed(3)}% STRONG`); }
  } else if (absPct > 0.1) {
    if (diff > 0) { bullScore += 4; signals.push(`PTB +${pctDiff.toFixed(3)}% SAFE`); }
    else           { bearScore += 4; signals.push(`PTB ${pctDiff.toFixed(3)}% SAFE`); }
  } else if (absPct > 0.05) {
    if (diff > 0) { bullScore += 2; signals.push(`PTB +${pctDiff.toFixed(3)}%`); }
    else           { bearScore += 2; signals.push(`PTB ${pctDiff.toFixed(3)}%`); }
  } else if (absPct > 0.01) {
    if (diff > 0) { bullScore += 1; signals.push(`PTB +${pctDiff.toFixed(3)}% THIN`); }
    else           { bearScore += 1; signals.push(`PTB ${pctDiff.toFixed(3)}% THIN`); }
  } else { signals.push(`PTB FLAT`); }

  // Signal 2: Polymarket odds
  if (state.upPct && state.downPct) {
    const up = parseFloat(state.upPct), dn = parseFloat(state.downPct);
    if (up > 65)       { bullScore += 3;   signals.push(`MKT UP ${up}%`); }
    else if (dn > 65)  { bearScore += 3;   signals.push(`MKT DOWN ${dn}%`); }
    else if (up > 55)  { bullScore += 1.5; signals.push(`MKT LEAN UP ${up}%`); }
    else if (dn > 55)  { bearScore += 1.5; signals.push(`MKT LEAN DOWN ${dn}%`); }
    else               { signals.push(`MKT SPLIT ${up}/${dn}`); }
  }

  // Signal 3: Window trajectory
  if (state.analysisDone && state.analysisPrice) {
    const trajDiff = price - state.analysisPrice;
    const trajPct  = (trajDiff / state.analysisPrice) * 100;
    const abovePTB = diff > 0;
    if (Math.abs(trajPct) > 0.02) {
      const movingUp = trajDiff > 0;
      if (abovePTB && movingUp)        { bullScore += 3; signals.push(`TRAJ↑↑ +${trajPct.toFixed(3)}%`); }
      else if (!abovePTB && !movingUp) { bearScore += 3; signals.push(`TRAJ↓↓ ${trajPct.toFixed(3)}%`); }
      else if (abovePTB && !movingUp)  { bearScore += 2; signals.push(`TRAJ↓ CLOSING`); }
      else                             { bullScore += 2; signals.push(`TRAJ↑ CLOSING`); }
    }
  }

  // Signal 4: 1h candle momentum + TA
  try {
    const candles = await fetchCandles(INTERVAL, 50);
    if (candles && candles.length >= 5) {
      const ta = computeTA(candles);
      // EMA alignment
      if (ta && ta.emaAligned === 'BULLISH') { bullScore += 1.5; signals.push('EMA BULL'); }
      else if (ta && ta.emaAligned === 'BEARISH') { bearScore += 1.5; signals.push('EMA BEAR'); }
      // RSI
      if (ta && ta.rsi != null) {
        if (ta.rsi > 70) { bearScore += 2; signals.push(`RSI OB ${ta.rsi.toFixed(0)}`); }
        else if (ta.rsi < 30) { bullScore += 2; signals.push(`RSI OS ${ta.rsi.toFixed(0)}`); }
        else if (ta.rsiDelta > 2) { bullScore += 0.5; }
        else if (ta.rsiDelta < -2) { bearScore += 0.5; }
      }
      // MACD
      if (ta && ta.macdHist != null) {
        if (ta.macdCrossing) {
          if (ta.macdHist > 0) { bullScore += 2; signals.push('MACD BULL X'); }
          else                 { bearScore += 2; signals.push('MACD BEAR X'); }
        } else if (ta.macdHist > 0 && ta.macdHistDelta > 0) { bullScore += 0.5; }
        else if (ta.macdHist < 0 && ta.macdHistDelta < 0) { bearScore += 0.5; }
      }
      // 1h candle momentum
      const recent = candles.slice(-3);
      const momPct = ((recent[recent.length-1].close - recent[0].open) / recent[0].open) * 100;
      if (momPct > 0.15)       { bullScore += 1.5; signals.push(`MOM↑ +${momPct.toFixed(3)}%`); }
      else if (momPct < -0.15) { bearScore += 1.5; signals.push(`MOM↓ ${momPct.toFixed(3)}%`); }
      else if (momPct > 0.05)  { bullScore += 0.5; }
      else if (momPct < -0.05) { bearScore += 0.5; }
    }
  } catch(e) {}

  // Decision
  const margin    = Math.abs(bullScore - bearScore);
  const total     = bullScore + bearScore;
  const confPct   = total > 0 ? (Math.max(bullScore, bearScore) / total * 100) : 50;
  const confLabel = margin >= 4 ? 'HIGH' : margin >= 2 ? 'MED' : 'LOW';
  let isUp = bullScore > bearScore || (bullScore === bearScore && diff >= 0);

  // Skip coin flips (1h uses tighter threshold)
  if (absPct < 0.02 && margin < 0.5) {
    const reason = `Coin flip — PTB diff: ${pctDiff.toFixed(4)}%`;
    console.log(BOT_TAG, 'SKIP —', reason);
    state.predictionDirection = null;
    state.predictionMade = true;
    await saveSkip(state.currentWindowStart, ptb, reason);
    await publishLivePrediction({ direction: 'pending', ptb, btcPrice: price, confidence: 'LOW', confPct: 50, bullScore, bearScore, signalsText: 'SKIP — ' + reason });
    return;
  }

  state.predictionDirection = isUp ? 'up' : 'down';
  state.predictionPTB       = ptb;
  state.predictionMade      = true;

  const signalsText = signals.join(' · ');
  console.log(BOT_TAG, `PREDICTION: ${isUp ? 'UP' : 'DOWN'} | ${confLabel} ${confPct.toFixed(0)}% | Bull:${bullScore.toFixed(1)} Bear:${bearScore.toFixed(1)}`);

  await publishLivePrediction({ direction: isUp ? 'up' : 'down', ptb, btcPrice: price, confidence: confLabel, confPct, bullScore, bearScore, signalsText });
  await discordPrediction(isUp ? 'up' : 'down', confLabel, confPct, bullScore, bearScore, signalsText);
}

// ═══════════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════════

let rtdsWs = null;

function connectRTDS() {
  if (rtdsWs && rtdsWs.readyState <= 1) return;
  try {
    rtdsWs = new WebSocket('wss://ws-live-data.polymarket.com');
    rtdsWs.on('open', () => {
      console.log(BOT_TAG, 'RTDS connected');
      rtdsWs.send(JSON.stringify({ action: 'subscribe', subscriptions: [{ topic: 'crypto_prices_chainlink', type: '*', filters: '{"symbol":"btc/usd"}' }] }));
    });
    rtdsWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.payload?.data && Array.isArray(msg.payload.data)) {
          const h = msg.payload.data;
          if (h.length > 0) state.btcPrice = h[h.length-1].value;
          return;
        }
        if (msg.topic === 'crypto_prices_chainlink' && msg.payload?.value) {
          state.btcPrice = msg.payload.value;
          priceBuffer.push({ timestamp: Date.now(), value: msg.payload.value });
          if (priceBuffer.length > 600) priceBuffer.shift();
          const now = Math.floor(Date.now() / 1000);
          const ws  = Math.floor(now / WINDOW_SECS) * WINDOW_SECS;
          if (now - ws <= 5 && chainlinkSnapshotWindow !== ws) {
            chainlinkSnapshotPrice  = msg.payload.value;
            chainlinkSnapshotWindow = ws;
            console.log(BOT_TAG, 'Chainlink snapshot:', chainlinkSnapshotPrice);
          }
        }
      } catch(e) {}
    });
    rtdsWs.on('error', (e) => { console.error(BOT_TAG, 'RTDS error:', e.message); });
    rtdsWs.on('close', () => { console.log(BOT_TAG, 'RTDS closed — reconnecting in 5s'); setTimeout(connectRTDS, 5000); });
  } catch(e) { console.error(BOT_TAG, 'WS connect failed:', e.message); setTimeout(connectRTDS, 10000); }
}

// ═══════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════

async function tick() {
  const now         = Math.floor(Date.now() / 1000);
  const windowEnd   = (Math.floor(now / WINDOW_SECS) + 1) * WINDOW_SECS;
  const windowStart = windowEnd - WINDOW_SECS;
  const timeLeft    = windowEnd - now;

  // New window
  if (state.currentWindowStart !== 0 && state.currentWindowStart !== windowStart) {
    if (state.predictionMade && state.predictionDirection && state.predictionPTB && state.btcPrice) {
      await savePrediction(state.currentWindowStart, state.predictionPTB, state.btcPrice, state.predictionDirection === 'up');
    }
    state.priceToBeat = null; state.ptbSource = null;
    state.predictionMade = false; state.predictionDirection = null; state.predictionPTB = null;
    state.analysisDone = false; state.analysisPrice = null;
    state.analysisOddsUp = null; state.analysisOddsDown = null;
    console.log(BOT_TAG, `\n═══ NEW 1H WINDOW: ${new Date(windowStart * 1000).toLocaleTimeString()} ═══`);
    await publishLivePrediction({ direction: 'pending' });
  }

  state.currentWindowStart = windowStart;

  // Fetch candles
  try {
    const candles = await fetchCandles();
    if (!state.btcPrice && candles && candles.length > 0) state.btcPrice = candles[candles.length-1].close;
  } catch(e) {}

  // PTB
  if (!state.priceToBeat) {
    try {
      const poly = await fetchPolymarket();
      if (poly) {
        state.upPct = poly.upPct; state.downPct = poly.downPct;
        if (poly.startingPrice) { state.priceToBeat = poly.startingPrice; state.ptbSource = 'polymarket'; console.log(BOT_TAG, 'PTB from Polymarket:', state.priceToBeat); }
      }
    } catch(e) {}
    if (!state.priceToBeat) {
      try {
        const ptb = await fetchPTBFallback();
        if (ptb) { state.priceToBeat = ptb; state.ptbSource = 'binance-1h'; console.log(BOT_TAG, 'PTB from Binance 1H candle open:', ptb); }
      } catch(e) {}
    }
  } else {
    try { const poly = await fetchPolymarket(); if (poly) { state.upPct = poly.upPct; state.downPct = poly.downPct; } } catch(e) {}
  }

  // Log PTB status
  if (!state.priceToBeat) {
    console.log(BOT_TAG, 'WARNING: No PTB available — skipping prediction this tick');
  }

  // Analysis snapshot at 30% remaining (70% through window)
  const analysisMark = Math.floor(WINDOW_SECS * 0.30); // 1080s = 18 min remaining
  if (!state.analysisDone && timeLeft <= analysisMark + 60 && timeLeft > analysisMark && state.priceToBeat && state.btcPrice) {
    state.analysisDone    = true;
    state.analysisPrice   = state.btcPrice;
    state.analysisOddsUp  = state.upPct ? parseFloat(state.upPct) : null;
    state.analysisOddsDown = state.downPct ? parseFloat(state.downPct) : null;
    console.log(BOT_TAG, `ANALYSIS | BTC: $${state.btcPrice.toFixed(2)} | PTB dist: ${((state.btcPrice - state.priceToBeat)/state.priceToBeat*100).toFixed(3)}%`);
  }

  // Vote at 20% remaining (720s = 12 min remaining)
  const voteMark = Math.floor(WINDOW_SECS * 0.20);
  if (!state.predictionMade && timeLeft <= voteMark && timeLeft > 0 && state.priceToBeat) {
    await makePrediction();
  }

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  console.log(BOT_TAG, `BTC: $${state.btcPrice ? state.btcPrice.toFixed(2) : '--'} | PTB: $${state.priceToBeat ? state.priceToBeat.toFixed(2) : '--'} | ${mins}:${secs < 10 ? '0' : ''}${secs} left | Pred: ${state.predictionDirection || 'pending'} | W:${state.wins} L:${state.losses} Skip:${state.skips}`);
}

async function init() {
  console.log(BOT_TAG, '═══════════════════════════════════════');
  console.log(BOT_TAG, 'VANGUARD 1-HOUR BOT STARTING');
  console.log(BOT_TAG, '═══════════════════════════════════════');
  await loadStats();
  connectRTDS();
  state.currentWindowStart = Math.floor(Math.floor(Date.now() / 1000) / WINDOW_SECS) * WINDOW_SECS;
  await tick();
  setInterval(tick, 60000); // tick every 60s (1h windows don't need 30s polling)
}

init().catch(e => { console.error(BOT_TAG, 'Fatal error:', e); process.exit(1); });
