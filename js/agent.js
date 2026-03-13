// ═══════════════════════════════════════════════════════════════
// VANGUARD AGENT — Browser-side live BTC prediction dashboard
// Connects to Polymarket RTDS, Binance, and Supabase
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Supabase config — direct REST API (no client SDK needed) ──
  const SUPABASE_URL = 'https://hejzmirkxgecykdgcobe.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlanptaXJreGdlY3lrZGdjb2JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzA2ODcsImV4cCI6MjA4NjgwNjY4N30.-OSqKS3kCeOttOsVCwUhFfb7IeuAZppVQ7bLcZLTqfg';
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
    currentWindowStart: 0,
    upPct: null,
    downPct: null,
    timeLeft: 0,
    wins: 0,
    losses: 0,
    ta: null,
    history: [],
    connected: false,
  };

  // ── DOM refs ──
  const $ = (id) => document.getElementById(id);
  const els = {
    statusDot: $('agentStatusDot'),
    statusText: $('agentStatusText'),
    btcPrice: $('agentBtcPrice'),
    priceSource: $('agentPriceSource'),
    priceChange: $('agentPriceChange'),
    countdown: $('agentCountdown'),
    ptb: $('agentPtb'),
    call: $('agentCall'),
    callText: $('agentCallText'),
    oddsOver: $('agentOddsOver'),
    oddsUnder: $('agentOddsUnder'),
    oddsOverPct: $('agentOddsOverPct'),
    oddsUnderPct: $('agentOddsUnderPct'),
    wins: $('agentWins'),
    losses: $('agentLosses'),
    winRate: $('agentWinRate'),
    total: $('agentTotal'),
    rsi: $('agentRsi'),
    macd: $('agentMacd'),
    ema: $('agentEma'),
    vwap: $('agentVwap'),
    vol: $('agentVol'),
    historyList: $('agentHistoryList'),
    accuracy: $('agentAccuracy'),
    precision: $('agentPrecision'),
    f1: $('agentF1'),
    rocAuc: $('agentRocAuc'),
    tp: $('agentTP'),
    tn: $('agentTN'),
    fp: $('agentFP'),
    fn: $('agentFN'),
    recall: $('agentRecall'),
    finalPred: $('agentFinalPred'),
    finalIcon: $('agentFinalIcon'),
    finalConf: $('agentFinalConf'),
    finalCall: $('agentFinalCall'),
    finalStatus: $('agentFinalStatus'),
    finalPrice: $('agentFinalPrice'),
    finalSignals: $('agentFinalSignals'),
  };

  let finalPredLocked = false;
  let finalPredWindow = 0;
  let finalPredDirection = null;
  let finalPredPTB = null;

  // Chainlink price snapshots for PTB — capture at window boundaries
  let chainlinkSnapshotPrice = null;
  let chainlinkSnapshotWindow = 0;

  // ═══════════════════════════════════════════
  // TA INDICATOR CALCULATIONS
  // ═══════════════════════════════════════════

  function ema(data, period) {
    const k = 2 / (period + 1);
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  }

  function rsi(closes, period) {
    period = period || 14;
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

  function volumeZScore(volumes, period) {
    period = period || 20;
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
      console.error('[AGENT] Binance error:', e.message);
      return null;
    }
  }

  // CORS proxies to try (Polymarket blocks browser requests)
  const CORS_PROXIES = [
    function(u) { return 'https://corsproxy.io/?' + encodeURIComponent(u); },
    function(u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
  ];

  // Fetch with timeout (prevents hanging)
  function fetchWithTimeout(url, ms) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, ms);
    return fetch(url, { signal: controller.signal }).finally(function() { clearTimeout(timer); });
  }

  async function fetchWithProxy(targetUrl) {
    for (const proxy of CORS_PROXIES) {
      try {
        const res = await fetchWithTimeout(proxy(targetUrl), 8000);
        if (res.ok) return await res.json();
      } catch (e) { /* try next proxy */ }
    }
    return null;
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
        const targetUrl = 'https://gamma-api.polymarket.com/markets?slug=' + slug;
        const data = await fetchWithProxy(targetUrl);
        if (!data || data.length === 0) continue;

        const market = data[0];
        if (market.closed && !market.acceptingOrders) continue;

        // Prefer the current window's market
        if (!bestMarket || ts === currentStart) {
          bestMarket = market;
          bestTs = ts;
          if (ts === currentStart) break; // found current window, stop
        }
      }

      if (!bestMarket) return null;

      const gammaOdds = JSON.parse(bestMarket.outcomePrices || '[]');
      const upPct = (parseFloat(gammaOdds[0] || 0) * 100).toFixed(1);
      const downPct = (parseFloat(gammaOdds[1] || 0) * 100).toFixed(1);

      // PTB: ONLY use startPrice from the CURRENT window's market
      let startingPrice = null;
      let ptbSrc = null;
      if (bestTs === currentStart && bestMarket.startPrice) {
        startingPrice = parseFloat(bestMarket.startPrice);
        if (startingPrice > 0) {
          ptbSrc = 'polymarket';
          // Persist so page refresh keeps the same PTB
          try { sessionStorage.setItem('vg_ptb_' + currentStart, startingPrice.toString()); } catch(e) {}
          console.log('[AGENT] PTB from Polymarket (authoritative):', startingPrice);
        } else {
          startingPrice = null;
        }
      }

      // If we didn't get PTB from Polymarket, check sessionStorage
      if (!startingPrice) {
        try {
          var saved = sessionStorage.getItem('vg_ptb_' + currentStart);
          if (saved) {
            startingPrice = parseFloat(saved);
            ptbSrc = 'polymarket-cached';
            console.log('[AGENT] PTB from session cache:', startingPrice);
          }
        } catch(e) {}
      }

      const timeLeft = Math.max(0, (bestTs + interval) - now);

      return {
        slug: 'btc-updown-5m-' + bestTs,
        startingPrice,
        ptbSource: ptbSrc,
        upPct,
        downPct,
        timeLeft,
        startTimestamp: bestTs,
        endTimestamp: bestTs + interval,
      };
    } catch (e) {
      console.error('[AGENT] Polymarket error:', e.message);
    }
    return null;
  }

  // ── Supabase REST: fetch history ──
  async function fetchHistory() {
    try {
      const url = SUPABASE_URL + '/rest/v1/predictions?select=*&order=ts.desc&limit=1000';
      const res = await fetch(url, { headers: SB_HEADERS });
      if (!res.ok) {
        console.error('[AGENT] History fetch failed:', res.status, res.statusText);
        return [];
      }
      const data = await res.json();
      if (data && data.length > 0) {
        console.log('[AGENT] Loaded ' + data.length + ' predictions from Supabase');
      } else {
        console.warn('[AGENT] No predictions in Supabase');
      }
      return data || [];
    } catch (e) {
      console.error('[AGENT] History error:', e.message);
      return [];
    }
  }

  // ── Supabase REST: fetch stats ──
  async function fetchStats() {
    try {
      const url = SUPABASE_URL + '/rest/v1/prediction_stats?select=*&limit=1';
      const res = await fetch(url, { headers: SB_HEADERS });
      if (!res.ok) {
        console.warn('[AGENT] Stats fetch failed:', res.status);
        return null;
      }
      const data = await res.json();
      if (data && data.length > 0) {
        console.log('[AGENT] Stats from Supabase:', JSON.stringify(data[0]));
        return data[0];
      }
    } catch (e) {
      console.error('[AGENT] Stats error:', e.message);
    }
    return null;
  }

  // ── Supabase REST: save prediction ──
  async function savePrediction(windowStart, ptb, endPrice, predictedOver) {
    const actualOver = endPrice > ptb;
    const correct = predictedOver === actualOver;

    const row = {
      ts: windowStart,
      ptb: ptb,
      end_price: endPrice,
      over: correct,
      source: 'vanguard',
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
        console.error('[AGENT] Save prediction error:', res.status, text);
      } else {
        console.log('[AGENT] Prediction saved:', JSON.stringify(row));
      }
    } catch (e) {
      console.error('[AGENT] Save prediction exception:', e.message);
    }
  }

  // ── PTB fallback chain (when Polymarket startPrice unavailable) ──
  // Priority: Chainlink snapshot > Binance 1m candle at exact window start > Binance 5m candle open
  async function fetchPTBFallback() {
    var now = Math.floor(Date.now() / 1000);
    var windowStart = Math.floor(now / 300) * 300;

    // Method 1: Chainlink snapshot captured at window boundary (same oracle Polymarket uses)
    if (chainlinkSnapshotPrice && chainlinkSnapshotWindow === windowStart) {
      console.log('[AGENT] PTB from Chainlink snapshot:', chainlinkSnapshotPrice);
      return chainlinkSnapshotPrice;
    }

    // Method 2: Binance 1m candle at exact window start (precise)
    try {
      var startMs = windowStart * 1000;
      var res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=' + startMs + '&limit=1');
      if (res.ok) {
        var data = await res.json();
        if (data && data.length > 0) {
          var openPrice = parseFloat(data[0][1]);
          console.log('[AGENT] PTB from Binance 1m candle at', new Date(startMs).toLocaleTimeString(), ':', openPrice);
          return openPrice;
        }
      }
    } catch (e) {
      console.error('[AGENT] Binance 1m PTB error:', e.message);
    }

    // Method 3: Binance current 5m candle open (last resort)
    try {
      var res2 = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=1');
      if (res2.ok) {
        var data2 = await res2.json();
        if (data2 && data2.length > 0) {
          var openPrice2 = parseFloat(data2[0][1]);
          console.log('[AGENT] PTB from Binance 5m candle open:', openPrice2);
          return openPrice2;
        }
      }
    } catch (e) {
      console.error('[AGENT] Binance 5m PTB error:', e.message);
    }

    return null;
  }

  // ── Compute track record from history ──
  function computeTrackRecord(predictions) {
    let wins = 0, losses = 0;
    for (const p of predictions) {
      if (p.ptb == null || p.end_price == null || p.over == null) continue;
      if (p.over) wins++;
      else losses++;
    }
    return { wins, losses };
  }

  // ═══════════════════════════════════════════
  // WEBSOCKET — Live BTC price from Polymarket
  // ═══════════════════════════════════════════

  let rtdsWs = null;
  let rtdsReconnectTimer = null;

  function connectRTDS() {
    if (rtdsWs && rtdsWs.readyState <= 1) return;

    try {
      rtdsWs = new WebSocket('wss://ws-live-data.polymarket.com');

      rtdsWs.onopen = function () {
        console.log('[AGENT] RTDS connected');
        setStatus('connected', 'LIVE');

        rtdsWs.send(JSON.stringify({
          action: 'subscribe',
          subscriptions: [{
            topic: 'crypto_prices_chainlink',
            type: '*',
            filters: '{"symbol":"btc/usd"}'
          }]
        }));
      };

      rtdsWs.onmessage = function (event) {
        try {
          const msg = JSON.parse(event.data);

          // Handle history dump
          if (msg.payload && msg.payload.data && Array.isArray(msg.payload.data)) {
            const history = msg.payload.data;
            if (history.length > 0) {
              const latest = history[history.length - 1];
              state.btcPrice = latest.value;
              state.priceSource = 'chainlink';
              state.connected = true;
              updatePriceUI();
            }
            return;
          }

          // Handle streaming updates
          if (msg.topic === 'crypto_prices_chainlink' && msg.payload && msg.payload.value) {
            state.btcPrice = msg.payload.value;
            state.priceSource = 'chainlink';
            state.connected = true;

            // Snapshot Chainlink price at window boundary for accurate PTB
            var now = Math.floor(Date.now() / 1000);
            var windowStart = Math.floor(now / 300) * 300;
            var sinceBoundary = now - windowStart;
            if (sinceBoundary <= 5 && chainlinkSnapshotWindow !== windowStart) {
              chainlinkSnapshotPrice = msg.payload.value;
              chainlinkSnapshotWindow = windowStart;
              console.log('[AGENT] Chainlink PTB snapshot at boundary:', chainlinkSnapshotPrice);
            }
            updatePriceUI();
          }
        } catch (e) { /* ignore parse errors */ }
      };

      rtdsWs.onerror = function () {
        console.log('[AGENT] RTDS error — will retry');
        setStatus('error', 'ERROR');
      };

      rtdsWs.onclose = function () {
        console.log('[AGENT] RTDS closed — reconnecting in 5s');
        setStatus('reconnecting', 'RECONNECTING...');
        state.connected = false;
        clearTimeout(rtdsReconnectTimer);
        rtdsReconnectTimer = setTimeout(connectRTDS, 5000);
      };
    } catch (e) {
      console.error('[AGENT] WS connect failed:', e.message);
      setStatus('error', 'OFFLINE');
      clearTimeout(rtdsReconnectTimer);
      rtdsReconnectTimer = setTimeout(connectRTDS, 10000);
    }
  }

  // ═══════════════════════════════════════════
  // UI UPDATE FUNCTIONS
  // ═══════════════════════════════════════════

  function setStatus(type, text) {
    if (!els.statusDot || !els.statusText) return;
    els.statusDot.className = 'agent-status-dot ' + type;
    els.statusText.textContent = text;
  }

  function formatPrice(n) {
    if (n == null) return '--';
    return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  let prevPrice = null;
  function updatePriceUI() {
    if (!els.btcPrice) return;
    const p = state.btcPrice;
    if (p == null) return;

    els.btcPrice.textContent = formatPrice(p);
    if (els.priceSource) els.priceSource.textContent = (state.priceSource || '--').toUpperCase();

    // Flash green/red on price change
    if (prevPrice !== null && p !== prevPrice) {
      const dir = p > prevPrice ? 'up' : 'down';
      els.btcPrice.classList.remove('flash-up', 'flash-down');
      void els.btcPrice.offsetWidth;
      els.btcPrice.classList.add('flash-' + dir);
    }

    // Show difference from PTB
    if (state.priceToBeat && els.priceChange) {
      const diff = p - state.priceToBeat;
      const sign = diff >= 0 ? '+' : '';
      const dir = diff >= 0 ? 'above' : 'below';
      els.priceChange.textContent = sign + '$' + Math.abs(diff).toFixed(2) + ' vs PTB';
      els.priceChange.className = 'agent-price-change ' + dir;
    }

    prevPrice = p;
  }

  let ptbSource = '';

  function updatePredictionUI(polyData) {
    if (!polyData) {
      console.warn('[AGENT] No Polymarket data');
      return;
    }

    // PTB from Polymarket startPrice (authoritative — used for settlement)
    if (polyData.startingPrice) {
      state.priceToBeat = polyData.startingPrice;
      ptbSource = polyData.ptbSource || 'polymarket';
      if (els.ptb) els.ptb.textContent = formatPrice(polyData.startingPrice);
    }

    state.upPct = polyData.upPct;
    state.downPct = polyData.downPct;
    state.timeLeft = polyData.timeLeft;

    // Odds bar
    const up = parseFloat(polyData.upPct) || 50;
    const down = parseFloat(polyData.downPct) || 50;
    if (els.oddsOver) els.oddsOver.style.width = up + '%';
    if (els.oddsUnder) els.oddsUnder.style.width = down + '%';
    if (els.oddsOverPct) els.oddsOverPct.textContent = 'OVER ' + polyData.upPct + '%';
    if (els.oddsUnderPct) els.oddsUnderPct.textContent = 'UNDER ' + polyData.downPct + '%';
  }

  function updateCallUI() {
    if (!els.call) return;

    // Live analysis based on current signals
    let bullScore = 0;
    let bearScore = 0;

    // Price vs PTB
    if (state.btcPrice && state.priceToBeat) {
      const diff = state.btcPrice - state.priceToBeat;
      if (diff > 0) bullScore += 2;
      else bearScore += 2;
    }

    // RSI
    if (state.ta && state.ta.rsi != null) {
      if (state.ta.rsi > 55) bullScore += 1;
      else if (state.ta.rsi < 45) bearScore += 1;
    }

    // MACD
    if (state.ta && state.ta.macdHist != null) {
      if (state.ta.macdHist > 0) bullScore += 1;
      else bearScore += 1;
    }

    // EMA alignment
    if (state.ta && state.ta.emaAligned === 'BULLISH') bullScore += 1;
    else if (state.ta && state.ta.emaAligned === 'BEARISH') bearScore += 1;

    // Market odds
    if (state.upPct && state.downPct) {
      const up = parseFloat(state.upPct);
      const down = parseFloat(state.downPct);
      if (up > 55) bullScore += 1;
      else if (down > 55) bearScore += 1;
    }

    if (bullScore === 0 && bearScore === 0) {
      if (els.callText) els.callText.textContent = 'ANALYZING...';
      els.call.className = 'agent-call call-neutral';
      return;
    }

    if (bullScore > bearScore) {
      if (els.callText) els.callText.textContent = 'OVER';
      els.call.className = 'agent-call call-over';
    } else if (bearScore > bullScore) {
      if (els.callText) els.callText.textContent = 'UNDER';
      els.call.className = 'agent-call call-under';
    } else {
      if (els.callText) els.callText.textContent = 'NEUTRAL';
      els.call.className = 'agent-call call-neutral';
    }
  }

  function updateStatsUI(record) {
    if (!record) return;
    state.wins = record.wins || 0;
    state.losses = record.losses || 0;
    const total = state.wins + state.losses;
    const wr = total > 0 ? ((state.wins / total) * 100).toFixed(1) : '0';

    if (els.wins) els.wins.textContent = state.wins;
    if (els.losses) els.losses.textContent = state.losses;
    if (els.winRate) els.winRate.textContent = wr + '%';
    if (els.total) els.total.textContent = total;
  }

  function updateTAUI(ta) {
    if (!ta) return;
    state.ta = ta;

    if (ta.rsi != null) {
      const rsiVal = ta.rsi.toFixed(1);
      const rsiTag = ta.rsi > 70 ? ' OB' : ta.rsi < 30 ? ' OS' : '';
      if (els.rsi) {
        els.rsi.textContent = rsiVal + rsiTag;
        els.rsi.className = 'agent-ta-val ' + (ta.rsi > 55 ? 'bullish' : ta.rsi < 45 ? 'bearish' : 'neutral');
      }
    }

    if (ta.macdHist != null) {
      const cross = ta.macdCrossing ? ' X' : '';
      if (els.macd) {
        els.macd.textContent = ta.macdHist.toFixed(1) + cross;
        els.macd.className = 'agent-ta-val ' + (ta.macdHist > 0 ? 'bullish' : 'bearish');
      }
    }

    if (els.ema) {
      els.ema.textContent = ta.emaAligned;
      els.ema.className = 'agent-ta-val ' + (ta.emaAligned === 'BULLISH' ? 'bullish' : ta.emaAligned === 'BEARISH' ? 'bearish' : 'neutral');
    }

    if (ta.vwapDist != null && els.vwap) {
      const sign = ta.vwapDist >= 0 ? '+' : '';
      els.vwap.textContent = sign + ta.vwapDist.toFixed(3) + '%';
      els.vwap.className = 'agent-ta-val ' + (ta.vwapDist > 0 ? 'bullish' : 'bearish');
    }

    if (ta.volZScore != null && els.vol) {
      const tag = ta.volZScore > 2 ? ' SPIKE' : ta.volZScore < -1 ? ' DRY' : '';
      els.vol.textContent = ta.volZScore.toFixed(2) + tag;
      els.vol.className = 'agent-ta-val ' + (ta.volZScore > 1 ? 'bullish' : ta.volZScore < -1 ? 'bearish' : 'neutral');
    }
  }

  function updateHistoryUI(predictions) {
    if (!els.historyList) return;
    if (!predictions || predictions.length === 0) {
      els.historyList.innerHTML = '<div class="agent-history-empty">No predictions yet</div>';
      return;
    }

    state.history = predictions;
    let html = '';
    for (const p of predictions) {
      if (!p.ts || p.ptb == null || p.end_price == null) continue;

      const time = new Date(p.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const ptb = formatPrice(p.ptb);
      const end = formatPrice(p.end_price);

      // Derive predicted direction from result
      const actualOver = p.end_price > p.ptb;
      const correct = !!p.over;
      const predictedOver = correct ? actualOver : !actualOver;

      const dir = predictedOver ? 'OVER' : 'UNDER';
      const result = correct ? 'WIN' : 'LOSS';
      const resultClass = correct ? 'win' : 'loss';

      html += '<div class="agent-history-item">' +
        '<span class="agent-history-time">' + time + '</span>' +
        '<span class="agent-history-ptb">' + ptb + '</span>' +
        '<span class="agent-history-dir ' + dir.toLowerCase() + '">' + dir + '</span>' +
        '<span class="agent-history-end">' + end + '</span>' +
        '<span class="agent-history-result ' + resultClass + '">' + result + '</span>' +
      '</div>';
    }
    els.historyList.innerHTML = html;

    // Compute model performance from history
    computeModelPerf(predictions);
  }

  function computeModelPerf(rows) {
    if (!rows || rows.length === 0) return;

    let tp = 0, tn = 0, fp = 0, fn = 0;
    for (const r of rows) {
      if (r.ptb == null || r.end_price == null) continue;
      const actualOver = r.end_price > r.ptb;
      const correct = !!r.over;

      if (correct && actualOver) tp++;
      else if (correct && !actualOver) tn++;
      else if (!correct && !actualOver) fp++;
      else if (!correct && actualOver) fn++;
    }

    const total = tp + tn + fp + fn;
    const accuracy = total > 0 ? ((tp + tn) / total) * 100 : null;
    const precision = (tp + fp) > 0 ? (tp / (tp + fp)) * 100 : null;
    const recall = (tp + fn) > 0 ? (tp / (tp + fn)) * 100 : null;
    const f1 = (precision != null && recall != null && (precision + recall) > 0)
      ? 2 * (precision * recall) / (precision + recall) : null;
    const tpr = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const fpr = (fp + tn) > 0 ? fp / (fp + tn) : 0;
    const rocAuc = total > 0 ? ((1 + tpr - fpr) / 2) * 100 : null;

    if (els.accuracy) els.accuracy.textContent = accuracy != null ? accuracy.toFixed(1) + '%' : '--';
    if (els.precision) els.precision.textContent = precision != null ? precision.toFixed(1) + '%' : '--';
    if (els.f1) els.f1.textContent = f1 != null ? f1.toFixed(1) + '%' : '--';
    if (els.rocAuc) els.rocAuc.textContent = rocAuc != null ? rocAuc.toFixed(1) + '%' : '--';
    if (els.tp) els.tp.textContent = tp;
    if (els.tn) els.tn.textContent = tn;
    if (els.fp) els.fp.textContent = fp;
    if (els.fn) els.fn.textContent = fn;
    if (els.recall) els.recall.textContent = recall != null ? recall.toFixed(1) + '%' : '--';
  }

  // ═══════════════════════════════════════════
  // SMART FINAL PREDICTION ENGINE
  // ═══════════════════════════════════════════

  function analyzeFinalPrediction() {
    if (!els.finalPred) return;

    const signals = [];
    let bullScore = 0;
    let bearScore = 0;

    // 1. Price momentum vs PTB
    if (state.btcPrice && state.priceToBeat) {
      const diff = state.btcPrice - state.priceToBeat;
      const pctDiff = (diff / state.priceToBeat) * 100;
      if (diff > 0) {
        bullScore += Math.min(pctDiff * 10, 3);
        signals.push('PRICE +' + pctDiff.toFixed(3) + '% above PTB');
      } else {
        bearScore += Math.min(Math.abs(pctDiff) * 10, 3);
        signals.push('PRICE ' + pctDiff.toFixed(3) + '% below PTB');
      }
    }

    // 2. RSI
    if (state.ta && state.ta.rsi != null) {
      if (state.ta.rsi > 65) {
        bearScore += 1.5;
        signals.push('RSI ' + state.ta.rsi.toFixed(1) + ' OB');
      } else if (state.ta.rsi < 35) {
        bullScore += 1.5;
        signals.push('RSI ' + state.ta.rsi.toFixed(1) + ' OS');
      } else if (state.ta.rsi > 50) {
        bullScore += 0.5;
        signals.push('RSI ' + state.ta.rsi.toFixed(1) + ' bull');
      } else {
        bearScore += 0.5;
        signals.push('RSI ' + state.ta.rsi.toFixed(1) + ' bear');
      }
    }

    // 3. MACD
    if (state.ta && state.ta.macdHist != null) {
      if (state.ta.macdHist > 0) {
        bullScore += 1;
        signals.push('MACD +' + state.ta.macdHist.toFixed(1));
      } else {
        bearScore += 1;
        signals.push('MACD ' + state.ta.macdHist.toFixed(1));
      }
      if (state.ta.macdCrossing) {
        bullScore += state.ta.macdHist > 0 ? 1 : 0;
        bearScore += state.ta.macdHist > 0 ? 0 : 1;
        signals.push('MACD X');
      }
    }

    // 4. EMA alignment
    if (state.ta && state.ta.emaAligned) {
      if (state.ta.emaAligned === 'BULLISH') {
        bullScore += 1.5;
        signals.push('EMA BULL');
      } else if (state.ta.emaAligned === 'BEARISH') {
        bearScore += 1.5;
        signals.push('EMA BEAR');
      } else {
        signals.push('EMA MIX');
      }
    }

    // 5. VWAP
    if (state.ta && state.ta.vwapDist != null) {
      if (state.ta.vwapDist > 0.05) {
        bullScore += 0.5;
        signals.push('VWAP +' + state.ta.vwapDist.toFixed(3) + '%');
      } else if (state.ta.vwapDist < -0.05) {
        bearScore += 0.5;
        signals.push('VWAP ' + state.ta.vwapDist.toFixed(3) + '%');
      }
    }

    // 6. Volume
    if (state.ta && state.ta.volZScore != null) {
      if (state.ta.volZScore > 1.5) {
        signals.push('VOL z=' + state.ta.volZScore.toFixed(2));
        if (state.btcPrice > state.priceToBeat) bullScore += 1;
        else bearScore += 1;
      }
    }

    // 7. Market odds
    if (state.upPct && state.downPct) {
      const up = parseFloat(state.upPct);
      const down = parseFloat(state.downPct);
      if (up > 55) {
        bullScore += 1;
        signals.push('ODDS OVER ' + up + '%');
      } else if (down > 55) {
        bearScore += 1;
        signals.push('ODDS UNDER ' + down + '%');
      }
    }

    // Final decision
    const totalScore = bullScore + bearScore;
    const isOver = bullScore >= bearScore;
    const margin = Math.abs(bullScore - bearScore);
    const confPct = totalScore > 0 ? (Math.max(bullScore, bearScore) / totalScore * 100) : 50;

    let confLevel, confLabel;
    if (margin >= 3) { confLevel = 'high'; confLabel = 'HIGH'; }
    else if (margin >= 1) { confLevel = 'medium'; confLabel = 'MED'; }
    else { confLevel = 'low'; confLabel = 'LOW'; }

    // Update UI
    els.finalPred.style.display = 'block';
    els.finalPred.className = 'agent-final-pred pred-' + (isOver ? 'over' : 'under');
    if (els.finalIcon) els.finalIcon.textContent = isOver ? '🟢' : '🔴';
    if (els.finalCall) els.finalCall.textContent = isOver ? 'OVER' : 'UNDER';
    if (els.finalConf) {
      els.finalConf.textContent = confLabel + ' ' + confPct.toFixed(0) + '%';
      els.finalConf.className = 'agent-final-conf ' + confLevel;
    }
    if (els.finalStatus) els.finalStatus.textContent = 'LOCKED IN';
    if (els.finalPrice) els.finalPrice.textContent = state.btcPrice ? formatPrice(state.btcPrice) : '--';
    if (els.finalSignals) els.finalSignals.textContent = signals.join(' · ');

    // Store for saving at window end
    finalPredDirection = isOver ? 'over' : 'under';
    finalPredPTB = state.priceToBeat;

    console.log('[AGENT] FINAL PREDICTION: ' + (isOver ? 'OVER' : 'UNDER') +
      ' | Conf: ' + confLabel + ' ' + confPct.toFixed(1) + '%' +
      ' | Bull: ' + bullScore.toFixed(1) + ' Bear: ' + bearScore.toFixed(1));
  }

  // ═══════════════════════════════════════════
  // COUNTDOWN TIMER
  // ═══════════════════════════════════════════

  function updateCountdown() {
    if (!els.countdown) return;
    const now = Math.floor(Date.now() / 1000);
    const windowEnd = (Math.floor(now / 300) + 1) * 300;
    const windowStart = windowEnd - 300;
    const left = windowEnd - now;
    const mins = Math.floor(left / 60);
    const secs = left % 60;
    els.countdown.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;

    // New window detected
    if (state.currentWindowStart !== windowStart) {
      // Save previous window's final prediction
      if (finalPredLocked && finalPredDirection && finalPredPTB && state.btcPrice) {
        const predictedOver = finalPredDirection === 'over';
        savePrediction(state.currentWindowStart, finalPredPTB, state.btcPrice, predictedOver);
      }

      state.currentWindowStart = windowStart;
      state.priceToBeat = null;
      ptbSource = '';
      finalPredLocked = false;
      finalPredDirection = null;
      finalPredPTB = null;
      if (els.finalPred) els.finalPred.style.display = 'none';

      // Trigger refresh for new window data (guard prevents concurrent runs)
      setTimeout(refresh, 500);
    }

    // Trigger final prediction at 2:00 remaining
    if (!finalPredLocked && left <= 120 && left > 0) {
      finalPredLocked = true;
      finalPredWindow = windowStart;
      analyzeFinalPrediction();
    }
  }

  // ═══════════════════════════════════════════
  // MAIN LOOP
  // ═══════════════════════════════════════════

  let refreshing = false;

  async function refresh() {
    if (refreshing) return;
    refreshing = true;

    // Fetch critical data (Supabase + Binance — reliable, fast)
    try {
      const [candles, history] = await Promise.all([
        fetchCandles(),
        fetchHistory(),
      ]);

      console.log('[AGENT] Refresh — candles:', candles ? candles.length : 0,
        '| history:', history ? history.length : 0);

      // TA from candles
      try {
        const ta = computeTA(candles);
        updateTAUI(ta);
      } catch (e) { console.error('[AGENT] TA error:', e); }

      // If we don't have WS price yet, use candle close
      if (!state.btcPrice && candles && candles.length > 0) {
        state.btcPrice = candles[candles.length - 1].close;
        state.priceSource = 'binance';
        updatePriceUI();
      }

      // History (renders predictions + model perf)
      try {
        console.log('[AGENT] Rendering history...', 'els.historyList:', !!els.historyList);
        updateHistoryUI(history);
        console.log('[AGENT] History rendered OK');
      } catch (e) { console.error('[AGENT] History render error:', e); }

      // Track record — always compute fresh from history data
      try {
        if (history && history.length > 0) {
          const record = computeTrackRecord(history);
          console.log('[AGENT] Track record from history:', record.wins, 'W', record.losses, 'L', '/', history.length, 'total');
          updateStatsUI(record);
        }
      } catch (e) { console.error('[AGENT] Stats render error:', e); }

      // Update price vs PTB display
      updatePriceUI();

      // Live prediction call
      updateCallUI();

    } catch (e) {
      console.error('[AGENT] Refresh error:', e.message);
      refreshing = false;
      return;
    }

    // PTB: Check sessionStorage cache FIRST (survives refresh)
    var now = Math.floor(Date.now() / 1000);
    var currentStart = Math.floor(now / 300) * 300;
    try {
      var cachedPtb = sessionStorage.getItem('vg_ptb_' + currentStart);
      if (cachedPtb) {
        var cachedVal = parseFloat(cachedPtb);
        if (cachedVal > 0) {
          state.priceToBeat = cachedVal;
          ptbSource = 'polymarket-cached';
          if (els.ptb) els.ptb.textContent = formatPrice(cachedVal);
          console.log('[AGENT] PTB from session cache (instant):', cachedVal);
        }
      }
    } catch (e) {}

    // Then try Polymarket for fresh data + odds (won't override cached PTB unless it has authoritative startPrice)
    try {
      const polyData = await fetchPolymarket();
      updatePredictionUI(polyData);
      updatePriceUI();
      updateCallUI();
    } catch (e) {
      console.warn('[AGENT] Polymarket failed:', e.message);
    }

    // Only use Binance fallback if we STILL have no PTB at all
    if (!state.priceToBeat) {
      try {
        const ptb = await fetchPTBFallback();
        if (ptb) {
          state.priceToBeat = ptb;
          ptbSource = 'binance';
          if (els.ptb) els.ptb.textContent = formatPrice(ptb);
          // Cache it so even Binance PTB survives refresh
          try { sessionStorage.setItem('vg_ptb_' + currentStart, ptb.toString()); } catch(e) {}
          console.log('[AGENT] PTB from Binance fallback:', ptb);
          updatePriceUI();
          updateCallUI();
        }
      } catch (e2) { console.error('[AGENT] PTB fallback error:', e2.message); }
    }

    refreshing = false;
  }

  // ── Init ──
  function init() {
    if (!els.btcPrice) return;

    console.log('[AGENT] Initializing Vanguard Agent dashboard...');
    setStatus('connecting', 'CONNECTING...');
    connectRTDS();
    refresh();

    // Refresh data every 30 seconds
    setInterval(refresh, 30000);

    // Countdown every second
    setInterval(updateCountdown, 1000);
    updateCountdown();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
