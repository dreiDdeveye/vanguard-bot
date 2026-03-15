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
  predictionMade: false,
  predictionDirection: null,
  predictionPTB: null,
  // Analysis phase (captured at 3 min remaining)
  analysisDone: false,
  analysisPrice: null,       // BTC price at analysis snapshot
  analysisTime: null,        // timestamp of snapshot
  analysisPtbDist: null,     // price-vs-PTB at snapshot
  analysisOddsUp: null,      // Polymarket UP% at snapshot
  analysisOddsDown: null,    // Polymarket DOWN% at snapshot
};

// ── Keep-alive HTTP server (Render free Web Service needs a port) ──
const PORT = process.env.PORT || 3000;
createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'running',
    uptime: Math.floor(process.uptime()),
    wins: state.wins,
    losses: state.losses,
    btcPrice: state.btcPrice,
    priceToBeat: state.priceToBeat,
    prediction: state.predictionDirection,
  }));
}).listen(PORT, () => console.log(`[BOT] Health server on port ${PORT}`));

// Chainlink snapshots
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

  // RSI momentum direction
  const rsiPrev = rsi14[last - 1];
  const rsiDelta = (rsi14[last] != null && rsiPrev != null) ? rsi14[last] - rsiPrev : 0;

  // MACD histogram trend (expanding or contracting)
  const macdHistPrev = macdData.histogram[last - 1];
  const macdHistDelta = macdData.histogram[last] - macdHistPrev;

  // Short-term returns
  const ret1 = ((closes[last] - closes[last - 1]) / closes[last - 1]) * 100;
  const ret3 = last >= 3 ? ((closes[last] - closes[last - 3]) / closes[last - 3]) * 100 : 0;

  // Recent candle bodies
  let recentBullCandles = 0, recentBearCandles = 0;
  for (let i = last; i >= Math.max(0, last - 2); i--) {
    if (candles[i].close > candles[i].open) recentBullCandles++;
    else recentBearCandles++;
  }

  // EMA slope (rate of change over last 3 candles)
  const ema9Slope = last >= 3 ? ((ema9[last] - ema9[last - 3]) / ema9[last - 3]) * 100 : 0;

  // Bollinger Band position (0 = at lower, 1 = at upper)
  const bb = bbands[last];
  const bbPos = bb ? (closes[last] - bb.lower) / (bb.upper - bb.lower) : 0.5;
  const bbBandwidth = bb ? bb.bandwidth : 0;

  // ATR-based volatility
  const atrVal = atrData[last];
  const atrPct = atrVal ? (atrVal / closes[last]) * 100 : 0;

  return {
    price: closes[last],
    rsi: rsi14[last],
    rsiDelta,
    macdHist: macdData.histogram[last],
    macdHistDelta,
    macdCrossing: Math.sign(macdData.histogram[last]) !== Math.sign(macdData.histogram[last - 1]),
    emaAligned: aligned,
    ema9Slope,
    vwapDist: ((closes[last] - vwapData[last]) / vwapData[last] * 100),
    volZScore: volZ[last],
    ret1,
    ret3,
    recentBullCandles,
    recentBearCandles,
    bbPos,
    bbBandwidth,
    atrPct,
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
      time: c[0],
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      volume: parseFloat(c[5]),
    }));
  } catch (e) {
    console.error(`[BOT] Binance ${interval} error:`, e.message);
    return null;
  }
}

// ═══════════════════════════════════════════
// 1-MINUTE TIMEFRAME TA (primary decision driver)
// ═══════════════════════════════════════════
function computeTA1m(candles1m) {
  if (!candles1m || candles1m.length < 21) return null;
  const closes = candles1m.map(c => c.close);
  const highs = candles1m.map(c => c.high);
  const lows = candles1m.map(c => c.low);
  const vols = candles1m.map(c => c.volume);
  const last = candles1m.length - 1;

  // Fast EMAs for 1m timeframe
  const ema3 = ema(closes, 3);
  const ema8 = ema(closes, 8);
  const ema21 = ema(closes, 21);

  // Fast RSI (7-period on 1m = 7 minutes lookback)
  const rsi7 = rsi(closes, 7);

  // Fast MACD (5,13,4) tuned for 1-minute bars
  const emaF = ema(closes, 5);
  const emaS = ema(closes, 13);
  const macdLine = emaF.map((v, i) => v - emaS[i]);
  const macdSig = ema(macdLine, 4);
  const macdHist = macdLine.map((v, i) => v - macdSig[i]);

  // ATR on 1m for volatility normalization
  const atr1m = atr(highs, lows, closes, 10);

  // VWAP on 1m
  const vwap1m = vwap(highs, lows, closes, vols);

  // Volume analysis
  const volZ = volumeZScore(vols, 15);

  // EMA alignment on 1m
  const aligned = ema3[last] > ema8[last] && ema8[last] > ema21[last] ? 'BULL' :
                  ema3[last] < ema8[last] && ema8[last] < ema21[last] ? 'BEAR' : 'MIX';

  // Momentum deltas (direction of change)
  const rsiNow = rsi7[last];
  const rsiPrev = rsi7[last - 1];
  const rsiDelta = rsiNow != null && rsiPrev != null ? rsiNow - rsiPrev : 0;

  const histNow = macdHist[last];
  const histPrev = macdHist[last - 1];
  const histDelta = histNow - histPrev;
  const histCross = Math.sign(histNow) !== Math.sign(histPrev);

  // Returns
  const ret1 = ((closes[last] - closes[last - 1]) / closes[last - 1]) * 100;
  const ret3 = last >= 3 ? ((closes[last] - closes[last - 3]) / closes[last - 3]) * 100 : 0;
  const ret5 = last >= 5 ? ((closes[last] - closes[last - 5]) / closes[last - 5]) * 100 : 0;

  // EMA3 slope (rate of change over last 3 bars)
  const ema3Slope = last >= 3 ? ((ema3[last] - ema3[last - 3]) / ema3[last - 3]) * 100 : 0;

  // Candle body analysis — last 3 candles
  let bullCandles = 0, bearCandles = 0;
  for (let i = last; i >= Math.max(0, last - 2); i--) {
    if (candles1m[i].close > candles1m[i].open) bullCandles++;
    else bearCandles++;
  }

  // Wick rejection on the latest 1m candle
  const lc = candles1m[last];
  const lcRange = lc.high - lc.low;
  const upperWick = lcRange > 0 ? (lc.high - Math.max(lc.open, lc.close)) / lcRange : 0;
  const lowerWick = lcRange > 0 ? (Math.min(lc.open, lc.close) - lc.low) / lcRange : 0;

  // Volume in last 3 vs previous 3
  const recentVol = vols.slice(-3).reduce((a, b) => a + b, 0);
  const priorVol = vols.slice(-6, -3).reduce((a, b) => a + b, 0);
  const volRatio = priorVol > 0 ? recentVol / priorVol : 1;

  // Bollinger Bands on 1m
  const bb = bollingerBands(closes, 15, 2);
  const bbLast = bb[last];
  const bbPos = bbLast ? (closes[last] - bbLast.lower) / (bbLast.upper - bbLast.lower) : 0.5;
  const bbWidth = bbLast ? bbLast.bandwidth : 0;

  return {
    price: closes[last],
    emaAligned: aligned,
    ema3Slope,
    rsi: rsiNow,
    rsiDelta,
    macdHist: histNow,
    macdHistDelta: histDelta,
    macdCross: histCross,
    atr: atr1m[last],
    atrPct: atr1m[last] ? (atr1m[last] / closes[last]) * 100 : 0,
    vwapDist: ((closes[last] - vwap1m[last]) / vwap1m[last]) * 100,
    volZScore: volZ[last],
    volRatio,
    ret1, ret3, ret5,
    bullCandles, bearCandles,
    upperWick, lowerWick,
    bbPos, bbWidth,
  };
}

// ═══════════════════════════════════════════
// TICK-LEVEL ANALYSIS (WebSocket price buffer)
// ═══════════════════════════════════════════
function analyzeTickMomentum() {
  if (priceBuffer.length < 10) return null;

  const now = Date.now();
  // Last 60 seconds of ticks
  const recent60 = priceBuffer.filter(p => now - p.timestamp < 60000);
  // Last 30 seconds
  const recent30 = priceBuffer.filter(p => now - p.timestamp < 30000);
  // Last 10 seconds
  const recent10 = priceBuffer.filter(p => now - p.timestamp < 10000);

  if (recent60.length < 5) return null;

  const first60 = recent60[0].value;
  const last60 = recent60[recent60.length - 1].value;
  const slope60 = ((last60 - first60) / first60) * 100;

  let slope30 = 0;
  if (recent30.length >= 3) {
    slope30 = ((recent30[recent30.length - 1].value - recent30[0].value) / recent30[0].value) * 100;
  }

  let slope10 = 0;
  if (recent10.length >= 2) {
    slope10 = ((recent10[recent10.length - 1].value - recent10[0].value) / recent10[0].value) * 100;
  }

  // Acceleration: is the 10s slope stronger than the 30s slope?
  // If slope10 > slope30 in same direction = accelerating
  // If slope10 opposes slope30 = decelerating/reversing
  const accelerating = Math.sign(slope10) === Math.sign(slope30) && Math.abs(slope10) > Math.abs(slope30) * 0.5;
  const reversing = Math.sign(slope10) !== Math.sign(slope60) && Math.abs(slope10) > 0.002;

  // Tick velocity: how many ticks per second (proxy for activity)
  const tickRate = recent60.length / 60;

  return {
    slope60,
    slope30,
    slope10,
    accelerating,
    reversing,
    tickRate,
    lastPrice: last60,
  };
}

// ═══════════════════════════════════════════
// BINANCE ORDER FLOW (taker buy/sell ratio)
// ═══════════════════════════════════════════
async function fetchOrderFlow() {
  try {
    // Recent aggregated trades — last 500 trades
    const res = await fetch('https://api.binance.com/api/v3/trades?symbol=BTCUSDT&limit=500');
    if (!res.ok) return null;
    const trades = await res.json();
    if (!trades || trades.length === 0) return null;

    const cutoff = Date.now() - 120000; // last 2 minutes
    let buyVol = 0, sellVol = 0, buyCount = 0, sellCount = 0;
    for (const t of trades) {
      if (t.time < cutoff) continue;
      const qty = parseFloat(t.qty);
      if (t.isBuyerMaker) {
        // isBuyerMaker = true means the TAKER was SELLING
        sellVol += qty;
        sellCount++;
      } else {
        buyVol += qty;
        buyCount++;
      }
    }

    const totalVol = buyVol + sellVol;
    const buyRatio = totalVol > 0 ? buyVol / totalVol : 0.5;
    const delta = buyVol - sellVol; // positive = net buying pressure

    return { buyVol, sellVol, buyRatio, delta, buyCount, sellCount, totalVol };
  } catch (e) {
    return null;
  }
}

async function fetchPolymarket() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const interval = 300;
    const currentStart = Math.floor(now / interval) * interval;
    const timestamps = [currentStart, currentStart + interval, currentStart - interval];

    let bestMarket = null;
    let bestTs = 0;

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
        bestMarket = market;
        bestTs = ts;
        if (ts === currentStart) break;
      }
    }

    if (!bestMarket) return null;

    const gammaOdds = JSON.parse(bestMarket.outcomePrices || '[]');
    const upPct = (parseFloat(gammaOdds[0] || 0) * 100).toFixed(1);
    const downPct = (parseFloat(gammaOdds[1] || 0) * 100).toFixed(1);

    let startingPrice = null;
    let ptbSrc = null;
    if (bestTs === currentStart && bestMarket.startPrice) {
      startingPrice = parseFloat(bestMarket.startPrice);
      if (startingPrice > 0) {
        ptbSrc = 'polymarket';
      } else {
        startingPrice = null;
      }
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

  // Chainlink snapshot
  if (chainlinkSnapshotPrice && chainlinkSnapshotWindow === windowStart) {
    return chainlinkSnapshotPrice;
  }

  // Binance 1m candle at window start
  try {
    const startMs = windowStart * 1000;
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=' + startMs + '&limit=1');
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) return parseFloat(data[0][1]);
    }
  } catch (e) {}

  // Binance 5m candle open
  try {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1');
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) return parseFloat(data[0][1]);
    }
  } catch (e) {}

  return null;
}

// ═══════════════════════════════════════════
// SUPABASE
// ═══════════════════════════════════════════

// Push live prediction to Supabase so the website can display it
async function publishLivePrediction({ direction, ptb, btcPrice, confidence, confPct, bullScore, bearScore, signalsText }) {
  const row = {
    id: 1,
    direction: direction || 'pending',
    ptb: ptb || null,
    btc_price: btcPrice || null,
    confidence: confidence || null,
    conf_pct: confPct || null,
    bull_score: bullScore || 0,
    bear_score: bearScore || 0,
    signals: signalsText || '',
    updated_at: new Date().toISOString(),
  };

  try {
    // Upsert: update row with id=1 if it exists, insert if not
    const url = SUPABASE_URL + '/rest/v1/live_prediction';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...SB_HEADERS,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[BOT] Live prediction publish error:', res.status, text);
    } else {
      console.log(`[BOT] Live prediction published: ${direction}`);
    }
  } catch (e) {
    console.error('[BOT] Live prediction exception:', e.message);
  }
}

async function savePrediction(windowStart, ptb, endPrice, predictedOver) {
  const actualOver = endPrice > ptb;
  const correct = predictedOver === actualOver;

  const row = {
    ts: windowStart,
    ptb: ptb,
    end_price: endPrice,
    over: correct,
    source: 'vanguard-bot',
  };

  try {
    // Upsert: unique(ts, source) prevents duplicates
    const url = SUPABASE_URL + '/rest/v1/predictions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...SB_HEADERS,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const text = await res.text();
      // 409 = duplicate, which is fine (already saved)
      if (res.status === 409) {
        console.log('[BOT] Already saved for window', windowStart);
        return;
      }
      console.error('[BOT] Save error:', res.status, text);
    } else {
      const result = correct ? 'WIN' : 'LOSS';
      if (correct) state.wins++; else state.losses++;
      const total = state.wins + state.losses;
      const wr = total > 0 ? ((state.wins / total) * 100).toFixed(1) : '0';
      console.log(`[BOT] ${result} | Predicted ${predictedOver ? 'UP' : 'DOWN'} | PTB $${ptb.toFixed(2)} → End $${endPrice.toFixed(2)} | W:${state.wins} L:${state.losses} WR:${wr}%`);
      try {
        await savePredictionStats(state.wins, state.losses);
      } catch (e) {
        console.error('[BOT] Save stats after prediction error:', e.message || e);
      }
    }
  } catch (e) {
    console.error('[BOT] Save exception:', e.message);
  }
}

async function loadStats() {
  try {
    const url = SUPABASE_URL + '/rest/v1/predictions?select=ts,over&source=eq.vanguard-bot&order=ts.desc&limit=1000';
    const res = await fetch(url, { headers: SB_HEADERS });
    if (!res.ok) return;
    const data = await res.json();
    // Deduplicate by timestamp — only count first entry per window
    const seen = {};
    let w = 0, l = 0;
    for (const pOrig of data) {
      // Normalize 'over' which may arrive as 'true'/'false' strings
      const p = Object.assign({}, pOrig, { ts: Number(pOrig.ts) });
      if (seen[p.ts]) continue;
      seen[p.ts] = true;
      const overRaw = pOrig.over;
      const over = (overRaw === true || overRaw === 'true' || overRaw === 't' || overRaw === 1 || overRaw === '1');
      if (over) w++;
      else l++;
    }
    state.wins = w;
    state.losses = l;
    console.log(`[BOT] Loaded stats (deduped): ${w}W / ${l}L (${data.length} rows, ${Object.keys(seen).length} unique)`);
      // Persist aggregated stats to prediction_stats table (id=1)
      try {
        await savePredictionStats(state.wins, state.losses);
      } catch (e) {
        console.error('[BOT] Persist stats error:', e.message || e);
      }
  } catch (e) {
    console.error('[BOT] Load stats error:', e.message);
  }
}

async function savePredictionStats(wins, losses) {
  try {
    const total = (wins || 0) + (losses || 0);
    const win_rate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0; // one decimal percent
    const payload = { wins: wins || 0, losses: losses || 0, win_rate: win_rate, updated_at: new Date().toISOString() };

    const url = SUPABASE_URL + '/rest/v1/prediction_stats?id=eq.1';
    const res = await fetch(url, {
      method: 'PATCH',
      headers: SB_HEADERS,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Try insert if patch failed (record may not exist)
      const text = await res.text();
      console.warn('[BOT] Save stats PATCH failed:', res.status, text);
      const createUrl = SUPABASE_URL + '/rest/v1/prediction_stats';
      const res2 = await fetch(createUrl, {
        method: 'POST',
        headers: SB_HEADERS,
        body: JSON.stringify([{ id: 1, ...payload }]),
      });
      if (!res2.ok) {
        const t2 = await res2.text();
        throw new Error('Create stats failed: ' + res2.status + ' ' + t2);
      }
    }
    return true;
  } catch (e) {
    throw e;
  }
}

// ═══════════════════════════════════════════
// PREDICTION ENGINE (mirrors agent.js)
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
  let bullScore = 0;
  let bearScore = 0;

  const diff = price - ptb;
  const pctDiff = (diff / ptb) * 100;
  const absPct = Math.abs(pctDiff);

  // ═══════════════════════════════════════════
  // SIGNAL 1: PRICE vs PTB — THE dominant signal (weight up to 5)
  // At 2 min remaining, price persistence is ~85%+
  // ═══════════════════════════════════════════
  if (absPct > 0.1) {
    const w = 5;
    if (diff > 0) { bullScore += w; signals.push(`PTB +${pctDiff.toFixed(3)}% SAFE`); }
    else { bearScore += w; signals.push(`PTB ${pctDiff.toFixed(3)}% SAFE`); }
  } else if (absPct > 0.03) {
    const w = 3;
    if (diff > 0) { bullScore += w; signals.push(`PTB +${pctDiff.toFixed(3)}%`); }
    else { bearScore += w; signals.push(`PTB ${pctDiff.toFixed(3)}%`); }
  } else if (absPct > 0.01) {
    if (diff > 0) { bullScore += 1; signals.push(`PTB +${pctDiff.toFixed(3)}% THIN`); }
    else { bearScore += 1; signals.push(`PTB ${pctDiff.toFixed(3)}% THIN`); }
  } else {
    signals.push(`PTB ${pctDiff.toFixed(4)}% FLAT`);
  }

  // ═══════════════════════════════════════════
  // SIGNAL 2: POLYMARKET ODDS — the market's prediction (weight up to 3)
  // ═══════════════════════════════════════════
  if (state.upPct && state.downPct) {
    const up = parseFloat(state.upPct);
    const down = parseFloat(state.downPct);
    if (up > 65) { bullScore += 3; signals.push(`MKT UP ${up}%`); }
    else if (down > 65) { bearScore += 3; signals.push(`MKT DOWN ${down}%`); }
    else if (up > 55) { bullScore += 1.5; signals.push(`MKT LEAN UP ${up}%`); }
    else if (down > 55) { bearScore += 1.5; signals.push(`MKT LEAN DOWN ${down}%`); }
    else { signals.push(`MKT SPLIT ${up}/${down}`); }
  }

  // ═══════════════════════════════════════════
  // SIGNAL 3: WINDOW TRAJECTORY — price movement from 3min→2min mark (weight up to 3)
  // This is the key insight: we observed 1 minute of real-time movement
  // within THIS window. The trajectory tells us where price is heading.
  // ═══════════════════════════════════════════
  if (state.analysisDone && state.analysisPrice) {
    const trajDiff = price - state.analysisPrice;
    const trajPct = (trajDiff / state.analysisPrice) * 100;
    const abovePTB = diff > 0;

    if (Math.abs(trajPct) > 0.01) {
      const movingUp = trajDiff > 0;

      if (abovePTB && movingUp) {
        // Above PTB and still rising — very safe UP
        bullScore += 3;
        signals.push(`TRAJ↑↑ +${trajPct.toFixed(3)}% AWAY`);
      } else if (!abovePTB && !movingUp) {
        // Below PTB and still falling — very safe DOWN
        bearScore += 3;
        signals.push(`TRAJ↓↓ ${trajPct.toFixed(3)}% AWAY`);
      } else if (abovePTB && !movingUp) {
        // Above PTB but dropping toward it — risky, weakens UP
        bearScore += 2;
        signals.push(`TRAJ↓ ${trajPct.toFixed(3)}% CLOSING`);
      } else if (!abovePTB && movingUp) {
        // Below PTB but rising toward it — risky, weakens DOWN
        bullScore += 2;
        signals.push(`TRAJ↑ +${trajPct.toFixed(3)}% CLOSING`);
      }
    } else {
      signals.push(`TRAJ FLAT ${trajPct.toFixed(4)}%`);
    }

    // Odds shift: did market sentiment change between analysis and now?
    if (state.analysisOddsUp != null && state.upPct) {
      const oddsShift = parseFloat(state.upPct) - state.analysisOddsUp;
      if (oddsShift > 3) { bullScore += 1; signals.push(`ODDS SHIFT↑ +${oddsShift.toFixed(1)}`); }
      else if (oddsShift < -3) { bearScore += 1; signals.push(`ODDS SHIFT↓ ${oddsShift.toFixed(1)}`); }
    }
  }

  // ═══════════════════════════════════════════
  // SIGNAL 4: RECENT MOMENTUM — last 3 1m candles (weight up to 1.5)
  // ═══════════════════════════════════════════
  try {
    const candles1m = await fetchCandles('1m', 5);
    if (candles1m && candles1m.length >= 3) {
      const recent = candles1m.slice(-3);
      const momChange = recent[recent.length - 1].close - recent[0].open;
      const momPct = (momChange / recent[0].open) * 100;

      if (momPct > 0.03) { bullScore += 1.5; signals.push(`MOM↑ +${momPct.toFixed(3)}%`); }
      else if (momPct < -0.03) { bearScore += 1.5; signals.push(`MOM↓ ${momPct.toFixed(3)}%`); }
      else if (momPct > 0.01) { bullScore += 0.5; signals.push(`MOM↑ +${momPct.toFixed(3)}%`); }
      else if (momPct < -0.01) { bearScore += 0.5; signals.push(`MOM↓ ${momPct.toFixed(3)}%`); }
    }
  } catch (e) {}

  // ═══════════════════════════════════════════
  // DECISION
  // ═══════════════════════════════════════════
  let isUp;
  if (bullScore === bearScore) {
    isUp = diff >= 0;
    signals.push('TIE→PRICE');
  } else {
    isUp = bullScore > bearScore;
  }

  const margin = Math.abs(bullScore - bearScore);
  const totalScore = bullScore + bearScore;
  const confPct = totalScore > 0 ? (Math.max(bullScore, bearScore) / totalScore * 100) : 50;
  const confLabel = margin >= 4 ? 'HIGH' : margin >= 2 ? 'MED' : 'LOW';

  // Only skip TRUE coin flips: price AT PTB AND no signal edge
  if (absPct < 0.005 && margin < 0.5) {
    console.log(`[BOT] SKIP — Coin flip (PTB diff: ${pctDiff.toFixed(4)}%, margin: ${margin.toFixed(1)})`);
    state.predictionDirection = null;
    state.predictionMade = true;
    await publishLivePrediction({ direction: 'pending', ptb, btcPrice: price, confidence: 'LOW', confPct: 50, bullScore, bearScore, signalsText: `SKIP — Coin flip · ${signals.join(' · ')}` });
    return;
  }

  state.predictionDirection = isUp ? 'up' : 'down';
  state.predictionPTB = ptb;
  state.predictionMade = true;

  console.log(`[BOT] PREDICTION: ${isUp ? 'UP' : 'DOWN'} | ${confLabel} ${confPct.toFixed(0)}% | Bull:${bullScore.toFixed(1)} Bear:${bearScore.toFixed(1)} | PTB:${pctDiff.toFixed(3)}%`);
  console.log(`[BOT] Signals: ${signals.join(' · ')}`);

  await publishLivePrediction({
    direction: isUp ? 'up' : 'down', ptb, btcPrice: price, confidence: confLabel, confPct, bullScore, bearScore,
    signalsText: signals.join(' · '),
  });
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
      rtdsWs.send(JSON.stringify({
        action: 'subscribe',
        subscriptions: [{
          topic: 'crypto_prices_chainlink',
          type: '*',
          filters: '{"symbol":"btc/usd"}'
        }]
      }));
    });

    rtdsWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // History dump
        if (msg.payload && msg.payload.data && Array.isArray(msg.payload.data)) {
          const history = msg.payload.data;
          if (history.length > 0) {
            const latest = history[history.length - 1];
            state.btcPrice = latest.value;
            state.priceSource = 'chainlink';
          }
          return;
        }

        // Streaming updates
        if (msg.topic === 'crypto_prices_chainlink' && msg.payload && msg.payload.value) {
          state.btcPrice = msg.payload.value;
          state.priceSource = 'chainlink';

          // Store in buffer
          priceBuffer.push({ timestamp: msg.payload.timestamp || Date.now(), value: msg.payload.value });
          if (priceBuffer.length > 600) priceBuffer.shift();

          // Snapshot at window boundary for PTB
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

    rtdsWs.on('error', (e) => {
      console.error('[BOT] RTDS error:', e.message);
    });

    rtdsWs.on('close', () => {
      console.log('[BOT] RTDS closed — reconnecting in 5s');
      setTimeout(connectRTDS, 5000);
    });
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

  // ── New window detected — save previous prediction ──
  if (state.currentWindowStart !== 0 && state.currentWindowStart !== windowStart) {
    if (state.predictionMade && state.predictionDirection && state.predictionPTB && state.btcPrice) {
      const predictedOver = state.predictionDirection === 'up';
      await savePrediction(state.currentWindowStart, state.predictionPTB, state.btcPrice, predictedOver);
    }

    // Reset for new window
    state.priceToBeat = null;
    state.ptbSource = null;
    state.predictionMade = false;
    state.predictionDirection = null;
    state.predictionPTB = null;
    state.analysisDone = false;
    state.analysisPrice = null;
    state.analysisTime = null;
    state.analysisPtbDist = null;
    state.analysisOddsUp = null;
    state.analysisOddsDown = null;
    console.log(`\n[BOT] ═══ NEW WINDOW: ${new Date(windowStart * 1000).toLocaleTimeString()} ═══`);

    // Reset live prediction on website
    await publishLivePrediction({ direction: 'pending' });
  }

  state.currentWindowStart = windowStart;

  // ── Fetch data (5m candles for TA) ──
  try {
    const candles = await fetchCandles('5m', 100);
    state.ta = computeTA(candles);

    // Use candle close if no WS price
    if (!state.btcPrice && candles && candles.length > 0) {
      state.btcPrice = candles[candles.length - 1].close;
      state.priceSource = 'binance';
    }
  } catch (e) {
    console.error('[BOT] Candle/TA error:', e.message);
  }

  // ── PTB: Polymarket first, then fallback ──
  if (!state.priceToBeat) {
    try {
      const polyData = await fetchPolymarket();
      if (polyData) {
        state.upPct = polyData.upPct;
        state.downPct = polyData.downPct;
        if (polyData.startingPrice) {
          state.priceToBeat = polyData.startingPrice;
          state.ptbSource = 'polymarket';
          console.log('[BOT] PTB from Polymarket:', state.priceToBeat);
        }
      }
    } catch (e) {}

    if (!state.priceToBeat) {
      try {
        const ptb = await fetchPTBFallback();
        if (ptb) {
          state.priceToBeat = ptb;
          state.ptbSource = 'binance';
          console.log('[BOT] PTB from Binance fallback:', ptb);
        }
      } catch (e) {}
    }
  } else {
    // Still fetch Polymarket for odds even if PTB is set
    try {
      const polyData = await fetchPolymarket();
      if (polyData) {
        state.upPct = polyData.upPct;
        state.downPct = polyData.downPct;
      }
    } catch (e) {}
  }

  // ── Phase 1: Analyze at ~3 min remaining (2 min into window) ──
  if (!state.analysisDone && timeLeft <= 180 && timeLeft > 120 && state.priceToBeat && state.btcPrice) {
    state.analysisDone = true;
    state.analysisPrice = state.btcPrice;
    state.analysisTime = Date.now();
    state.analysisPtbDist = ((state.btcPrice - state.priceToBeat) / state.priceToBeat) * 100;
    state.analysisOddsUp = state.upPct ? parseFloat(state.upPct) : null;
    state.analysisOddsDown = state.downPct ? parseFloat(state.downPct) : null;
    console.log(`[BOT] ANALYSIS SNAPSHOT | BTC: $${state.btcPrice.toFixed(2)} | PTB dist: ${state.analysisPtbDist.toFixed(3)}% | Odds: ${state.upPct || '--'}/${state.downPct || '--'}`);
  }

  // ── Phase 2: Place vote at ~2 min remaining (3 min into window) ──
  if (!state.predictionMade && timeLeft <= 120 && timeLeft > 0 && state.priceToBeat) {
    await makePrediction();
  }

  // ── Status log every tick ──
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  console.log(`[BOT] BTC: $${state.btcPrice ? state.btcPrice.toFixed(2) : '--'} | PTB: $${state.priceToBeat ? state.priceToBeat.toFixed(2) : '--'} (${state.ptbSource || '--'}) | ${mins}:${secs < 10 ? '0' : ''}${secs} left | Pred: ${state.predictionDirection || 'pending'}`);
}

// ── Init ──
async function init() {
  console.log('[BOT] ═══════════════════════════════════════');
  console.log('[BOT] VANGUARD PREDICTION BOT STARTING');
  console.log('[BOT] ═══════════════════════════════════════');

  // Load existing stats
  await loadStats();

  // Connect WebSocket for live price
  connectRTDS();

  // Set current window
  const now = Math.floor(Date.now() / 1000);
  state.currentWindowStart = Math.floor(now / 300) * 300;

  // Run tick every 30 seconds
  await tick();
  setInterval(tick, 30000);
}

init().catch(e => {
  console.error('[BOT] Fatal error:', e);
  process.exit(1);
});
