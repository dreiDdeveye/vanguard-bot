// ═══════════════════════════════════════════════════════════════
// VANGUARD AGENT — Browser-side live BTC prediction dashboard
// Connects to Polymarket RTDS, Binance, and Supabase
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Supabase config — direct REST API (no client SDK needed) ──
  const SUPABASE_URL = 'https://zrvbmzjsivxlcodsdvrb.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpydmJtempzaXZ4bGNvZHNkdnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NTkxNTYsImV4cCI6MjA4ODEzNTE1Nn0.gBu0RL9tHBCjYmkiupziTPAsVX3s8TovUdMhjWPjiLw';
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
  state.wsMsgCount = 0;

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
    finalAnalyzing: $('agentFinalAnalyzing'),
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
    wsCount: $('wsCount'),
    allWinStreak: $('allWinStreak'),
    currWinStreak: $('currWinStreak'),
    allLossStreak: $('allLossStreak'),
    currLossStreak: $('currLossStreak'),
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
    chart: $('agentChart'),
    chartTooltip: $('agentChartTooltip'),
    chartHigh: $('agentChartHigh'),
    chartLow: $('agentChartLow'),
    chartChange: $('agentChartChange'),
    wsIndicator: $('wsIndicator'),
    wsDot: $('wsDot'),
    wsText: $('wsText'),
  };

  // ── Chart state — continuous rolling buffer, persisted to Supabase ──
  let chartPoints = []; // [{time, price}]
  const CHART_DURATION = 30 * 60 * 1000; // show last 30 minutes
  let lastChartSave = 0; // throttle saves to every 10 seconds

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

    // Momentum direction: is RSI rising or falling?
    const rsiPrev = rsi14[last - 1];
    const rsiDelta = (rsi14[last] != null && rsiPrev != null) ? rsi14[last] - rsiPrev : 0;

    // MACD histogram trend (expanding or contracting?)
    const macdHistPrev = macdData.histogram[last - 1];
    const macdHistDelta = macdData.histogram[last] - macdHistPrev;

    // Price returns over recent candles
    const ret1 = ((closes[last] - closes[last - 1]) / closes[last - 1]) * 100;
    const ret3 = last >= 3 ? ((closes[last] - closes[last - 3]) / closes[last - 3]) * 100 : 0;

    // Recent candle bodies: how many of last 3 are bullish vs bearish
    let recentBullCandles = 0;
    let recentBearCandles = 0;
    for (let i = last; i >= Math.max(0, last - 2); i--) {
      if (candles[i].close > candles[i].open) recentBullCandles++;
      else recentBearCandles++;
    }

    // EMA slopes (rate of change)
    const ema9Slope = last >= 3 ? ((ema9[last] - ema9[last - 3]) / ema9[last - 3]) * 100 : 0;

    return {
      price: closes[last],
      rsi: rsi14[last],
      rsiDelta: rsiDelta,
      macdHist: macdData.histogram[last],
      macdHistDelta: macdHistDelta,
      macdCrossing: Math.sign(macdData.histogram[last]) !== Math.sign(macdData.histogram[last - 1]),
      emaAligned: aligned,
      ema9Slope: ema9Slope,
      vwapDist: ((closes[last] - vwapData[last]) / vwapData[last] * 100),
      volZScore: volZ[last],
      ret1: ret1,
      ret3: ret3,
      recentBullCandles: recentBullCandles,
      recentBearCandles: recentBearCandles,
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
    function(u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); },
    function(u) { return 'https://thingproxy.freeboard.io/fetch/' + u; },
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
      if (!data || data.length === 0) {
        console.warn('[AGENT] No predictions in Supabase');
        return [];
      }
      // Deduplicate by timestamp — keep first (most recent) per ts
      const seen = {};
      const deduped = [];
      for (const p of data) {
        if (!seen[p.ts]) {
          seen[p.ts] = true;
          deduped.push(p);
        }
      }
      console.log('[AGENT] Loaded ' + deduped.length + ' predictions (' + data.length + ' total, deduped)');
      return deduped;
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
          // Normalize fields (Supabase may return booleans as strings)
          const normalized = data.map((p) => {
            const overRaw = p.over;
            const over = (overRaw === true || overRaw === 'true' || overRaw === 't' || overRaw === 1 || overRaw === '1');
            return Object.assign({}, p, { over: over, ptb: Number(p.ptb), end_price: Number(p.end_price), ts: Number(p.ts) });
          });
          console.log('[AGENT] History from Supabase:', normalized.length, 'rows');
          // Deduplicate by timestamp — keep first (most recent) per ts
          const seen = {};
          const deduped = [];
          for (const p of normalized) {
            if (!seen[p.ts]) {
              seen[p.ts] = true;
              deduped.push(p);
            }
          }
          console.log('[AGENT] Loaded ' + deduped.length + ' predictions (' + normalized.length + ' total, deduped)');
          return deduped;
        }
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
        setWsIndicator('connected', 'CONNECTED');

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

                // count WS messages for indicator
                state.wsMsgCount = (state.wsMsgCount || 0) + 1;
                if (els.wsCount) els.wsCount.textContent = state.wsMsgCount;

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
            addChartPoint(msg.payload.value);
          }
        } catch (e) { /* ignore parse errors */ }
      };

      rtdsWs.onerror = function () {
        console.log('[AGENT] RTDS error — will retry');
        setStatus('error', 'ERROR');
        setWsIndicator('error', 'ERROR');
      };

      rtdsWs.onclose = function () {
        console.log('[AGENT] RTDS closed — reconnecting in 5s');
        setStatus('reconnecting', 'RECONNECTING...');
        setWsIndicator('reconnecting', 'RECONNECTING');
        state.connected = false;
        clearTimeout(rtdsReconnectTimer);
        rtdsReconnectTimer = setTimeout(connectRTDS, 5000);
      };
    } catch (e) {
      console.error('[AGENT] WS connect failed:', e.message);
      setStatus('error', 'OFFLINE');
      setWsIndicator('error', 'OFFLINE');
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

  // Persistent WS indicator updated only on WebSocket events
  function setWsIndicator(state, text) {
    if (!els.wsIndicator || !els.wsDot || !els.wsText) return;
    els.wsDot.className = 'ws-dot ' + state; // e.g. 'connected', 'reconnecting', 'error'
    els.wsText.textContent = 'WS: ' + (text || state.toUpperCase());
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

    // Flash green/red on price change (no forced reflow)
    if (prevPrice !== null && p !== prevPrice) {
      const dir = p > prevPrice ? 'up' : 'down';
      const el = els.btcPrice;
      el.classList.remove('flash-up', 'flash-down');
      requestAnimationFrame(function() {
        el.classList.add('flash-' + dir);
      });
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
    if (els.oddsOverPct) els.oddsOverPct.textContent = 'UP ' + polyData.upPct + '%';
    if (els.oddsUnderPct) els.oddsUnderPct.textContent = 'DOWN ' + polyData.downPct + '%';
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
      if (els.callText) els.callText.textContent = 'UP';
      els.call.className = 'agent-call call-up';
    } else if (bearScore > bullScore) {
      if (els.callText) els.callText.textContent = 'DOWN';
      els.call.className = 'agent-call call-down';
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

  var lastHistoryHash = '';

  function updateHistoryUI(predictions) {
    if (!els.historyList) return;
    if (!predictions || predictions.length === 0) {
      if (lastHistoryHash !== 'empty') {
        els.historyList.innerHTML = '<div class="agent-history-empty">No predictions yet</div>';
        lastHistoryHash = 'empty';
      }
      return;
    }

    // Skip DOM rebuild if data hasn't changed
    var hash = predictions.length + ':' + (predictions[0] ? predictions[0].ts : 0);
    if (hash === lastHistoryHash) return;
    lastHistoryHash = hash;

    state.history = predictions;

    // Build in a DocumentFragment to avoid repeated reflows
    var frag = document.createDocumentFragment();
    for (var i = 0; i < predictions.length; i++) {
      var p = predictions[i];
      if (!p.ts || p.ptb == null || p.end_price == null) continue;

      var time = new Date(p.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var ptb = formatPrice(p.ptb);
      var end = formatPrice(p.end_price);

      var actualOver = p.end_price > p.ptb;
      var correct = !!p.over;
      var predictedOver = correct ? actualOver : !actualOver;

      var dir = predictedOver ? 'UP' : 'DOWN';
      var result = correct ? 'WIN' : 'LOSS';
      var resultClass = correct ? 'win' : 'loss';

      var row = document.createElement('div');
      row.className = 'agent-history-item';
      row.innerHTML =
        '<span class="agent-history-time">' + time + '</span>' +
        '<span class="agent-history-ptb">' + ptb + '</span>' +
        '<span class="agent-history-dir ' + dir.toLowerCase() + '">' + dir + '</span>' +
        '<span class="agent-history-end">' + end + '</span>' +
        '<span class="agent-history-result ' + resultClass + '">' + result + '</span>';
      frag.appendChild(row);
    }
    els.historyList.innerHTML = '';
    els.historyList.appendChild(frag);

    // Compute model performance from history
    computeModelPerf(predictions);

    // Update history meta (streaks)
    try { updateHistoryStatsUI(predictions); } catch (e) { console.error('[AGENT] Streaks update error:', e); }
  }

  function updateHistoryStatsUI(predictions) {
    if (!predictions) return;
    // normalize and sort ascending by ts
    const arr = predictions.slice().filter(p => p && (p.over === true || p.over === false || p.over === 'true' || p.over === 'false' || p.over === '1' || p.over === '0')).map(p => ({ ts: Number(p.ts), over: (p.over === true || p.over === 'true' || p.over === 't' || p.over === 1 || p.over === '1') })).sort((a,b)=>a.ts - b.ts);
    if (arr.length === 0) return;
    // compute overall longest win/loss streaks
    let maxWin = 0, maxLoss = 0, cur = 0, curType = null;
    for (const p of arr) {
      if (p.over) {
        if (curType === 'win') cur++; else { curType = 'win'; cur = 1; }
        if (cur > maxWin) maxWin = cur;
      } else {
        if (curType === 'loss') cur++; else { curType = 'loss'; cur = 1; }
        if (cur > maxLoss) maxLoss = cur;
      }
    }
    // compute current trailing streak
    let currWin = 0, currLoss = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].over) { if (currLoss) break; currWin++; } else { if (currWin) break; currLoss++; }
    }
    // update DOM
    if (els.allWinStreak) els.allWinStreak.textContent = maxWin;
    if (els.currWinStreak) els.currWinStreak.textContent = currWin;
    if (els.allLossStreak) els.allLossStreak.textContent = maxLoss;
    if (els.currLossStreak) els.currLossStreak.textContent = currLoss;
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
  // BTC PRICE CHART (canvas)
  // ═══════════════════════════════════════════

  var chartRenderPending = false;
  var lastChartRender = 0;
  var CHART_RENDER_INTERVAL = 1000; // render at most once per second

  function addChartPoint(price) {
    if (!price) return;
    var now = Date.now();
    chartPoints.push({ time: now, price: price });

    // Trim old points beyond 30 minutes
    var cutoff = now - CHART_DURATION;
    while (chartPoints.length > 0 && chartPoints[0].time < cutoff) {
      chartPoints.shift();
    }

    // Save to Supabase every 10 seconds
    if (now - lastChartSave >= 10000) {
      lastChartSave = now;
      saveChartPoint(now, price);
    }

    // Throttled chart rendering — at most once per second via rAF
    if (!chartRenderPending && now - lastChartRender >= CHART_RENDER_INTERVAL) {
      chartRenderPending = true;
      requestAnimationFrame(function() {
        renderChart();
        lastChartRender = Date.now();
        chartRenderPending = false;
      });
    }
  }

  function saveChartPoint(ts, price) {
    var url = SUPABASE_URL + '/rest/v1/chart_prices';
    fetch(url, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify({ ts: ts, price: price }),
    }).catch(function() {});
  }

  async function loadChartHistory() {
    try {
      var cutoff = Date.now() - CHART_DURATION;
      var url = SUPABASE_URL + '/rest/v1/chart_prices?select=ts,price&ts=gte.' + cutoff + '&order=ts.asc&limit=500';
      var res = await fetch(url, { headers: SB_HEADERS });
      if (!res.ok) return;
      var data = await res.json();
      if (data && data.length > 0) {
        chartPoints = data.map(function(d) { return { time: d.ts, price: d.price }; });
        console.log('[AGENT] Loaded ' + data.length + ' chart points from Supabase');
        renderChart();
      }
    } catch (e) {
      console.error('[AGENT] Chart history error:', e.message);
    }
  }

  var chartCtx = null;
  var chartW = 0;
  var chartH = 0;
  var chartDpr = 1;

  function renderChart() {
    if (!els.chart || chartPoints.length < 2) return;

    var canvas = els.chart;
    if (!chartCtx) chartCtx = canvas.getContext('2d');
    var ctx = chartCtx;
    var dpr = window.devicePixelRatio || 1;

    // Only read layout and resize canvas when dimensions actually change
    var parent = canvas.parentElement;
    var newW = parent.clientWidth;
    var newH = parent.clientHeight;
    if (newW !== chartW || newH !== chartH || dpr !== chartDpr) {
      chartW = newW;
      chartH = newH;
      chartDpr = dpr;
      canvas.width = newW * dpr;
      canvas.height = newH * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var W = chartW;
    var H = chartH;

    var pad = { top: 16, bottom: 24, left: 0, right: 60 };
    var chartW = W - pad.left - pad.right;
    var chartH = H - pad.top - pad.bottom;

    var prices = chartPoints.map(function(p) { return p.price; });
    var high = Math.max.apply(null, prices);
    var low = Math.min.apply(null, prices);

    // Include PTB in range
    if (state.priceToBeat) {
      high = Math.max(high, state.priceToBeat);
      low = Math.min(low, state.priceToBeat);
    }

    var range = high - low || 1;
    high += range * 0.08;
    low -= range * 0.08;
    range = high - low;

    // X axis = rolling time window
    var nowMs = Date.now();
    var startMs = chartPoints[0].time;
    var span = nowMs - startMs || 1;

    function x(timeMs) { return pad.left + ((timeMs - startMs) / span) * chartW; }
    function y(v) { return pad.top + (1 - (v - low) / range) * chartH; }

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Grid lines + price labels
    ctx.strokeStyle = 'rgba(76, 201, 138, 0.06)';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gy = pad.top + (g / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(pad.left, gy);
      ctx.lineTo(W - pad.right, gy);
      ctx.stroke();
      var gPrice = high - (g / 4) * range;
      ctx.fillStyle = 'rgba(168, 184, 176, 0.5)';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('$' + gPrice.toFixed(0), W - pad.right + 6, gy + 3);
    }

    // 5-minute window boundary lines (vertical dashed)
    ctx.strokeStyle = 'rgba(76, 201, 138, 0.1)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    var firstBoundary = Math.ceil(startMs / 300000) * 300000;
    for (var b = firstBoundary; b <= nowMs; b += 300000) {
      var bx = x(b);
      if (bx > pad.left && bx < W - pad.right) {
        ctx.beginPath();
        ctx.moveTo(bx, pad.top);
        ctx.lineTo(bx, H - pad.bottom);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // PTB line
    if (state.priceToBeat && state.priceToBeat >= low && state.priceToBeat <= high) {
      var ptbY = y(state.priceToBeat);
      ctx.strokeStyle = 'rgba(201, 168, 76, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, ptbY);
      ctx.lineTo(W - pad.right, ptbY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(201, 168, 76, 0.8)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('PTB $' + state.priceToBeat.toFixed(0), W - pad.right + 6, ptbY - 4);
    }

    // Color: green if above PTB, red if below
    var lastPrice = prices[prices.length - 1];
    var isUp = state.priceToBeat ? lastPrice >= state.priceToBeat : lastPrice >= prices[0];
    var lineColor = isUp ? 'rgba(76, 201, 138, 0.9)' : 'rgba(201, 76, 76, 0.9)';

    // Gradient fill
    var gradient = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    gradient.addColorStop(0, isUp ? 'rgba(76, 201, 138, 0.15)' : 'rgba(201, 76, 76, 0.15)');
    gradient.addColorStop(1, isUp ? 'rgba(76, 201, 138, 0)' : 'rgba(201, 76, 76, 0)');

    ctx.beginPath();
    ctx.moveTo(x(chartPoints[0].time), y(chartPoints[0].price));
    for (var i = 1; i < chartPoints.length; i++) {
      ctx.lineTo(x(chartPoints[i].time), y(chartPoints[i].price));
    }
    ctx.lineTo(x(chartPoints[chartPoints.length - 1].time), H - pad.bottom);
    ctx.lineTo(x(chartPoints[0].time), H - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Price line
    ctx.beginPath();
    ctx.moveTo(x(chartPoints[0].time), y(chartPoints[0].price));
    for (var i = 1; i < chartPoints.length; i++) {
      ctx.lineTo(x(chartPoints[i].time), y(chartPoints[i].price));
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Current price dot
    var lastPt = chartPoints[chartPoints.length - 1];
    var lx = x(lastPt.time);
    var ly = y(lastPt.price);
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lx, ly, 8, 0, Math.PI * 2);
    ctx.strokeStyle = isUp ? 'rgba(76, 201, 138, 0.25)' : 'rgba(201, 76, 76, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Current price label
    ctx.fillStyle = lineColor;
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('$' + lastPrice.toFixed(2), W - pad.right + 6, ly + 4);

    // Time labels along bottom (every 5 min)
    ctx.fillStyle = 'rgba(168, 184, 176, 0.4)';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    for (var b = firstBoundary; b <= nowMs; b += 300000) {
      var bx = x(b);
      if (bx > pad.left + 20 && bx < W - pad.right - 20) {
        var t = new Date(b);
        var label = t.getHours() + ':' + (t.getMinutes() < 10 ? '0' : '') + t.getMinutes();
        ctx.fillText(label, bx, H - 4);
      }
    }

    // Stats
    if (els.chartHigh) els.chartHigh.textContent = '$' + Math.max.apply(null, prices).toFixed(2);
    if (els.chartLow) els.chartLow.textContent = '$' + Math.min.apply(null, prices).toFixed(2);
    if (els.chartChange) {
      var change = lastPrice - prices[0];
      var changePct = (change / prices[0] * 100);
      var sign = change >= 0 ? '+' : '';
      els.chartChange.textContent = sign + '$' + Math.abs(change).toFixed(2) + ' (' + sign + changePct.toFixed(2) + '%)';
      els.chartChange.className = change >= 0 ? 'bullish' : 'bearish';
    }

    // Tooltip on hover
    canvas.onmousemove = function(e) {
      var br = canvas.getBoundingClientRect();
      var mx = e.clientX - br.left;
      var hoverTime = startMs + ((mx - pad.left) / chartW) * span;
      var best = chartPoints[0], bestDiff = Infinity;
      for (var j = 0; j < chartPoints.length; j++) {
        var d = Math.abs(chartPoints[j].time - hoverTime);
        if (d < bestDiff) { bestDiff = d; best = chartPoints[j]; }
      }
      var t = new Date(best.time);
      var ts = t.getHours() + ':' + (t.getMinutes() < 10 ? '0' : '') + t.getMinutes() + ':' + (t.getSeconds() < 10 ? '0' : '') + t.getSeconds();
      els.chartTooltip.innerHTML = ts + '<br>$' + best.price.toFixed(2);
      els.chartTooltip.style.display = 'block';
      els.chartTooltip.style.left = Math.min(mx + 12, W - 100) + 'px';
      els.chartTooltip.style.top = (y(best.price) - 30) + 'px';
    };
    canvas.onmouseleave = function() {
      els.chartTooltip.style.display = 'none';
    };
  }

  // ═══════════════════════════════════════════
  // SMART FINAL PREDICTION ENGINE
  // ═══════════════════════════════════════════

  function analyzeFinalPrediction() {
    if (!els.finalPred) return;

    const signals = [];
    let bullScore = 0;
    let bearScore = 0;
    const ta = state.ta;

    // ═══ 1. MARKET ODDS — PRIMARY SIGNAL (Polymarket = smart money) ═══
    // Ranked highest: the market is usually right
    if (state.upPct && state.downPct) {
      const up = parseFloat(state.upPct);
      const down = parseFloat(state.downPct);
      if (up > 65) {
        bullScore += 3;
        signals.push('MARKET STRONG UP ' + up + '%');
      } else if (down > 65) {
        bearScore += 3;
        signals.push('MARKET STRONG DOWN ' + down + '%');
      } else if (up > 55) {
        bullScore += 1.5;
        signals.push('MARKET LEAN UP ' + up + '%');
      } else if (down > 55) {
        bearScore += 1.5;
        signals.push('MARKET LEAN DOWN ' + down + '%');
      } else {
        signals.push('MARKET SPLIT ' + up + '/' + down);
      }
    }

    // ═══ 2. MEAN-REVERSION — Key insight for 5m predictions ═══
    // Price above PTB with fading momentum → likely DOWN
    // Price below PTB with selling exhausted → likely UP
    if (state.btcPrice && state.priceToBeat && ta) {
      const diff = state.btcPrice - state.priceToBeat;
      const pctDiff = (diff / state.priceToBeat) * 100;
      const abovePTB = diff > 0;

      if (abovePTB) {
        // Above PTB — check if momentum is fading
        const momentumFading = (ta.rsiDelta < 0) || (ta.macdHistDelta < 0) || (ta.ema9Slope < 0);
        const recentBearish = ta.recentBearCandles >= 2;

        if (momentumFading || recentBearish) {
          // Price pumped but losing steam → DOWN
          bearScore += 2;
          signals.push('ABOVE PTB +' + pctDiff.toFixed(3) + '% FADING');
        } else {
          // Strong continued momentum above PTB
          bullScore += Math.min(pctDiff * 5, 2);
          signals.push('ABOVE PTB +' + pctDiff.toFixed(3) + '% STRONG');
        }
      } else {
        // Below PTB — check if selling is exhausted
        const sellingExhausted = (ta.rsiDelta > 0) || (ta.macdHistDelta > 0) || (ta.ema9Slope > 0);
        const recentBullish = ta.recentBullCandles >= 2;

        if (sellingExhausted || recentBullish) {
          // Price dipped but recovering → UP
          bullScore += 2;
          signals.push('BELOW PTB ' + pctDiff.toFixed(3) + '% RECOVERING');
        } else {
          // Continued selling pressure
          bearScore += Math.min(Math.abs(pctDiff) * 5, 2);
          signals.push('BELOW PTB ' + pctDiff.toFixed(3) + '% WEAK');
        }
      }
    }

    // ═══ 3. VWAP POSITION — Most reliable 5m indicator ═══
    if (ta && ta.vwapDist != null) {
      if (ta.vwapDist > 0.05) {
        bullScore += 1.5;
        signals.push('VWAP +' + ta.vwapDist.toFixed(3) + '%');
      } else if (ta.vwapDist < -0.05) {
        bearScore += 1.5;
        signals.push('VWAP ' + ta.vwapDist.toFixed(3) + '%');
      }
    }

    // ═══ 4. EMA ALIGNMENT — Trend confirmation ═══
    if (ta && ta.emaAligned) {
      if (ta.emaAligned === 'BULLISH') {
        bullScore += 1;
        signals.push('EMA BULL');
      } else if (ta.emaAligned === 'BEARISH') {
        bearScore += 1;
        signals.push('EMA BEAR');
      } else {
        signals.push('EMA MIX');
      }
    }

    // ═══ 5. RSI — Extremes matter most, direction matters ═══
    if (ta && ta.rsi != null) {
      if (ta.rsi > 70) {
        // Overbought — mean-revert down
        bearScore += 2;
        signals.push('RSI ' + ta.rsi.toFixed(1) + ' OB');
      } else if (ta.rsi < 30) {
        // Oversold — mean-revert up
        bullScore += 2;
        signals.push('RSI ' + ta.rsi.toFixed(1) + ' OS');
      } else {
        // Mid-range: RSI direction matters more than value
        if (ta.rsiDelta > 2) {
          bullScore += 0.5;
          signals.push('RSI RISING');
        } else if (ta.rsiDelta < -2) {
          bearScore += 0.5;
          signals.push('RSI FALLING');
        }
      }
    }

    // ═══ 6. MACD — Crossings and histogram direction ═══
    if (ta && ta.macdHist != null) {
      if (ta.macdCrossing) {
        // Fresh cross = strong signal
        if (ta.macdHist > 0) { bullScore += 1.5; signals.push('MACD BULL X'); }
        else { bearScore += 1.5; signals.push('MACD BEAR X'); }
      } else {
        // Histogram expanding vs contracting
        if (ta.macdHist > 0 && ta.macdHistDelta > 0) {
          bullScore += 0.5;
          signals.push('MACD EXPANDING');
        } else if (ta.macdHist < 0 && ta.macdHistDelta < 0) {
          bearScore += 0.5;
          signals.push('MACD EXPANDING BEAR');
        } else if (ta.macdHist > 0 && ta.macdHistDelta < 0) {
          bearScore += 0.5;
          signals.push('MACD FADING');
        } else if (ta.macdHist < 0 && ta.macdHistDelta > 0) {
          bullScore += 0.5;
          signals.push('MACD RECOVERING');
        }
      }
    }

    // ═══ 7. VOLUME — Confirms or fades moves ═══
    if (ta && ta.volZScore != null) {
      if (ta.volZScore > 2) {
        // High volume confirms the current direction
        if (ta.ret1 > 0) bullScore += 1;
        else bearScore += 1;
        signals.push('VOL SPIKE z=' + ta.volZScore.toFixed(2));
      } else if (ta.volZScore < -1) {
        // Low volume = low conviction, fade the move
        if (state.btcPrice > state.priceToBeat) bearScore += 0.5;
        else bullScore += 0.5;
        signals.push('VOL DRY — FADE');
      }
    }

    // ═══ 8. RECENT CANDLE PATTERN ═══
    if (ta) {
      if (ta.recentBullCandles === 3) {
        bullScore += 0.5;
        signals.push('3 BULL CANDLES');
      } else if (ta.recentBearCandles === 3) {
        bearScore += 0.5;
        signals.push('3 BEAR CANDLES');
      }
    }

    // ═══ 9. MOMENTUM DIRECTION (short-term returns) ═══
    if (ta && ta.ret3 != null) {
      if (ta.ret3 > 0.1) {
        bullScore += 0.5;
      } else if (ta.ret3 < -0.1) {
        bearScore += 0.5;
      }
    }

    // ═══ FINAL DECISION ═══
    // Ties go to market odds direction, not defaulting to UP
    const totalScore = bullScore + bearScore;
    let isUp;
    if (bullScore === bearScore) {
      // Tiebreaker: use market odds
      const up = parseFloat(state.upPct || 50);
      const down = parseFloat(state.downPct || 50);
      isUp = up >= down;
      signals.push('TIE — MARKET DECIDES');
    } else {
      isUp = bullScore > bearScore;
    }
    const margin = Math.abs(bullScore - bearScore);
    const confPct = totalScore > 0 ? (Math.max(bullScore, bearScore) / totalScore * 100) : 50;

    let confLevel, confLabel;
    if (margin >= 3) { confLevel = 'high'; confLabel = 'HIGH'; }
    else if (margin >= 1) { confLevel = 'medium'; confLabel = 'MED'; }
    else { confLevel = 'low'; confLabel = 'LOW'; }

    // Update UI
    els.finalPred.style.display = 'block';
    els.finalPred.className = 'agent-final-pred pred-' + (isUp ? 'up' : 'down');
    if (els.finalIcon) els.finalIcon.textContent = isUp ? '🟢' : '🔴';
    if (els.finalCall) els.finalCall.textContent = isUp ? 'UP' : 'DOWN';
    if (els.finalConf) {
      els.finalConf.textContent = confLabel + ' ' + confPct.toFixed(0) + '%';
      els.finalConf.className = 'agent-final-conf ' + confLevel;
    }
    if (els.finalStatus) els.finalStatus.textContent = 'LOCKED IN';
    if (els.finalPrice) els.finalPrice.textContent = state.btcPrice ? formatPrice(state.btcPrice) : '--';
    if (els.finalSignals) els.finalSignals.textContent = signals.join(' · ');

    // Store for saving at window end
    finalPredDirection = isUp ? 'up' : 'down';
    finalPredPTB = state.priceToBeat;

    console.log('[AGENT] FINAL PREDICTION: ' + (isUp ? 'UP' : 'DOWN') +
      ' | Conf: ' + confLabel + ' ' + confPct.toFixed(1) + '%' +
      ' | Bull: ' + bullScore.toFixed(1) + ' Bear: ' + bearScore.toFixed(1));
  }

  // ═══════════════════════════════════════════
  // FETCH LIVE PREDICTION FROM BOT (single source of truth)
  // ═══════════════════════════════════════════

  let lastPredFetch = 0;

  async function fetchLivePrediction() {
    // Only fetch every 5 seconds to avoid spamming
    var now = Date.now();
    if (now - lastPredFetch < 5000) return;
    lastPredFetch = now;

    try {
      var url = SUPABASE_URL + '/rest/v1/live_prediction?id=eq.1&select=*';
      var res = await fetch(url, { headers: SB_HEADERS });
      if (!res.ok) return;
      var data = await res.json();
      if (!data || data.length === 0) return;

      var pred = data[0];
      if (pred.direction === 'pending' || !pred.direction) {
        // Bot hasn't made prediction yet
        if (els.finalPred) els.finalPred.style.display = 'none';
        if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'flex';
        return;
      }

      // Bot has a prediction — display it
      var isUp = pred.direction === 'over' || pred.direction === 'up';
      finalPredLocked = true;
      finalPredDirection = pred.direction;
      finalPredPTB = pred.ptb;

      if (els.finalPred) {
        els.finalPred.style.display = 'block';
        els.finalPred.className = 'agent-final-pred pred-' + (isUp ? 'up' : 'down');
      }
      if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'none';
      if (els.finalIcon) els.finalIcon.textContent = isUp ? '🟢' : '🔴';
      if (els.finalCall) els.finalCall.textContent = isUp ? 'UP' : 'DOWN';
      if (els.finalConf) {
        els.finalConf.textContent = (pred.confidence || 'MED') + ' ' + (pred.conf_pct ? pred.conf_pct.toFixed(0) + '%' : '--');
        var confLevel = pred.confidence === 'HIGH' ? 'high' : pred.confidence === 'LOW' ? 'low' : 'medium';
        els.finalConf.className = 'agent-final-conf ' + confLevel;
      }
      if (els.finalStatus) els.finalStatus.textContent = 'LOCKED IN';
      if (els.finalPrice) els.finalPrice.textContent = pred.btc_price ? formatPrice(pred.btc_price) : '--';
      if (els.finalSignals) els.finalSignals.textContent = pred.signals || ('Bull: ' + (pred.bull_score || 0).toFixed(1) + ' · Bear: ' + (pred.bear_score || 0).toFixed(1));

    } catch (e) {
      // Silently fail — will retry in 5s
    }
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
      // Bot handles saving predictions — website only displays

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

    // Show analyzing at 3-min mark (<=180s) and show final vote at 2-min mark (<=120s)
    if (left > 180) {
      // More than 3 minutes left: hide both
      if (els.finalPred) els.finalPred.style.display = 'none';
      if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'none';
      finalPredLocked = false;
    } else if (left > 120 && left <= 180) {
      // Between 3 and 2 minutes remaining: show analyzing
      if (els.finalPred) els.finalPred.style.display = 'none';
      if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'flex';
      finalPredLocked = false;
    } else {
      // 2 minutes or less: fetch and show the bot's final prediction
      if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'none';
      if (!finalPredLocked) {
        fetchLivePrediction();
      }
    }
  }

  // ═══════════════════════════════════════════
  // MAIN LOOP
  // ═══════════════════════════════════════════

  let refreshing = false;
  let lastHistoryCount = 0;

  async function refreshHistory() {
    try {
      var history = await fetchHistory();
      if (!history || history.length === lastHistoryCount) return; // no change
      lastHistoryCount = history.length;
      updateHistoryUI(history);
      var record = computeTrackRecord(history);
      updateStatsUI(record);
    } catch (e) {}
  }

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

      // Chart — re-render with latest PTB (price points fed by WebSocket)
      renderChart();

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
    setWsIndicator('reconnecting', 'CONNECTING');
    loadChartHistory();
    connectRTDS();
    refresh();

    // Full refresh every 30 seconds (candles + TA + Polymarket)
    setInterval(refresh, 30000);

    // History + track record poll every 15 seconds
    setInterval(refreshHistory, 15000);

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
