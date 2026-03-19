// ═══════════════════════════════════════════════════════════════
// VANGUARD PREDICTION BOT — Runs 24/7 as a free Render Web Service
// Mirrors agent.js prediction logic, saves to Supabase
// ═══════════════════════════════════════════════════════════════

import WebSocket from 'ws';
import { createServer } from 'http';

// ── Config ──
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zrvbmzjsivxlcodsdvrb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpydmJtempzaXZ4bGNvZHNkdnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTkxNTYsImV4cCI6MjA4ODEzNTE1Nn0.gBu0RL9tHBCjYmkiupziTPAsVX3s8TovUdMhjWPjiLw';
const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
};

// ── Discord ──
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || null;

// ── State ──
const state = {
  btcPrice: null,
  priceSource: null,
  priceToBeat: null,
  ptbSource: null,
  currentWindowStart: 0,
  upPct: null,
  downPct: null,
  ta: null,
  wins: 0,
  losses: 0,
  skips: 0,
  predictionMade: false,
  predictionDirection: null,
  predictionPTB: null,
  analysisDone: false,
  analysisPrice: null,
  analysisTime: null,
  analysisPtbDist: null,
  analysisOddsUp: null,
  analysisOddsDown: null,
};

// ── Keep-alive HTTP server ──
const PORT = process.env.PORT || 3000;
createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'running',
    uptime: Math.floor(process.uptime()),
    wins: state.wins,
    losses: state.losses,
    skips: state.skips,
    btcPrice: state.btcPrice,
    priceToBeat: state.priceToBeat,
    prediction: state.predictionDirection,
  }));
}).listen(PORT, () => console.log(`[BOT] Health server on port ${PORT}`));

let chainlinkSnapshotPrice = null;
let chainlinkSnapshotWindow = 0;
let priceBuffer = [];

// ═══════════════════════════════════════════
// TA INDICATORS
// ═══════════════════════════════════════════

function ema(data, period) {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function rsi(closes, period = 14) {
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = new Array(period).fill(null);
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function macd(closes) {
  const emaFast = ema(closes, 12);
  const emaSlow = ema(closes, 26);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = ema(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macd: macdLine, signal: signalLine, histogram };
}

function vwap(highs, lows, closes, volumes) {
  let cumVol = 0, cumTP = 0;
  return closes.map((c, i) => {
    const tp = (highs[i] + lows[i] + c) / 3;
    cumVol += volumes[i];
    cumTP += tp * volumes[i];
    return cumVol > 0 ? cumTP / cumVol : c;
  });
}

function volumeZScore(volumes, period = 20) {
  return volumes.map((v, i) => {
    if (i < period) return 0;
    const slice = volumes.slice(i - period, i);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((sum, x) => sum + (x - mean) ** 2, 0) / period);
    return std > 0 ? (v - mean) / std : 0;
  });
}

function bollingerBands(closes, period = 20, mult = 2) {
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((sum, x) => sum + (x - mean) ** 2, 0) / period);
    result.push({ upper: mean + mult * std, middle: mean, lower: mean - mult * std, bandwidth: std > 0 ? ((mult * 2 * std) / mean) * 100 : 0 });
  }
  return result;
}

function atr(highs, lows, closes, period = 14) {
  const trs = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const result = new Array(period - 1).fill(null);
  let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(avg);
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period;
    result.push(avg);
  }
  return result;
}

function computeTA(candles) {
  if (!candles || candles.length < 30) return null;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const vols = candles.map(c => c.volume);
  const last = candles.length - 1;

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const vwapData = vwap(highs, lows, closes, vols);
  const volZ = volumeZScore(vols, 20);
  const bbands = bollingerBands(closes, 20, 2);
  const atrData = atr(highs, lows, closes, 14);

  const aligned = ema9[last] > ema21[last] && ema21[last] > ema50[last] ? 'BULLISH' :
                  ema9[last] < ema21[last] && ema21[last] < ema50[last] ? 'BEARISH' : 'MIXED';

  const rsiPrev = rsi14[last - 1];
  const rsiDelta = (rsi14[last] != null && rsiPrev != null) ? rsi14[last] - rsiPrev : 0;
  const macdHistPrev = macdData.histogram[last - 1];
  const macdHistDelta = macdData.histogram[last] - macdHistPrev;
  const ret1 = ((closes[last] - closes[last - 1]) / closes[last - 1]) * 100;
  const ret3 = last >= 3 ? ((closes[last] - closes[last - 3]) / closes[last - 3]) * 100 : 0;

  let recentBullCandles = 0, recentBearCandles = 0;
  for (let i = last; i >= Math.max(0, last - 2); i--) {
    if (candles[i].close > candles[i].open) recentBullCandles++;
    else recentBearCandles++;
  }

  const ema9Slope = last >= 3 ? ((ema9[last] - ema9[last - 3]) / ema9[last - 3]) * 100 : 0;
  const bb = bbands[last];
  const bbPos = bb ? (closes[last] - bb.lower) / (bb.upper - bb.lower) : 0.5;
  const bbBandwidth = bb ? bb.bandwidth : 0;
  const atrVal = atrData[last];
  const atrPct = atrVal ? (atrVal / closes[last]) * 100 : 0;

  return {
    price: closes[last], rsi: rsi14[last], rsiDelta, macdHist: macdData.histogram[last],
    macdHistDelta, macdCrossing: Math.sign(macdData.histogram[last]) !== Math.sign(macdData.histogram[last - 1]),
    emaAligned: aligned, ema9Slope,
    vwapDist: ((closes[last] - vwapData[last]) / vwapData[last] * 100),
    volZScore: volZ[last], ret1, ret3, recentBullCandles, recentBearCandles, bbPos, bbBandwidth, atrPct,
  };
}

// ═══════════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════════

async function fetchCandles(interval = '5m', limit = 100) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = await res.json();
    return raw.map(c => ({
      time: c[0], open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]), close: parseFloat(c[4]), volume: parseFloat(c[5]),
    }));
  } catch (e) {
    console.error(`[BOT] Binance ${interval} error:`, e.message);
    return null;
  }
}

async function fetchPolymarket() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const interval = 300;
    const currentStart = Math.floor(now / interval) * interval;
    const timestamps = [currentStart, currentStart + interval, currentStart - interval];

    let bestMarket = null, bestTs = 0;
    for (const ts of timestamps) {
      const slug = 'btc-updown-5m-' + ts;
      const url = 'https://gamma-api.polymarket.com/markets?slug=' + slug;
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
    if (!bestMarket) return null;

    const gammaOdds = JSON.parse(bestMarket.outcomePrices || '[]');
    const upPct = (parseFloat(gammaOdds[0] || 0) * 100).toFixed(1);
    const downPct = (parseFloat(gammaOdds[1] || 0) * 100).toFixed(1);

    let startingPrice = null, ptbSrc = null;
    if (bestTs === currentStart && bestMarket.startPrice) {
      startingPrice = parseFloat(bestMarket.startPrice);
      if (startingPrice > 0) ptbSrc = 'polymarket';
      else startingPrice = null;
    }
    const timeLeft = Math.max(0, (bestTs + interval) - now);
    return { startingPrice, ptbSource: ptbSrc, upPct, downPct, timeLeft, startTimestamp: bestTs };
  } catch (e) {
    console.error('[BOT] Polymarket error:', e.message);
    return null;
  }
}

async function fetchPTBFallback() {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / 300) * 300;
  if (chainlinkSnapshotPrice && chainlinkSnapshotWindow === windowStart) return chainlinkSnapshotPrice;
  try {
    const startMs = windowStart * 1000;
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=' + startMs + '&limit=1');
    if (res.ok) { const data = await res.json(); if (data && data.length > 0) return parseFloat(data[0][1]); }
  } catch (e) {}
  try {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1');
    if (res.ok) { const data = await res.json(); if (data && data.length > 0) return parseFloat(data[0][1]); }
  } catch (e) {}
  return null;
}

// ═══════════════════════════════════════════
// SUPABASE
// ═══════════════════════════════════════════

async function publishLivePrediction({ direction, ptb, btcPrice, confidence, confPct, bullScore, bearScore, signalsText }) {
  const row = {
    id: 1, direction: direction || 'pending', ptb: ptb || null, btc_price: btcPrice || null,
    confidence: confidence || null, conf_pct: confPct || null, bull_score: bullScore || 0,
    bear_score: bearScore || 0, signals: signalsText || '', updated_at: new Date().toISOString(),
  };
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/live_prediction', {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.error('[BOT] Live prediction publish error:', res.status, await res.text());
    else console.log(`[BOT] Live prediction published: ${direction}`);
  } catch (e) { console.error('[BOT] Live prediction exception:', e.message); }
}

async function savePrediction(windowStart, ptb, endPrice, predictedOver) {
  const actualOver = endPrice > ptb;
  const correct = predictedOver === actualOver;
  const row = { ts: windowStart, ptb, end_price: endPrice, over: correct, source: 'vanguard-bot' };
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/predictions', {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 409) { console.log('[BOT] Already saved for window', windowStart); return; }
      console.error('[BOT] Save error:', res.status, text);
    } else {
      const result = correct ? 'WIN' : 'LOSS';
      if (correct) state.wins++; else state.losses++;
      const total = state.wins + state.losses;
      const wr = total > 0 ? ((state.wins / total) * 100).toFixed(1) : '0';
      console.log(`[BOT] ${result} | Predicted ${predictedOver ? 'UP' : 'DOWN'} | PTB $${ptb.toFixed(2)} → End $${endPrice.toFixed(2)} | W:${state.wins} L:${state.losses} WR:${wr}%`);
      await discordResult(correct, predictedOver, ptb, endPrice);
      try { await savePredictionStats(state.wins, state.losses); } catch (e) {}
    }
  } catch (e) { console.error('[BOT] Save exception:', e.message); }
}

// ── Save a SKIP entry — source=vanguard-skip, over=null ──
async function saveSkip(windowStart, ptb, reason) {
  state.skips++;
  const row = { ts: windowStart, ptb: ptb || null, end_price: null, over: null, source: 'vanguard-skip' };
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/predictions', {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(row),
    });
    if (!res.ok) console.warn('[BOT] Skip save failed:', res.status, await res.text());
    else console.log(`[BOT] SKIP saved for window ${windowStart} | Reason: ${reason}`);
  } catch (e) { console.error('[BOT] Skip save error:', e.message); }

  // Discord skip notification
  await discordSkip(reason);
}

async function loadStats() {
  try {
    // Only load vanguard-bot entries — skips are excluded by source filter
    const url = SUPABASE_URL + '/rest/v1/predictions?select=ts,over&source=eq.vanguard-bot&order=ts.desc&limit=1000';
    const res = await fetch(url, { headers: SB_HEADERS });
    if (!res.ok) return;
    const data = await res.json();
    const seen = {};
    let w = 0, l = 0;
    for (const pOrig of data) {
      const p = Object.assign({}, pOrig, { ts: Number(pOrig.ts) });
      if (seen[p.ts]) continue;
      seen[p.ts] = true;
      const overRaw = pOrig.over;
      // Explicitly check over is not null before counting
      if (overRaw === null || overRaw === undefined) continue;
      const over = (overRaw === true || overRaw === 'true' || overRaw === 't' || overRaw === 1 || overRaw === '1');
      if (over) w++; else l++;
    }
    state.wins = w;
    state.losses = l;
    console.log(`[BOT] Loaded stats: ${w}W / ${l}L (${Object.keys(seen).length} unique windows, skips excluded)`);
    try { await savePredictionStats(state.wins, state.losses); } catch (e) {}
  } catch (e) { console.error('[BOT] Load stats error:', e.message); }
}

async function savePredictionStats(wins, losses) {
  try {
    const total = (wins || 0) + (losses || 0);
    const win_rate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
    const payload = { wins: wins || 0, losses: losses || 0, win_rate, updated_at: new Date().toISOString() };
    const res = await fetch(SUPABASE_URL + '/rest/v1/prediction_stats?id=eq.1', {
      method: 'PATCH', headers: SB_HEADERS, body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const res2 = await fetch(SUPABASE_URL + '/rest/v1/prediction_stats', {
        method: 'POST', headers: SB_HEADERS, body: JSON.stringify([{ id: 1, ...payload }]),
      });
      if (!res2.ok) throw new Error('Create stats failed: ' + res2.status);
    }
    return true;
  } catch (e) { throw e; }
}

// ═══════════════════════════════════════════
// DISCORD NOTIFICATIONS
// ═══════════════════════════════════════════

async function sendDiscord(payload) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
  } catch (e) { console.error('[BOT] Discord send error:', e.message); }
}

async function discordPrediction(direction, confLabel, confPct, bullScore, bearScore, signals) {
  const isUp = direction === 'up';
  const emoji = isUp ? '🟢' : '🔴';
  const arrow = isUp ? '⬆️  UP' : '⬇️  DOWN';
  const confEmoji = confLabel === 'HIGH' ? '🔥' : confLabel === 'MED' ? '⚡' : '🌀';
  const color = isUp ? 0x00c853 : 0xff1744;
  const windowTime = new Date(state.currentWindowStart * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const total = state.wins + state.losses;
  const wr = total > 0 ? ((state.wins / total) * 100).toFixed(1) : '0';
  await sendDiscord({
    username: 'Vanguard Bot', avatar_url: 'https://i.imgur.com/AfFp7pu.png',
    embeds: [{
      title: `${emoji}  BTC 5m Call — ${arrow}`, color,
      fields: [
        { name: '📍 Price to Beat', value: `**$${state.priceToBeat ? state.priceToBeat.toFixed(2) : '--'}**`, inline: true },
        { name: '💰 Current BTC', value: `**$${state.btcPrice ? state.btcPrice.toFixed(2) : '--'}**`, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: `${confEmoji} Confidence`, value: `**${confLabel}** (${confPct.toFixed(0)}%)`, inline: true },
        { name: '📊 Scores', value: `🐂 Bull: \`${bullScore.toFixed(1)}\`  🐻 Bear: \`${bearScore.toFixed(1)}\``, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: '📈 Market Odds', value: `Up: **${state.upPct || '--'}%** | Down: **${state.downPct || '--'}%**`, inline: true },
        { name: '🏆 Record', value: `${state.wins}W / ${state.losses}L  (${wr}% WR)`, inline: true },
        { name: '🔍 Signals', value: signals ? `\`${signals}\`` : '--', inline: false },
      ],
      footer: { text: `Window: ${windowTime}  •  Vanguard Prediction Bot` },
      timestamp: new Date().toISOString(),
    }],
  });
}

async function discordSkip(reason) {
  const total = state.wins + state.losses;
  const wr = total > 0 ? ((state.wins / total) * 100).toFixed(1) : '0';
  const windowTime = new Date(state.currentWindowStart * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  await sendDiscord({
    username: 'Vanguard Bot', avatar_url: 'https://i.imgur.com/AfFp7pu.png',
    embeds: [{
      title: '🚫  NO TRADE — SKIP',
      color: 0x555555,
      description: reason || 'No high-probability setup detected.',
      fields: [
        { name: '📍 PTB', value: state.priceToBeat ? `$${state.priceToBeat.toFixed(2)}` : '--', inline: true },
        { name: '💰 BTC', value: state.btcPrice ? `$${state.btcPrice.toFixed(2)}` : '--', inline: true },
        { name: '🏆 Record (excl. skips)', value: `${state.wins}W / ${state.losses}L  (${wr}% WR) | Skips: ${state.skips}`, inline: false },
      ],
      footer: { text: `Window: ${windowTime}  •  Vanguard Prediction Bot` },
      timestamp: new Date().toISOString(),
    }],
  });
}

async function discordResult(correct, predictedOver, ptb, endPrice) {
  const resultEmoji = correct ? '✅' : '❌';
  const resultText = correct ? 'WIN' : 'LOSS';
  const color = correct ? 0x00e676 : 0xff5252;
  const predLabel = predictedOver ? '⬆️ UP' : '⬇️ DOWN';
  const actual = endPrice > ptb ? '⬆️ went UP' : '⬇️ went DOWN';
  const total = state.wins + state.losses;
  const wr = total > 0 ? ((state.wins / total) * 100).toFixed(1) : '0';
  await sendDiscord({
    username: 'Vanguard Bot', avatar_url: 'https://i.imgur.com/AfFp7pu.png',
    embeds: [{
      title: `${resultEmoji}  ${resultText} — Predicted ${predLabel}`, color,
      description: `BTC **${actual}** from PTB`,
      fields: [
        { name: '📍 PTB', value: `$${ptb.toFixed(2)}`, inline: true },
        { name: '🏁 End Price', value: `$${endPrice.toFixed(2)}`, inline: true },
        { name: '📉 Delta', value: `${endPrice > ptb ? '+' : ''}${(endPrice - ptb).toFixed(2)}`, inline: true },
        { name: '🏆 Updated Record', value: `**${state.wins}W / ${state.losses}L** — ${wr}% WR`, inline: false },
      ],
      footer: { text: 'Vanguard Prediction Bot' },
      timestamp: new Date().toISOString(),
    }],
  });
}

// ═══════════════════════════════════════════
// PREDICTION ENGINE
// ═══════════════════════════════════════════

async function makePrediction() {
  const ptb = state.priceToBeat;
  const price = state.btcPrice;

  if (!ptb || !price) {
    state.predictionDirection = null;
    state.predictionMade = true;
    await publishLivePrediction({ direction: 'pending', ptb, btcPrice: price, signalsText: 'NO DATA' });
    return;
  }

  const signals = [];
  let bullScore = 0, bearScore = 0;
  const diff = price - ptb;
  const pctDiff = (diff / ptb) * 100;
  const absPct = Math.abs(pctDiff);

  // Signal 1: Price vs PTB
  if (absPct > 0.1) {
    if (diff > 0) { bullScore += 5; signals.push(`PTB +${pctDiff.toFixed(3)}% SAFE`); }
    else           { bearScore += 5; signals.push(`PTB ${pctDiff.toFixed(3)}% SAFE`); }
  } else if (absPct > 0.03) {
    if (diff > 0) { bullScore += 3; signals.push(`PTB +${pctDiff.toFixed(3)}%`); }
    else           { bearScore += 3; signals.push(`PTB ${pctDiff.toFixed(3)}%`); }
  } else if (absPct > 0.01) {
    if (diff > 0) { bullScore += 1; signals.push(`PTB +${pctDiff.toFixed(3)}% THIN`); }
    else           { bearScore += 1; signals.push(`PTB ${pctDiff.toFixed(3)}% THIN`); }
  } else {
    signals.push(`PTB ${pctDiff.toFixed(4)}% FLAT`);
  }

  // Signal 2: Polymarket odds
  if (state.upPct && state.downPct) {
    const up = parseFloat(state.upPct), down = parseFloat(state.downPct);
    if (up > 65)        { bullScore += 3;   signals.push(`MKT UP ${up}%`); }
    else if (down > 65) { bearScore += 3;   signals.push(`MKT DOWN ${down}%`); }
    else if (up > 55)   { bullScore += 1.5; signals.push(`MKT LEAN UP ${up}%`); }
    else if (down > 55) { bearScore += 1.5; signals.push(`MKT LEAN DOWN ${down}%`); }
    else                { signals.push(`MKT SPLIT ${up}/${down}`); }
  }

  // Signal 3: Window trajectory
  if (state.analysisDone && state.analysisPrice) {
    const trajDiff = price - state.analysisPrice;
    const trajPct = (trajDiff / state.analysisPrice) * 100;
    const abovePTB = diff > 0;
    if (Math.abs(trajPct) > 0.01) {
      const movingUp = trajDiff > 0;
      if (abovePTB && movingUp)   { bullScore += 3; signals.push(`TRAJ↑↑ +${trajPct.toFixed(3)}% AWAY`); }
      else if (!abovePTB && !movingUp) { bearScore += 3; signals.push(`TRAJ↓↓ ${trajPct.toFixed(3)}% AWAY`); }
      else if (abovePTB && !movingUp) { bearScore += 2; signals.push(`TRAJ↓ ${trajPct.toFixed(3)}% CLOSING`); }
      else if (!abovePTB && movingUp) { bullScore += 2; signals.push(`TRAJ↑ +${trajPct.toFixed(3)}% CLOSING`); }
    } else { signals.push(`TRAJ FLAT ${trajPct.toFixed(4)}%`); }
    if (state.analysisOddsUp != null && state.upPct) {
      const oddsShift = parseFloat(state.upPct) - state.analysisOddsUp;
      if (oddsShift > 3)  { bullScore += 1; signals.push(`ODDS SHIFT↑ +${oddsShift.toFixed(1)}`); }
      else if (oddsShift < -3) { bearScore += 1; signals.push(`ODDS SHIFT↓ ${oddsShift.toFixed(1)}`); }
    }
  }

  // Signal 4: Recent 1m momentum
  try {
    const candles1m = await fetchCandles('1m', 5);
    if (candles1m && candles1m.length >= 3) {
      const recent = candles1m.slice(-3);
      const momChange = recent[recent.length - 1].close - recent[0].open;
      const momPct = (momChange / recent[0].open) * 100;
      if (momPct > 0.03)       { bullScore += 1.5; signals.push(`MOM↑ +${momPct.toFixed(3)}%`); }
      else if (momPct < -0.03) { bearScore += 1.5; signals.push(`MOM↓ ${momPct.toFixed(3)}%`); }
      else if (momPct > 0.01)  { bullScore += 0.5; signals.push(`MOM↑ +${momPct.toFixed(3)}%`); }
      else if (momPct < -0.01) { bearScore += 0.5; signals.push(`MOM↓ ${momPct.toFixed(3)}%`); }
    }
  } catch (e) {}

  // Decision
  let isUp;
  if (bullScore === bearScore) { isUp = diff >= 0; signals.push('TIE→PRICE'); }
  else { isUp = bullScore > bearScore; }

  const margin = Math.abs(bullScore - bearScore);
  const totalScore = bullScore + bearScore;
  const confPct = totalScore > 0 ? (Math.max(bullScore, bearScore) / totalScore * 100) : 50;
  const confLabel = margin >= 4 ? 'HIGH' : margin >= 2 ? 'MED' : 'LOW';

  // SKIP — coin flip, no edge
  if (absPct < 0.005 && margin < 0.5) {
    const skipReason = `Coin flip — PTB diff: ${pctDiff.toFixed(4)}%, margin: ${margin.toFixed(1)}`;
    console.log(`[BOT] SKIP — ${skipReason}`);
    state.predictionDirection = null;
    state.predictionMade = true;
    // Save skip to Supabase (over=null, source=vanguard-skip)
    await saveSkip(state.currentWindowStart, ptb, skipReason);
    await publishLivePrediction({ direction: 'pending', ptb, btcPrice: price, confidence: 'LOW', confPct: 50, bullScore, bearScore, signalsText: `SKIP — ${skipReason}` });
    return;
  }

  state.predictionDirection = isUp ? 'up' : 'down';
  state.predictionPTB = ptb;
  state.predictionMade = true;

  const signalsText = signals.join(' · ');
  console.log(`[BOT] PREDICTION: ${isUp ? 'UP' : 'DOWN'} | ${confLabel} ${confPct.toFixed(0)}% | Bull:${bullScore.toFixed(1)} Bear:${bearScore.toFixed(1)} | PTB:${pctDiff.toFixed(3)}%`);
  console.log(`[BOT] Signals: ${signalsText}`);

  await publishLivePrediction({ direction: isUp ? 'up' : 'down', ptb, btcPrice: price, confidence: confLabel, confPct, bullScore, bearScore, signalsText });
  await discordPrediction(isUp ? 'up' : 'down', confLabel, confPct, bullScore, bearScore, signalsText);
}

// ═══════════════════════════════════════════
// WEBSOCKET — Live BTC price
// ═══════════════════════════════════════════

let rtdsWs = null;

function connectRTDS() {
  if (rtdsWs && rtdsWs.readyState <= 1) return;
  try {
    rtdsWs = new WebSocket('wss://ws-live-data.polymarket.com');
    rtdsWs.on('open', () => {
      console.log('[BOT] RTDS connected');
      rtdsWs.send(JSON.stringify({ action: 'subscribe', subscriptions: [{ topic: 'crypto_prices_chainlink', type: '*', filters: '{"symbol":"btc/usd"}' }] }));
    });
    rtdsWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.payload && msg.payload.data && Array.isArray(msg.payload.data)) {
          const history = msg.payload.data;
          if (history.length > 0) { state.btcPrice = history[history.length - 1].value; state.priceSource = 'chainlink'; }
          return;
        }
        if (msg.topic === 'crypto_prices_chainlink' && msg.payload && msg.payload.value) {
          state.btcPrice = msg.payload.value;
          state.priceSource = 'chainlink';
          priceBuffer.push({ timestamp: msg.payload.timestamp || Date.now(), value: msg.payload.value });
          if (priceBuffer.length > 600) priceBuffer.shift();
          const now = Math.floor(Date.now() / 1000);
          const windowStart = Math.floor(now / 300) * 300;
          const sinceBoundary = now - windowStart;
          if (sinceBoundary <= 5 && chainlinkSnapshotWindow !== windowStart) {
            chainlinkSnapshotPrice = msg.payload.value;
            chainlinkSnapshotWindow = windowStart;
            console.log('[BOT] Chainlink snapshot at boundary:', chainlinkSnapshotPrice);
          }
        }
      } catch (e) {}
    });
    rtdsWs.on('error', (e) => { console.error('[BOT] RTDS error:', e.message); });
    rtdsWs.on('close', () => { console.log('[BOT] RTDS closed — reconnecting in 5s'); setTimeout(connectRTDS, 5000); });
  } catch (e) {
    console.error('[BOT] WS connect failed:', e.message);
    setTimeout(connectRTDS, 10000);
  }
}

// ═══════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════

async function tick() {
  const now = Math.floor(Date.now() / 1000);
  const windowEnd = (Math.floor(now / 300) + 1) * 300;
  const windowStart = windowEnd - 300;
  const timeLeft = windowEnd - now;

  if (state.currentWindowStart !== 0 && state.currentWindowStart !== windowStart) {
    // Save prediction if one was made (skips have predictionDirection=null so won't save here)
    if (state.predictionMade && state.predictionDirection && state.predictionPTB && state.btcPrice) {
      const predictedOver = state.predictionDirection === 'up';
      await savePrediction(state.currentWindowStart, state.predictionPTB, state.btcPrice, predictedOver);
    }
    state.priceToBeat = null; state.ptbSource = null;
    state.predictionMade = false; state.predictionDirection = null; state.predictionPTB = null;
    state.analysisDone = false; state.analysisPrice = null; state.analysisTime = null;
    state.analysisPtbDist = null; state.analysisOddsUp = null; state.analysisOddsDown = null;
    console.log(`\n[BOT] ═══ NEW WINDOW: ${new Date(windowStart * 1000).toLocaleTimeString()} ═══`);
    await publishLivePrediction({ direction: 'pending' });
  }

  state.currentWindowStart = windowStart;

  try {
    const candles = await fetchCandles('5m', 100);
    state.ta = computeTA(candles);
    if (!state.btcPrice && candles && candles.length > 0) {
      state.btcPrice = candles[candles.length - 1].close;
      state.priceSource = 'binance';
    }
  } catch (e) { console.error('[BOT] Candle/TA error:', e.message); }

  if (!state.priceToBeat) {
    try {
      const polyData = await fetchPolymarket();
      if (polyData) {
        state.upPct = polyData.upPct; state.downPct = polyData.downPct;
        if (polyData.startingPrice) { state.priceToBeat = polyData.startingPrice; state.ptbSource = 'polymarket'; console.log('[BOT] PTB from Polymarket:', state.priceToBeat); }
      }
    } catch (e) {}
    if (!state.priceToBeat) {
      try {
        const ptb = await fetchPTBFallback();
        if (ptb) { state.priceToBeat = ptb; state.ptbSource = 'binance'; console.log('[BOT] PTB from Binance fallback:', ptb); }
      } catch (e) {}
    }
  } else {
    try {
      const polyData = await fetchPolymarket();
      if (polyData) { state.upPct = polyData.upPct; state.downPct = polyData.downPct; }
    } catch (e) {}
  }

  if (!state.analysisDone && timeLeft <= 180 && timeLeft > 120 && state.priceToBeat && state.btcPrice) {
    state.analysisDone = true; state.analysisPrice = state.btcPrice;
    state.analysisTime = Date.now();
    state.analysisPtbDist = ((state.btcPrice - state.priceToBeat) / state.priceToBeat) * 100;
    state.analysisOddsUp = state.upPct ? parseFloat(state.upPct) : null;
    state.analysisOddsDown = state.downPct ? parseFloat(state.downPct) : null;
    console.log(`[BOT] ANALYSIS SNAPSHOT | BTC: $${state.btcPrice.toFixed(2)} | PTB dist: ${state.analysisPtbDist.toFixed(3)}% | Odds: ${state.upPct || '--'}/${state.downPct || '--'}`);
  }

  if (!state.predictionMade && timeLeft <= 120 && timeLeft > 0 && state.priceToBeat) {
    await makePrediction();
  }

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  console.log(`[BOT] BTC: $${state.btcPrice ? state.btcPrice.toFixed(2) : '--'} | PTB: $${state.priceToBeat ? state.priceToBeat.toFixed(2) : '--'} (${state.ptbSource || '--'}) | ${mins}:${secs < 10 ? '0' : ''}${secs} left | Pred: ${state.predictionDirection || 'pending'} | W:${state.wins} L:${state.losses} Skip:${state.skips}`);
}

async function init() {
  console.log('[BOT] ═══════════════════════════════════════');
  console.log('[BOT] VANGUARD PREDICTION BOT STARTING');
  console.log('[BOT] ═══════════════════════════════════════');
  await loadStats();
  connectRTDS();
  const now = Math.floor(Date.now() / 1000);
  state.currentWindowStart = Math.floor(now / 300) * 300;
  await tick();
  setInterval(tick, 30000);
}

init().catch(e => { console.error('[BOT] Fatal error:', e); process.exit(1); });
