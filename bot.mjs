// ═══════════════════════════════════════════════════════════════
// VANGUARD PREDICTION BOT — Background worker (runs 24/7)
// Mirrors agent.js prediction logic, saves to Supabase
// Deploy on Render as a Background Worker
// ═══════════════════════════════════════════════════════════════

import WebSocket from 'ws';

// ── Config ──
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hejzmirkxgecykdgcobe.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlanptaXJreGdlY3lrZGdjb2JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzA2ODcsImV4cCI6MjA4NjgwNjY4N30.-OSqKS3kCeOttOsVCwUhFfb7IeuAZppVQ7bLcZLTqfg';
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
};

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

  const aligned = ema9[last] > ema21[last] && ema21[last] > ema50[last] ? 'BULLISH' :
                  ema9[last] < ema21[last] && ema21[last] < ema50[last] ? 'BEARISH' : 'MIXED';

  return {
    price: closes[last],
    rsi: rsi14[last],
    macdHist: macdData.histogram[last],
    macdCrossing: Math.sign(macdData.histogram[last]) !== Math.sign(macdData.histogram[last - 1]),
    emaAligned: aligned,
    vwapDist: ((closes[last] - vwapData[last]) / vwapData[last] * 100),
    volZScore: volZ[last],
  };
}

// ═══════════════════════════════════════════
// DATA FETCHING
// ═══════════════════════════════════════════

async function fetchCandles() {
  try {
    const url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=100';
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
    console.error('[BOT] Binance error:', e.message);
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
    const url = SUPABASE_URL + '/rest/v1/predictions';
    const res = await fetch(url, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[BOT] Save error:', res.status, text);
    } else {
      const result = correct ? 'WIN' : 'LOSS';
      if (correct) state.wins++; else state.losses++;
      const total = state.wins + state.losses;
      const wr = total > 0 ? ((state.wins / total) * 100).toFixed(1) : '0';
      console.log(`[BOT] ${result} | Predicted ${predictedOver ? 'OVER' : 'UNDER'} | PTB $${ptb.toFixed(2)} → End $${endPrice.toFixed(2)} | W:${state.wins} L:${state.losses} WR:${wr}%`);
    }
  } catch (e) {
    console.error('[BOT] Save exception:', e.message);
  }
}

async function loadStats() {
  try {
    const url = SUPABASE_URL + '/rest/v1/predictions?select=over&source=eq.vanguard-bot&order=ts.desc&limit=1000';
    const res = await fetch(url, { headers: SB_HEADERS });
    if (!res.ok) return;
    const data = await res.json();
    let w = 0, l = 0;
    for (const p of data) {
      if (p.over === true) w++;
      else if (p.over === false) l++;
    }
    state.wins = w;
    state.losses = l;
    console.log(`[BOT] Loaded stats: ${w}W / ${l}L`);
  } catch (e) {
    console.error('[BOT] Load stats error:', e.message);
  }
}

// ═══════════════════════════════════════════
// PREDICTION ENGINE (mirrors agent.js)
// ═══════════════════════════════════════════

function makePrediction() {
  let bullScore = 0;
  let bearScore = 0;

  // 1. Price momentum vs PTB
  if (state.btcPrice && state.priceToBeat) {
    const diff = state.btcPrice - state.priceToBeat;
    const pctDiff = (diff / state.priceToBeat) * 100;
    if (diff > 0) bullScore += Math.min(pctDiff * 10, 3);
    else bearScore += Math.min(Math.abs(pctDiff) * 10, 3);
  }

  // 2. RSI
  if (state.ta && state.ta.rsi != null) {
    if (state.ta.rsi > 65) bearScore += 1.5;
    else if (state.ta.rsi < 35) bullScore += 1.5;
    else if (state.ta.rsi > 50) bullScore += 0.5;
    else bearScore += 0.5;
  }

  // 3. MACD
  if (state.ta && state.ta.macdHist != null) {
    if (state.ta.macdHist > 0) bullScore += 1;
    else bearScore += 1;
    if (state.ta.macdCrossing) {
      if (state.ta.macdHist > 0) bullScore += 1;
      else bearScore += 1;
    }
  }

  // 4. EMA alignment
  if (state.ta && state.ta.emaAligned) {
    if (state.ta.emaAligned === 'BULLISH') bullScore += 1.5;
    else if (state.ta.emaAligned === 'BEARISH') bearScore += 1.5;
  }

  // 5. VWAP
  if (state.ta && state.ta.vwapDist != null) {
    if (state.ta.vwapDist > 0.05) bullScore += 0.5;
    else if (state.ta.vwapDist < -0.05) bearScore += 0.5;
  }

  // 6. Volume
  if (state.ta && state.ta.volZScore != null && state.ta.volZScore > 1.5) {
    if (state.btcPrice > state.priceToBeat) bullScore += 1;
    else bearScore += 1;
  }

  // 7. Market odds
  if (state.upPct && state.downPct) {
    const up = parseFloat(state.upPct);
    const down = parseFloat(state.downPct);
    if (up > 55) bullScore += 1;
    else if (down > 55) bearScore += 1;
  }

  const isOver = bullScore >= bearScore;
  const totalScore = bullScore + bearScore;
  const confPct = totalScore > 0 ? (Math.max(bullScore, bearScore) / totalScore * 100) : 50;
  const margin = Math.abs(bullScore - bearScore);
  const confLabel = margin >= 3 ? 'HIGH' : margin >= 1 ? 'MED' : 'LOW';

  state.predictionDirection = isOver ? 'over' : 'under';
  state.predictionPTB = state.priceToBeat;
  state.predictionMade = true;

  console.log(`[BOT] PREDICTION: ${isOver ? 'OVER' : 'UNDER'} | Conf: ${confLabel} ${confPct.toFixed(0)}% | Bull: ${bullScore.toFixed(1)} Bear: ${bearScore.toFixed(1)}`);
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
      const predictedOver = state.predictionDirection === 'over';
      await savePrediction(state.currentWindowStart, state.predictionPTB, state.btcPrice, predictedOver);
    }

    // Reset for new window
    state.priceToBeat = null;
    state.ptbSource = null;
    state.predictionMade = false;
    state.predictionDirection = null;
    state.predictionPTB = null;
    console.log(`\n[BOT] ═══ NEW WINDOW: ${new Date(windowStart * 1000).toLocaleTimeString()} ═══`);
  }

  state.currentWindowStart = windowStart;

  // ── Fetch data ──
  try {
    const candles = await fetchCandles();
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

  // ── Make prediction at ~2 min remaining ──
  if (!state.predictionMade && timeLeft <= 120 && timeLeft > 0 && state.priceToBeat) {
    makePrediction();
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
