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

  // ═══════════════════════════════════════════
  // ACCESS GATE — Request → Admin approves → Code appears
  // ═══════════════════════════════════════════

  const ACCESS_LS_KEY    = 'vg_access_code';
  const SESSION_LS_KEY   = 'vg_req_session';
  let   pollTimer        = null;

  function isUnlocked() {
    try { return !!localStorage.getItem(ACCESS_LS_KEY); } catch(e) { return false; }
  }

  // Validate stored code against Supabase
  // Returns: 'valid' | 'revoked' | 'deleted'
  async function getCodeStatus() {
    let code;
    try { code = localStorage.getItem(ACCESS_LS_KEY); } catch(e) { return 'deleted'; }
    if (!code) return 'deleted';
    try {
      // Check if code exists at all (no revoked filter)
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/access_codes?code=eq.' + encodeURIComponent(code) + '&select=revoked',
        { headers: SB_HEADERS }
      );
      if (!res.ok) return 'valid'; // network error — stay unlocked
      const data = await res.json();
      if (!data || data.length === 0) {
        // Code truly deleted — clear localStorage
        try { localStorage.removeItem(ACCESS_LS_KEY); } catch(e) {}
        return 'deleted';
      }
      if (data[0].revoked === true) return 'revoked';
      return 'valid';
    } catch(e) { return 'valid'; }
  }

  async function validateStoredCode() {
    const status = await getCodeStatus();
    return status === 'valid';
  }

  // Generate a unique session ID for this browser
  function getOrCreateSession() {
    let sid;
    try { sid = localStorage.getItem(SESSION_LS_KEY); } catch(e) {}
    if (!sid) {
      sid = 'REQ-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      try { localStorage.setItem(SESSION_LS_KEY, sid); } catch(e) {}
    }
    return sid;
  }

  // Submit a request to Supabase
  async function submitRequest(note) {
    const sid = getOrCreateSession();
    const row = { session_id: sid, status: 'pending', note: note || null };
    try {
      // Upsert — if session already requested, update the note
      const res = await fetch(SUPABASE_URL + '/rest/v1/code_requests', {
        method: 'POST',
        headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(await res.text());
      return sid;
    } catch(e) {
      console.error('[AGENT] Request error:', e);
      throw e;
    }
  }

  // Poll Supabase every 5s to check if admin fulfilled the request
  function startPolling(sid) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async function() {
      try {
        const res = await fetch(
          SUPABASE_URL + '/rest/v1/code_requests?session_id=eq.' + encodeURIComponent(sid) + '&select=status,code',
          { headers: SB_HEADERS }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!data || data.length === 0) return;
        const req = data[0];

        if (req.status === 'fulfilled' && req.code) {
          clearInterval(pollTimer);
          showReceivedCode(req.code);
        }
      } catch(e) { /* retry next tick */ }
    }, 5000);
  }

  // Show the code that admin generated — user can copy & paste
  function showReceivedCode(code) {
    const reqView   = document.getElementById('agentReqView');
    const codeView  = document.getElementById('agentCodeReceivedView');
    const codeEl    = document.getElementById('agentReceivedCode');
    const inputEl   = document.getElementById('agentCodeInput');
    if (reqView)  reqView.style.display  = 'none';
    if (codeView) codeView.style.display = 'block';
    if (codeEl)   codeEl.textContent = code;
    // Auto-fill the unlock input
    if (inputEl)  inputEl.value = code;
    setAccessMsg('success', 'Your code is ready! Click Unlock to continue.');
  }

  // Claim and unlock
  async function claimCode(code) {
    const unlockBtn = document.getElementById('agentUnlockBtn');
    if (!code || code.trim() === '') { setAccessMsg('error', 'Please enter your access code.'); return; }
    unlockBtn.disabled = true;
    setAccessMsg('info', 'Verifying...');
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/access_codes?code=eq.' + encodeURIComponent(code.trim().toUpperCase()) + '&claimed=eq.false',
        { headers: SB_HEADERS }
      );
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      if (!data || data.length === 0) {
        setAccessMsg('error', 'Invalid or already used code. Request a new one below.');
        unlockBtn.disabled = false;
        // Clear old session so they can request again
        try { localStorage.removeItem(SESSION_LS_KEY); } catch(e) {}
        clearInterval(pollTimer);
        // Show request form again
        const reqView  = document.getElementById('agentReqView');
        const waitView = document.getElementById('agentWaitView');
        const codeView = document.getElementById('agentCodeReceivedView');
        const reqBtn   = document.getElementById('agentReqBtn');
        if (reqView)  reqView.style.display  = 'block';
        if (waitView) waitView.style.display = 'none';
        if (codeView) codeView.style.display = 'none';
        if (reqBtn)   { reqBtn.disabled = false; reqBtn.textContent = 'Request Access'; }
        return;
      }
      // Mark claimed
      await fetch(
        SUPABASE_URL + '/rest/v1/access_codes?code=eq.' + encodeURIComponent(code.trim().toUpperCase()),
        { method: 'PATCH', headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ claimed: true, claimed_at: new Date().toISOString() }) }
      );
      try { localStorage.setItem(ACCESS_LS_KEY, code.trim().toUpperCase()); } catch(e) {}
      // Clean up request session
      try { localStorage.removeItem(SESSION_LS_KEY); } catch(e) {}
      setAccessMsg('success', 'Access granted! Loading...');
      clearInterval(pollTimer);
      setTimeout(unlockUI, 700);
    } catch (e) {
      setAccessMsg('error', 'Error verifying code. Try again.');
      unlockBtn.disabled = false;
    }
  }

  function setAccessMsg(type, text) {
    const msg = document.getElementById('agentAccessMsg');
    if (!msg) return;
    msg.className = 'agent-access-msg ' + type;
    msg.textContent = text;
  }

  function unlockUI() {
    const gate = document.getElementById('agentAccessGate');
    const wrap = document.getElementById('agentContentWrap');
    if (gate) gate.classList.remove('visible');
    if (wrap) wrap.classList.remove('locked');
    startAgent();
  }

  function showAccessGate() {
    const gate = document.getElementById('agentAccessGate');
    const wrap = document.getElementById('agentContentWrap');
    if (gate) gate.classList.add('visible');
    if (wrap) wrap.classList.add('locked');

    const reqBtn    = document.getElementById('agentReqBtn');
    const unlockBtn = document.getElementById('agentUnlockBtn');
    const input     = document.getElementById('agentCodeInput');
    const noteInput = document.getElementById('agentReqNote');
    const copyBtn   = document.getElementById('agentCopyReceivedBtn');

    // Request button
    if (reqBtn) reqBtn.addEventListener('click', async function() {
      const note = noteInput ? noteInput.value.trim() : '';

      if (!note) {
        setAccessMsg('error', 'Please enter your name or Discord username.');
        return;
      }

      reqBtn.disabled = true;
      reqBtn.textContent = 'Checking...';
      setAccessMsg('info', 'Checking username...');

      // Check if username already exists in requests
      try {
        const checkRes = await fetch(
          SUPABASE_URL + '/rest/v1/code_requests?note=eq.' + encodeURIComponent(note) + '&select=id,status',
          { headers: SB_HEADERS }
        );
        if (checkRes.ok) {
          const existing = await checkRes.json();
          if (existing && existing.length > 0) {
            setAccessMsg('error', 'Username "' + note + '" is already taken. Please use a different name.');
            reqBtn.disabled = false;
            reqBtn.textContent = 'Request Access';
            if (noteInput) { noteInput.focus(); noteInput.select(); }
            return;
          }
        }
      } catch(e) { /* continue if check fails */ }

      reqBtn.textContent = 'Sending...';
      setAccessMsg('info', 'Sending request...');
      try {
        const sid = await submitRequest(note);
        document.getElementById('agentReqView').style.display = 'none';
        document.getElementById('agentWaitView').style.display = 'block';
        setAccessMsg('info', 'Request sent! Waiting for admin to approve...');
        startPolling(sid);
      } catch(e) {
        setAccessMsg('error', 'Failed to send request. Try again.');
        reqBtn.disabled = false;
        reqBtn.textContent = 'Request Access';
      }
    });

    // Unlock button
    if (unlockBtn) unlockBtn.addEventListener('click', function() {
      claimCode(input ? input.value : '');
    });
    if (input) input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') claimCode(input.value);
    });

    // Copy received code
    if (copyBtn) copyBtn.addEventListener('click', function() {
      const codeEl = document.getElementById('agentReceivedCode');
      if (codeEl && codeEl.textContent) {
        navigator.clipboard.writeText(codeEl.textContent).then(function() {
          copyBtn.textContent = '✓ Copied';
          setTimeout(function() { copyBtn.textContent = 'Copy Code'; }, 1500);
        });
      }
    });

    // Check if there's a pending session already
    let existingSid;
    try { existingSid = localStorage.getItem(SESSION_LS_KEY); } catch(e) {}
    if (existingSid) {
      // Resume polling — might already be fulfilled
      document.getElementById('agentReqView').style.display = 'none';
      document.getElementById('agentWaitView').style.display = 'block';
      setAccessMsg('info', 'Waiting for admin approval...');
      startPolling(existingSid);
    }
  }

  // ═══════════════════════════════════════════
  // TIMEFRAME CONFIG
  // ═══════════════════════════════════════════
  const TF_CONFIG = {
    '5m': {
      label:       '5 MIN',
      seconds:     300,
      interval:    '5m',
      source:      'vanguard-bot',
      livePredId:  1,
      subtitle:    'Live BTC 5-minute predictions powered by AI + on-chain data.',
      modelDetail: '5-min BTC Prediction',
      slugPrefix:  'btc-updown-5m-',
    },
    '15m': {
      label:       '15 MIN',
      seconds:     900,
      interval:    '15m',
      source:      'vanguard-bot-15m',
      livePredId:  2,
      subtitle:    'Live BTC 15-minute predictions powered by AI + on-chain data.',
      modelDetail: '15-min BTC Prediction',
      slugPrefix:  'btc-updown-15m-',
    },
    '1h': {
      label:       '1 HOUR',
      seconds:     3600,
      interval:    '1h',
      source:      'vanguard-bot-1h',
      livePredId:  3,
      subtitle:    'Live BTC 1-hour predictions powered by AI + on-chain data.',
      modelDetail: '1-Hour BTC Prediction',
      slugPrefix:  'btc-updown-1h-',
    },
  };

  let activeTF = '5m';

  // Switch timeframe — resets all window state and refreshes
  function switchTimeframe(tf) {
    if (tf === activeTF) return;
    activeTF = tf;
    const cfg = TF_CONFIG[tf];

    // Update tab UI
    document.querySelectorAll('.agent-tf-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tf === tf);
    });

    // Update subtitle and model detail
    const sub = document.getElementById('agentSubtitle');
    const det = document.getElementById('agentModelDetail');
    if (sub) sub.textContent = cfg.subtitle;
    if (det) det.textContent = cfg.modelDetail;

    // Reset all window-level state
    state.priceToBeat        = null;
    state.currentWindowStart = 0;
    state.upPct              = null;
    state.downPct            = null;
    state.wins               = 0;
    state.losses             = 0;
    state.history            = [];
    finalPredLocked          = false;
    finalPredDirection       = null;
    finalPredPTB             = null;
    lastHistoryHash          = '';
    lastHistoryCount         = 0;

    // Hide prediction until new data arrives
    if (els.finalPred)      els.finalPred.style.display      = 'none';
    if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'none';
    if (els.ptb)            els.ptb.textContent              = '--';
    if (els.countdown)      els.countdown.textContent        = '--:--';
    if (els.wins)           els.wins.textContent             = '--';
    if (els.losses)         els.losses.textContent           = '--';
    if (els.winRate)        els.winRate.textContent          = '--%';
    if (els.total)          els.total.textContent            = '--';

    // Reset streak displays
    if (els.allWinStreak)  els.allWinStreak.textContent  = '--';
    if (els.currWinStreak) els.currWinStreak.textContent = '--';
    if (els.allLossStreak) els.allLossStreak.textContent = '--';
    if (els.currLossStreak)els.currLossStreak.textContent= '--';

    // Reset model perf
    if (els.accuracy)  els.accuracy.textContent  = '--';
    if (els.precision) els.precision.textContent = '--';
    if (els.f1)        els.f1.textContent        = '--';
    if (els.rocAuc)    els.rocAuc.textContent    = '--';
    if (els.tp)        els.tp.textContent        = '--';
    if (els.tn)        els.tn.textContent        = '--';
    if (els.fp)        els.fp.textContent        = '--';
    if (els.fn)        els.fn.textContent        = '--';
    if (els.recall)    els.recall.textContent    = '--';

    // Clear history list
    if (els.historyList) els.historyList.innerHTML = '<div class="agent-history-empty">Loading...</div>';

    // Refresh with new timeframe data
    refresh();
    console.log('[AGENT] Switched to timeframe:', tf);
  }

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
      const interval = TF_CONFIG[activeTF].interval;
      const url = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=' + interval + '&limit=100';
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
      const cfg      = TF_CONFIG[activeTF];
      const now      = Math.floor(Date.now() / 1000);
      const interval = cfg.seconds;
      const currentStart = Math.floor(now / interval) * interval;
      const timestamps   = [currentStart, currentStart + interval, currentStart - interval];
      const cacheKey     = 'vg_ptb_' + activeTF + '_' + currentStart;

      let bestMarket = null, bestTs = 0;

      for (const ts of timestamps) {
        const slug      = cfg.slugPrefix + ts;
        const targetUrl = 'https://gamma-api.polymarket.com/markets?slug=' + slug;
        const data      = await fetchWithProxy(targetUrl);
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
      const upPct     = (parseFloat(gammaOdds[0] || 0) * 100).toFixed(1);
      const downPct   = (parseFloat(gammaOdds[1] || 0) * 100).toFixed(1);

      let startingPrice = null, ptbSrc = null;
      if (bestTs === currentStart && bestMarket.startPrice) {
        startingPrice = parseFloat(bestMarket.startPrice);
        if (startingPrice > 0) {
          ptbSrc = 'polymarket';
          try { sessionStorage.setItem(cacheKey, startingPrice.toString()); } catch(e) {}
          console.log('[AGENT][' + activeTF + '] PTB from Polymarket:', startingPrice);
        } else { startingPrice = null; }
      }

      if (!startingPrice) {
        try {
          const saved = sessionStorage.getItem(cacheKey);
          if (saved) { startingPrice = parseFloat(saved); ptbSrc = 'polymarket-cached'; }
        } catch(e) {}
      }

      return {
        startingPrice, ptbSource: ptbSrc, upPct, downPct,
        timeLeft: Math.max(0, (bestTs + interval) - now),
        startTimestamp: bestTs, endTimestamp: bestTs + interval,
      };
    } catch (e) {
      console.error('[AGENT] Polymarket error:', e.message);
    }
    return null;
  }

  // ── Supabase REST: fetch history ──
  async function fetchHistory() {
    try {
      // Each timeframe has its own table
      const tableMap = { '5m': 'predictions', '15m': 'predictions_15m', '1h': 'predictions_1h' };
      const table    = tableMap[activeTF] || 'predictions';
      const source   = TF_CONFIG[activeTF].source;
      const skipSrc  = source + '-skip';

      const url = SUPABASE_URL + '/rest/v1/' + table + '?select=*&order=ts.desc&limit=1000';
      const res = await fetch(url, { headers: SB_HEADERS });
      if (!res.ok) { console.error('[AGENT] History fetch failed:', res.status); return []; }
      const data = await res.json();
      if (!data || data.length === 0) return [];

      // Dedup by ts — real prediction (with end_price) beats skip
      const byTs = {};
      for (const p of data) {
        const ts = Number(p.ts);
        if (!byTs[ts]) {
          byTs[ts] = p;
        } else {
          // Real prediction (has end_price) always beats a skip for same window
          const existing = byTs[ts];
          const pIsReal  = p.end_price != null && !isSkipEntry(p);
          const exIsReal = existing.end_price != null && !isSkipEntry(existing);
          if (pIsReal && !exIsReal) byTs[ts] = p; // replace skip with real
        }
      }
      const deduped = Object.values(byTs).sort((a, b) => b.ts - a.ts);
      console.log('[AGENT][' + activeTF + '] Loaded ' + deduped.length + ' predictions from ' + table);
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

  // ── Compute track record from history — skips excluded ──
  function isSkipEntry(p) {
    if (!p.source) return false;
    return p.source.endsWith('-skip') || p.source === 'vanguard-skip';
  }

  function computeTrackRecord(predictions) {
    let wins = 0, losses = 0;
    for (const p of predictions) {
      if (isSkipEntry(p)) continue;
      if (p.over === null || p.over === undefined || p.end_price === null || p.end_price === undefined || p.ptb === null || p.ptb === undefined) continue;
      const won  = (p.over === true || p.over === 'true' || p.over === 't' || p.over === 1 || p.over === '1');
      const lost = (p.over === false || p.over === 'false' || p.over === 'f' || p.over === 0 || p.over === '0');
      if (won) wins++;
      else if (lost) losses++;
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
    const num = typeof n === 'number' ? n : parseFloat(n);
    if (isNaN(num)) return '--';
    return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      const ptbNum = typeof polyData.startingPrice === 'number' ? polyData.startingPrice : parseFloat(polyData.startingPrice);
      state.priceToBeat = ptbNum;
      ptbSource = polyData.ptbSource || 'polymarket';
      if (els.ptb) els.ptb.textContent = formatPrice(ptbNum);
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
      if (!p.ts) continue;

      var time = new Date(p.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      var row = document.createElement('div');

      // ── SKIP row ──
      if (isSkipEntry(p) || p.over == null) {
        row.className = 'agent-history-item skip';
        row.innerHTML =
          '<span class="agent-history-time">' + time + '</span>' +
          '<span class="agent-history-ptb">' + (p.ptb ? formatPrice(p.ptb) : '--') + '</span>' +
          '<span class="agent-history-dir" style="color:rgba(168,184,176,0.5)">--</span>' +
          '<span class="agent-history-end">--</span>' +
          '<span class="agent-history-result skip">SKIP</span>';
        frag.appendChild(row);
        continue;
      }

      if (p.ptb == null || p.end_price == null) {
        // Prediction made but window not settled yet — show as PENDING
        var pendingDir = p.over == null ? '--' : (p.over === true || p.over === 'true' ? 'UP' : 'DOWN');
        row.className = 'agent-history-item';
        row.innerHTML =
          '<span class="agent-history-time">' + time + '</span>' +
          '<span class="agent-history-ptb">' + (p.ptb ? formatPrice(p.ptb) : '--') + '</span>' +
          '<span class="agent-history-dir" style="color:rgba(200,220,210,0.5)">' + pendingDir + '</span>' +
          '<span class="agent-history-end" style="color:rgba(200,220,210,0.4)">--</span>' +
          '<span class="agent-history-result" style="color:rgba(200,220,210,0.4);font-size:0.7rem;letter-spacing:0.1em;">PENDING</span>';
        frag.appendChild(row);
        continue;
      }

      var ptb = formatPrice(p.ptb);
      var end = formatPrice(p.end_price);

      var actualOver = p.end_price > p.ptb;
      var correct = !!p.over;
      var predictedOver = correct ? actualOver : !actualOver;

      var dir = predictedOver ? 'UP' : 'DOWN';
      var result = correct ? 'WIN' : 'LOSS';
      var resultClass = correct ? 'win' : 'loss';

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
    const arr = predictions.slice()
      .filter(p => p &&
        !isSkipEntry(p) &&
        p.over !== null && p.over !== undefined &&
        (p.over === true || p.over === false || p.over === 'true' || p.over === 'false' || p.over === 't' || p.over === 'f' || p.over === 1 || p.over === 0 || p.over === '1' || p.over === '0')
      )
      .map(p => ({ ts: Number(p.ts), over: (p.over === true || p.over === 'true' || p.over === 't' || p.over === 1 || p.over === '1') }))
      .sort((a, b) => a.ts - b.ts);
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
      if (isSkipEntry(r)) continue;
      if (r.ptb == null || r.end_price == null || r.over == null || r.over === undefined) continue;
      const correct = (r.over === true || r.over === 'true' || r.over === 't' || r.over === 1 || r.over === '1');
      const actualOver = r.end_price > r.ptb;

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

  // ═══════════════════════════════════════════
  // VANGUARD SNIPER ENGINE
  // High-probability setups only — fires 1:30 into window
  // Output: LONG / SHORT / NO TRADE
  // ═══════════════════════════════════════════

  function analyzeFinalPrediction(candles) {
    if (!els.finalPred) return;

    const ta    = state.ta;
    const price = state.btcPrice;
    const ptb   = state.priceToBeat;

    // ── Require minimum data ──
    if (!price || !candles || candles.length < 20) {
      showNoTrade('NO DATA', 'Insufficient data for analysis.');
      return;
    }

    const signals   = [];
    const warnings  = [];
    let bullScore   = 0;
    let bearScore   = 0;
    let noTradeScore = 0;  // accumulates reasons to skip

    const last    = candles.length - 1;
    const curr    = candles[last];
    const prev    = candles[last - 1];
    const currBull = curr.close > curr.open;
    const prevBull = prev.close > prev.open;
    const currRange = (curr.high - curr.low) || 1;
    const prevRange = (prev.high - prev.low) || 1;

    // ═══════════════════════════════════════════════════════════════
    // STEP 1 — MARKET CONDITION FILTER
    // Classify environment before anything else
    // ═══════════════════════════════════════════════════════════════

    // Volatility: ATR-like measure using last 5 candle ranges
    const ranges5   = candles.slice(-5).map(c => c.high - c.low);
    const avgRange5 = ranges5.reduce((a, b) => a + b, 0) / 5;
    const ranges20  = candles.slice(-20).map(c => c.high - c.low);
    const avgRange20 = ranges20.reduce((a, b) => a + b, 0) / 20;
    const volRatioEnv = avgRange5 / (avgRange20 || 1);

    // Trend: slope of closes over 10 and 20 candles
    const c10 = candles.slice(-10).map(c => c.close);
    const c20 = candles.slice(-20).map(c => c.close);
    const slope10 = (c10[9] - c10[0]) / c10[0] * 100;
    const slope20 = (c20[19] - c20[0]) / c20[0] * 100;
    const trendStrength = Math.abs(slope10);

    // Choppiness: how often closes flip direction
    let dirFlips = 0;
    for (let i = last - 8; i <= last - 1; i++) {
      const b1 = candles[i].close > candles[i].open;
      const b2 = candles[i+1].close > candles[i+1].open;
      if (b1 !== b2) dirFlips++;
    }
    const choppy = dirFlips >= 5; // flips 5+ of 8 transitions = ranging/choppy

    // Volume: 5c vs 20c
    const avgVol5  = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
    const avgVol20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    const volEnvRatio = avgVol5 / (avgVol20 || 1);

    // Classify
    let marketCondition;
    if (volEnvRatio < 0.5 || avgVol5 < avgVol20 * 0.5) {
      marketCondition = 'LOW LIQUIDITY';
    } else if (volRatioEnv > 2.5 || currRange > avgRange20 * 2.5) {
      marketCondition = 'HIGH VOLATILITY';
    } else if (choppy || trendStrength < 0.02) {
      marketCondition = 'RANGING';
    } else {
      marketCondition = 'TRENDING';
    }

    signals.push('ENV:' + marketCondition);

    // Apply market condition rules
    if (marketCondition === 'LOW LIQUIDITY') {
      noTradeScore += 6;
      warnings.push('Low liquidity — no trade rule');
    }
    if (marketCondition === 'HIGH VOLATILITY') {
      noTradeScore += 3;
      warnings.push('High volatility — need breakout confirm');
    }
    if (marketCondition === 'RANGING') {
      noTradeScore += 2;
      warnings.push('Ranging/choppy — low edge');
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 2 — MARKET STRUCTURE
    // ═══════════════════════════════════════════════════════════════

    // Break of Structure (BOS) — is the current candle breaking a recent swing?
    const swing5High = Math.max(...candles.slice(-6, -1).map(c => c.high));
    const swing5Low  = Math.min(...candles.slice(-6, -1).map(c => c.low));
    const bosUp   = curr.close > swing5High;  // bullish BOS
    const bosDown = curr.close < swing5Low;   // bearish BOS

    if (bosUp)   { bullScore += 2.5; signals.push('BOS↑'); }
    if (bosDown) { bearScore += 2.5; signals.push('BOS↓'); }

    // Higher highs / lower lows over last 6 candles
    const s = candles.slice(-6);
    const hh = s[5].high > s[4].high && s[4].high > s[3].high;
    const hl = s[5].low  > s[4].low  && s[4].low  > s[3].low;
    const lh = s[5].high < s[4].high && s[4].high < s[3].high;
    const ll = s[5].low  < s[4].low  && s[4].low  < s[3].low;

    if (hh && hl)      { bullScore += 2;   signals.push('HH/HL'); }
    else if (lh && ll) { bearScore += 2;   signals.push('LH/LL'); }
    else if (hh || hl) { bullScore += 0.5; }
    else if (lh || ll) { bearScore += 0.5; }
    else               { noTradeScore += 1; warnings.push('No clear structure'); }

    // Trend slope agreement
    if (Math.sign(slope10) === Math.sign(slope20)) {
      if (slope10 > 0.03)  { bullScore += 1.5; signals.push('TREND↑ ALIGNED'); }
      if (slope10 < -0.03) { bearScore += 1.5; signals.push('TREND↓ ALIGNED'); }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 3 — KEY LEVELS & LIQUIDITY ZONES
    // ═══════════════════════════════════════════════════════════════

    const h20 = Math.max(...candles.slice(-20).map(c => c.high));
    const l20 = Math.min(...candles.slice(-20).map(c => c.low));
    const m20 = (h20 + l20) / 2;

    // Equal highs/lows = liquidity zones (stop hunts likely here)
    const highs = candles.slice(-20).map(c => c.high);
    const lows  = candles.slice(-20).map(c => c.low);
    const equalHighs = highs.filter(h => Math.abs(h - h20) / h20 < 0.001).length >= 3;
    const equalLows  = lows.filter(l => Math.abs(l - l20) / l20 < 0.001).length >= 3;

    if (equalHighs && price > h20 * 0.999) { bearScore += 1.5; signals.push('EQUAL HIGHS LIQZONE'); }
    if (equalLows  && price < l20 * 1.001) { bullScore += 1.5; signals.push('EQUAL LOWS LIQZONE'); }

    // Previous highs/lows as S/R
    if (price > h20 * 1.001) { bullScore += 2; signals.push('20C BREAKOUT↑'); }
    if (price < l20 * 0.999) { bearScore += 2; signals.push('20C BREAKDOWN↓'); }
    if ((h20 - price) / price * 100 < 0.05 && price <= h20) { bearScore += 1.5; signals.push('AT 20C RESIST'); }
    if ((price - l20) / price * 100 < 0.05 && price >= l20) { bullScore += 1.5; signals.push('AT 20C SUPPORT'); }
    if (price > m20) { bullScore += 0.5; } else { bearScore += 0.5; }

    // PTB as critical level
    if (ptb) {
      const diff = price - ptb;
      const pct  = (diff / ptb) * 100;
      if (Math.abs(pct) > 0.1) {
        if (diff > 0) { bullScore += 5; signals.push('PTB +' + pct.toFixed(3) + '% SAFE'); }
        else          { bearScore += 5; signals.push('PTB ' + pct.toFixed(3) + '% SAFE'); }
      } else if (Math.abs(pct) > 0.03) {
        if (diff > 0) { bullScore += 3; signals.push('PTB +' + pct.toFixed(3) + '%'); }
        else          { bearScore += 3; signals.push('PTB ' + pct.toFixed(3) + '%'); }
      } else if (Math.abs(pct) > 0.01) {
        if (diff > 0) { bullScore += 1; signals.push('PTB +' + pct.toFixed(3) + '% THIN'); }
        else          { bearScore += 1; signals.push('PTB ' + pct.toFixed(3) + '% THIN'); }
      } else {
        noTradeScore += 2;
        warnings.push('Price at PTB — coin flip zone');
        signals.push('PTB FLAT');
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 4 — SMART MONEY CONCEPTS
    // ═══════════════════════════════════════════════════════════════

    // Liquidity grab (stop hunt): price spike beyond swing then reversal
    const wickAbove = curr.high > swing5High && curr.close < swing5High; // wick above, closed below
    const wickBelow = curr.low  < swing5Low  && curr.close > swing5Low;  // wick below, closed above
    if (wickAbove) { bearScore += 2; signals.push('LIQ GRAB HIGH→SHORT'); }
    if (wickBelow) { bullScore += 2; signals.push('LIQ GRAB LOW→LONG'); }

    // Fair Value Gap (FVG): gap between candle[i-2].high and candle[i].low (bullish)
    // or candle[i-2].low and candle[i].high (bearish)
    if (last >= 2) {
      const c0 = candles[last - 2];
      const c2 = curr;
      const bullFVG = c0.high < c2.low;   // gap up = bullish imbalance
      const bearFVG = c0.low  > c2.high;  // gap down = bearish imbalance
      if (bullFVG && price >= c0.high && price <= c2.low) { bullScore += 2; signals.push('BULL FVG'); }
      if (bearFVG && price <= c0.low  && price >= c2.high){ bearScore += 2; signals.push('BEAR FVG'); }
    }

    // Order block: last strong opposite-direction candle before current move
    // Bullish OB: last bearish candle before current bull run
    // Bearish OB: last bullish candle before current bear run
    let lastBearIdx = -1, lastBullIdx = -1;
    for (let i = last - 1; i >= Math.max(0, last - 8); i--) {
      if (lastBearIdx === -1 && candles[i].close < candles[i].open) lastBearIdx = i;
      if (lastBullIdx === -1 && candles[i].close > candles[i].open) lastBullIdx = i;
    }
    // Price trading into bullish order block
    if (lastBearIdx > -1 && currBull) {
      const ob = candles[lastBearIdx];
      if (price >= ob.low && price <= ob.high) { bullScore += 1.5; signals.push('BULL ORDER BLOCK'); }
    }
    // Price trading into bearish order block
    if (lastBullIdx > -1 && !currBull) {
      const ob = candles[lastBullIdx];
      if (price >= ob.low && price <= ob.high) { bearScore += 1.5; signals.push('BEAR ORDER BLOCK'); }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 5 — CANDLESTICK PATTERNS
    // ═══════════════════════════════════════════════════════════════

    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(curr.close - curr.open);
    const pUp = (prev.high - Math.max(prev.open, prev.close)) / prevRange;
    const pLo = (Math.min(prev.open, prev.close) - prev.low) / prevRange;
    const cUp = (curr.high - Math.max(curr.open, curr.close)) / currRange;
    const cLo = (Math.min(curr.open, curr.close) - curr.low) / currRange;

    // Engulfing (strong reversal)
    if (currBull && !prevBull && curr.open <= prev.close && curr.close >= prev.open && currBody > prevBody * 1.1)
      { bullScore += 3; signals.push('BULL ENGULF'); }
    if (!currBull && prevBull && curr.open >= prev.close && curr.close <= prev.open && currBody > prevBody * 1.1)
      { bearScore += 3; signals.push('BEAR ENGULF'); }

    // Hammer / Shooting star
    if (pLo > 0.6 && pUp < 0.2) { bullScore += 1.5; signals.push('HAMMER'); }
    if (pUp > 0.6 && pLo < 0.2) { bearScore += 1.5; signals.push('SHOOT STAR'); }

    // Wick rejection = strong
    if (cUp > 0.65) { bearScore += 2; signals.push('UPPER WICK REJECT'); }
    if (cLo > 0.65) { bullScore += 2; signals.push('LOWER WICK REJECT'); }

    // Doji on prev = follow current
    if (prevBody / prevRange < 0.15) {
      if (currBull) { bullScore += 1; signals.push('DOJI→BULL'); }
      else          { bearScore += 1; signals.push('DOJI→BEAR'); }
    }

    // Candle too large = late entry risk
    if (currRange > avgRange20 * 2) {
      noTradeScore += 2;
      warnings.push('Candle too large — late entry risk');
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 6 — INDICATORS (confirmation only)
    // ═══════════════════════════════════════════════════════════════

    // VWAP bias
    if (ta && ta.vwapDist != null) {
      if (ta.vwapDist > 0.05)       { bullScore += 1.5; signals.push('ABOVE VWAP'); }
      else if (ta.vwapDist < -0.05) { bearScore += 1.5; signals.push('BELOW VWAP'); }
    }

    // EMA alignment
    if (ta && ta.emaAligned) {
      if (ta.emaAligned === 'BULLISH')      { bullScore += 1; signals.push('EMA BULL STACK'); }
      else if (ta.emaAligned === 'BEARISH') { bearScore += 1; signals.push('EMA BEAR STACK'); }
      else { noTradeScore += 0.5; }
      if (ta.ema9Slope > 0.01)       { bullScore += 0.5; }
      else if (ta.ema9Slope < -0.01) { bearScore += 0.5; }
    }

    // RSI — divergence logic, not just extremes
    if (ta && ta.rsi != null) {
      const rsiVal = ta.rsi;
      // Regular divergence: price HH but RSI LH = bearish div
      if (hh && ta.rsiDelta < -1) { bearScore += 2; signals.push('BEAR RSI DIV'); }
      // Regular divergence: price LL but RSI HL = bullish div
      if (ll && ta.rsiDelta > 1)  { bullScore += 2; signals.push('BULL RSI DIV'); }
      // Extremes
      if (rsiVal > 75)           { bearScore += 2; signals.push('RSI OB ' + rsiVal.toFixed(0)); }
      else if (rsiVal < 25)      { bullScore += 2; signals.push('RSI OS ' + rsiVal.toFixed(0)); }
      else if (ta.rsiDelta > 2)  { bullScore += 0.5; }
      else if (ta.rsiDelta < -2) { bearScore += 0.5; }
    }

    // MACD
    if (ta && ta.macdHist != null) {
      if (ta.macdCrossing) {
        if (ta.macdHist > 0) { bullScore += 1.5; signals.push('MACD BULL X'); }
        else                 { bearScore += 1.5; signals.push('MACD BEAR X'); }
      } else {
        if (ta.macdHist > 0 && ta.macdHistDelta > 0)      { bullScore += 0.5; }
        else if (ta.macdHist < 0 && ta.macdHistDelta < 0) { bearScore += 0.5; }
        else if (ta.macdHist > 0 && ta.macdHistDelta < 0) { bearScore += 0.5; signals.push('MACD FADING'); noTradeScore += 0.5; }
        else if (ta.macdHist < 0 && ta.macdHistDelta > 0) { bullScore += 0.5; }
      }
    }

    // Volume confirmation
    if (ta && ta.volZScore != null) {
      if (ta.volZScore > 2) {
        if (ta.ret1 > 0) { bullScore += 1.5; signals.push('VOL SPIKE BULL'); }
        else             { bearScore += 1.5; signals.push('VOL SPIKE BEAR'); }
      } else if (ta.volZScore < -1.5) {
        noTradeScore += 1.5;
        warnings.push('Volume drying up — low conviction');
        signals.push('VOL DRY');
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 7 — SENTIMENT & POSITIONING (Polymarket)
    // ═══════════════════════════════════════════════════════════════

    if (state.upPct && state.downPct) {
      const up = parseFloat(state.upPct);
      const dn = parseFloat(state.downPct);

      // Contrarian logic: crowd too one-sided = fade them
      if (up > 75) {
        // Crowd heavily long → contrarian SHORT signal
        bearScore += 1.5;
        signals.push('CROWD LONG ' + up + '%→CONTRA SHORT');
      } else if (dn > 75) {
        bullScore += 1.5;
        signals.push('CROWD SHORT ' + dn + '%→CONTRA LONG');
      } else if (up > 60) {
        bullScore += 2;
        signals.push('MKT UP ' + up + '%');
      } else if (dn > 60) {
        bearScore += 2;
        signals.push('MKT DOWN ' + dn + '%');
      } else if (up > 52) {
        bullScore += 1;
        signals.push('MKT LEAN UP');
      } else if (dn > 52) {
        bearScore += 1;
        signals.push('MKT LEAN DOWN');
      } else {
        noTradeScore += 1;
        warnings.push('Market split — no edge from sentiment');
      }
    }

    // Momentum exhaustion check
    if (ta) {
      // Weighted momentum
      const r1 = (candles[last].close   - candles[last-1].close) / candles[last-1].close * 100;
      const r2 = (candles[last-1].close - candles[last-2].close) / candles[last-2].close * 100;
      const r3 = (candles[last-2].close - candles[last-3].close) / candles[last-3].close * 100;
      const wm = (r1 * 3 + r2 * 2 + r3) / 6;
      if (wm > 0.05)       { bullScore += 1.5; signals.push('MOM +' + wm.toFixed(3) + '%'); }
      else if (wm < -0.05) { bearScore += 1.5; signals.push('MOM ' + wm.toFixed(3) + '%'); }

      // Streak exhaustion
      let streak = 0, streakDir = null;
      for (let i = last; i >= Math.max(0, last - 7); i--) {
        const b = candles[i].close > candles[i].open;
        if (streakDir === null) streakDir = b;
        if (b !== streakDir) break;
        streak++;
      }
      if (streak >= 5) {
        if (streakDir) { bearScore += 2; signals.push(streak + ' BULL STREAK EXHAUSTION'); }
        else           { bullScore += 2; signals.push(streak + ' BEAR STREAK EXHAUSTION'); }
        warnings.push('Streak exhaustion — mean reversion risk');
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 8 — CONFLICT CHECK
    // If signals are significantly mixed → NO TRADE
    // ═══════════════════════════════════════════════════════════════

    const totalScore  = bullScore + bearScore;
    const margin      = Math.abs(bullScore - bearScore);
    const confPct     = totalScore > 0 ? (Math.max(bullScore, bearScore) / totalScore * 100) : 50;

    // Conflicting signals check
    if (bullScore > 0 && bearScore > 0) {
      const conflictRatio = Math.min(bullScore, bearScore) / Math.max(bullScore, bearScore);
      if (conflictRatio > 0.7) {
        noTradeScore += 3;
        warnings.push('Signals heavily conflicting (' + (conflictRatio * 100).toFixed(0) + '% conflict)');
      } else if (conflictRatio > 0.5) {
        noTradeScore += 1.5;
        warnings.push('Mixed signals — reduced confidence');
      }
    }

    // Risk:Reward check — only trade if clear edge
    if (margin < 2) {
      noTradeScore += 2;
      warnings.push('Insufficient signal edge (margin ' + margin.toFixed(1) + ')');
    }

    // ═══════════════════════════════════════════════════════════════
    // STEP 9 — FINAL DECISION
    // ═══════════════════════════════════════════════════════════════

    const isLong   = bullScore > bearScore;
    const direction = bullScore > bearScore ? 'UP' : 'DOWN';

    // NO TRADE conditions
    const noTrade = noTradeScore >= 4 || margin < 1.5 || confPct < 57;

    let confLabel, confLevel;
    if (margin >= 6)      { confLabel = 'HIGH';   confLevel = 'high'; }
    else if (margin >= 3) { confLabel = 'MEDIUM'; confLevel = 'medium'; }
    else                  { confLabel = 'LOW';    confLevel = 'low'; }

    // Entry / SL / TP calculation
    const entryZone = price ? '$' + price.toFixed(2) : '--';
    const slDist    = ptb ? Math.abs(price - ptb) * 1.2 : (price * 0.001);
    const tpDist    = slDist * 2;  // minimum 1:2 R:R
    const sl = price ? '$' + (isLong ? price - slDist : price + slDist).toFixed(2) : '--';
    const tp = price ? '$' + (isLong ? price + tpDist : price - tpDist).toFixed(2) : '--';

    console.log('[AGENT] SNIPER: ' + (noTrade ? 'NO TRADE' : direction) +
      ' | Env:' + marketCondition + ' | Conf:' + confLabel +
      ' | Bull:' + bullScore.toFixed(1) + ' Bear:' + bearScore.toFixed(1) +
      ' | NoTrade:' + noTradeScore.toFixed(1) +
      '\n[AGENT] Signals: ' + signals.join(' · ') +
      (warnings.length ? '\n[AGENT] Warnings: ' + warnings.join(' · ') : ''));

    if (noTrade) {
      showNoTrade(marketCondition, warnings.join(' · ') || 'No high-probability setup detected.');
      finalPredDirection = null;
      finalPredPTB       = ptb;
      finalPredLocked    = true;
      return;
    }

    // ── Render prediction ──
    els.finalPred.style.display = 'block';
    els.finalPred.className     = 'agent-final-pred pred-' + (isLong ? 'up' : 'down');
    if (els.finalIcon)    els.finalIcon.textContent    = isLong ? '🟢' : '🔴';
    if (els.finalCall)    els.finalCall.textContent    = isLong ? 'UP' : 'DOWN';
    if (els.finalConf) {
      els.finalConf.textContent = confLabel + ' ' + confPct.toFixed(0) + '%';
      els.finalConf.className   = 'agent-final-conf ' + confLevel;
    }
    if (els.finalStatus)  els.finalStatus.textContent  = marketCondition + ' · LOCKED';
    if (els.finalPrice)   els.finalPrice.textContent   = entryZone;
    if (els.finalSignals) els.finalSignals.textContent =
      'Entry: ' + entryZone + ' | SL: ' + sl + ' | TP: ' + tp +
      ' · ' + signals.join(' · ');

    finalPredDirection = isLong ? 'up' : 'down';
    finalPredPTB       = ptb;
    finalPredLocked    = true;
  }

  // ── Show NO TRADE state ──
  function showNoTrade(condition, reason) {
    if (!els.finalPred) return;
    els.finalPred.style.display = 'block';
    els.finalPred.className     = 'agent-final-pred pred-neutral';
    if (els.finalIcon)    els.finalIcon.textContent    = '🚫';
    if (els.finalCall)    els.finalCall.textContent    = 'NO TRADE';
    if (els.finalConf) {
      els.finalConf.textContent = 'SKIP';
      els.finalConf.className   = 'agent-final-conf low';
    }
    if (els.finalStatus)  els.finalStatus.textContent  = condition || 'NO EDGE';
    if (els.finalPrice)   els.finalPrice.textContent   = state.btcPrice ? formatPrice(state.btcPrice) : '--';
    if (els.finalSignals) els.finalSignals.textContent = reason || 'No high-probability setup.';
    console.log('[AGENT] NO TRADE — ' + (condition || '') + ': ' + (reason || ''));

    // Save skip to Supabase so it appears in history
    saveSkip(condition, reason);
  }

  // ── Save a SKIP entry to Supabase predictions ──
  async function saveSkip(condition, reason) {
    const tableMap    = { '5m': 'predictions', '15m': 'predictions_15m', '1h': 'predictions_1h' };
    const table       = tableMap[activeTF] || 'predictions';
    const winSecs     = TF_CONFIG[activeTF].seconds;
    const now         = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / winSecs) * winSecs;
    const row = {
      ts:        windowStart,
      ptb:       state.priceToBeat || null,
      end_price: null,
      over:      null,
      source:    TF_CONFIG[activeTF].source + '-skip',
    };
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
        method: 'POST',
        headers: {
          ...SB_HEADERS,
          'Prefer': 'resolution=ignore-duplicates', // ignore if already exists
        },
        body: JSON.stringify(row),
      });
      // 201 = created, 200 = ok, both fine. Ignore 409 duplicate conflicts.
      if (!res.ok && res.status !== 409) {
        const txt = await res.text();
        console.warn('[AGENT] Skip save failed:', res.status, txt);
      } else {
        console.log('[AGENT][' + activeTF + '] Skip saved for window', windowStart);
      }
    } catch (e) {
      console.error('[AGENT] Skip save error:', e.message);
    }
  }


  // ═══════════════════════════════════════════
  // FETCH LIVE PREDICTION FROM BOT (single source of truth)
  // ═══════════════════════════════════════════

  let lastPredFetch = 0;

  async function fetchLivePrediction() {
    var now = Date.now();
    if (now - lastPredFetch < 5000) return;
    lastPredFetch = now;

    try {
      var predId = TF_CONFIG[activeTF].livePredId;
      var url    = SUPABASE_URL + '/rest/v1/live_prediction?id=eq.' + predId + '&select=*';
      var res    = await fetch(url, { headers: SB_HEADERS });
      if (!res.ok) return;
      var data = await res.json();
      if (!data || data.length === 0) return;

      var pred = data[0];
      if (pred.direction === 'pending' || !pred.direction) {
        if (els.finalPred)      els.finalPred.style.display      = 'none';
        if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'flex';
        return;
      }

      // Bot has a prediction — display it
      var isUp = pred.direction === 'over' || pred.direction === 'up';
      finalPredLocked = true;
      finalPredDirection = pred.direction;
      finalPredPTB = pred.ptb ? parseFloat(pred.ptb) : null;

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
    const cfg        = TF_CONFIG[activeTF];
    const winSecs    = cfg.seconds;
    const now        = Math.floor(Date.now() / 1000);
    const windowEnd  = (Math.floor(now / winSecs) + 1) * winSecs;
    const windowStart = windowEnd - winSecs;
    const left       = windowEnd - now;
    const mins       = Math.floor(left / 60);
    const secs       = left % 60;
    els.countdown.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;

    // New window detected — reset prediction state
    if (state.currentWindowStart !== windowStart) {
      state.currentWindowStart = windowStart;
      state.priceToBeat  = null;
      ptbSource          = '';
      finalPredLocked    = false;
      finalPredDirection = null;
      finalPredPTB       = null;
      if (els.finalPred) els.finalPred.style.display = 'none';
      setTimeout(refresh, 500);
    }

    // Prediction timing — fire at different points per timeframe
    // 5m:  spinner at 1:00 in (210s left), lock at 1:30 in (195s left)
    // 15m: spinner at 11:15 in (225s left), lock at 12:00 in (180s left)
    // 1h:  spinner at 48:00 in (720s left), lock at 50:00 in (600s left)
    const timingMap = {
      '5m':  { analyze: 210, lock: 195 },
      '15m': { analyze: 225, lock: 180 },
      '1h':  { analyze: 720, lock: 600 },
    };
    const timing         = timingMap[activeTF] || timingMap['5m'];
    const analyzeThreshold = timing.analyze;
    const lockThreshold    = timing.lock;

    if (left > analyzeThreshold) {
      if (els.finalPred)      els.finalPred.style.display      = 'none';
      if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'none';
      finalPredLocked = false;
    } else if (left > lockThreshold && left <= analyzeThreshold) {
      if (els.finalPred)      els.finalPred.style.display      = 'none';
      if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'flex';
      finalPredLocked = false;
    } else {
      if (els.finalAnalyzing) els.finalAnalyzing.style.display = 'none';
      if (!finalPredLocked) {
        if (activeTF === '5m') {
          // 5m uses browser-side sniper engine
          analyzeFinalPrediction(window._lastCandles || null);
        } else {
          // 15m and 1h read from bot's live_prediction in Supabase
          fetchLivePrediction();
        }
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
        window._lastCandles = candles; // store for sniper engine
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

    // For 15m and 1h — also fetch the bot's live prediction from Supabase
    if (activeTF !== '5m') {
      try { await fetchLivePrediction(); } catch(e) {}
    }

    refreshing = false;
  }

  // ── Init ──
  function init() {
    if (!els.btcPrice) return;

    // Inject SKIP row style
    const skipStyle = document.createElement('style');
    skipStyle.textContent = '.agent-history-result.skip { color: rgba(168,184,176,0.45); font-size: 0.72rem; letter-spacing: 0.08em; } .agent-history-item.skip { opacity: 0.55; }';
    document.head.appendChild(skipStyle);

    // Validate access — check Supabase so deleted/revoked codes get blocked
    if (!isUnlocked()) {
      showAccessGate();
      return;
    }

    // Has a code in localStorage — verify it's still valid
    getCodeStatus().then(function(status) {
      if (status === 'valid') {
        unlockUI();
      } else {
        // Deleted or revoked
        if (status === 'deleted') {
          showAccessGate();
          setAccessMsg('error', 'Your access code is no longer valid. Please request a new one.');
        } else {
          showAccessGate();
          // Show revoked view immediately
          const reqView  = document.getElementById('agentReqView');
          const revView  = document.getElementById('agentRevokedView');
          const unlockSec = document.querySelector('.agent-access-enter');
          if (reqView)  reqView.style.display  = 'none';
          if (unlockSec) unlockSec.style.display = 'none';
          if (revView)  revView.style.display  = 'block';
          setAccessMsg('error', '🚫 Your access has been revoked. Contact the admin.');
          const pingBtn = document.getElementById('agentPingBtn');
          if (pingBtn) pingBtn.addEventListener('click', pingAdmin);
        }
      }
    });
  }

  // ── Send ping to admin ──
  async function pingAdmin() {
    let code;
    try { code = localStorage.getItem(ACCESS_LS_KEY); } catch(e) {}
    if (!code) return;
    const pingBtn = document.getElementById('agentPingBtn');
    if (pingBtn) { pingBtn.disabled = true; pingBtn.textContent = 'Pinging...'; }
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/access_codes?code=eq.' + encodeURIComponent(code),
        {
          method: 'PATCH',
          headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ pinged: true, pinged_at: new Date().toISOString() }),
        }
      );
      if (!res.ok) throw new Error(res.status);
      if (pingBtn) {
        pingBtn.textContent = '✓ Admin Pinged!';
        pingBtn.style.borderColor = 'rgba(76,201,138,0.4)';
        pingBtn.style.color = '#4cc98a';
      }
    } catch(e) {
      console.error('[AGENT] Ping failed:', e);
      if (pingBtn) { pingBtn.disabled = false; pingBtn.textContent = '🔔 Ping Admin'; }
    }
  }

  function startAgent() {
    setStatus('connecting', 'CONNECTING...');
    setWsIndicator('reconnecting', 'CONNECTING');
    loadChartHistory();
    connectRTDS();
    refresh();
    setInterval(refresh, 30000);
    setInterval(refreshHistory, 15000);
    setInterval(updateCountdown, 1000);
    updateCountdown();

    // ── Timeframe tab switcher ──
    document.querySelectorAll('.agent-tf-tab').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchTimeframe(btn.dataset.tf);
      });
    });

    // ── Realtime access check every 10 seconds ──
    let isRevoked = false;
    setInterval(async function() {
      const status = await getCodeStatus();

      if (status !== 'valid' && !isRevoked) {
        // Just got revoked or deleted — lock everything
        isRevoked = true;
        if (rtdsWs) { try { rtdsWs.close(); } catch(e) {} rtdsWs = null; }
        clearInterval(pollTimer);

        const wrap = document.getElementById('agentContentWrap');
        const gate = document.getElementById('agentAccessGate');
        if (wrap) wrap.classList.add('locked');
        if (gate) gate.classList.add('visible');

        const reqView       = document.getElementById('agentReqView');
        const waitView      = document.getElementById('agentWaitView');
        const codeView      = document.getElementById('agentCodeReceivedView');
        const unlockSection = document.querySelector('.agent-access-enter');
        if (reqView)        reqView.style.display        = 'none';
        if (waitView)       waitView.style.display       = 'none';
        if (codeView)       codeView.style.display       = 'none';
        if (unlockSection)  unlockSection.style.display  = 'none';

        const revokedView = document.getElementById('agentRevokedView');
        if (revokedView) revokedView.style.display = 'block';
        setAccessMsg('error', '🚫 Your access has been revoked by the admin.');

        // Wire ping button
        const pingBtn = document.getElementById('agentPingBtn');
        if (pingBtn) {
          pingBtn.replaceWith(pingBtn.cloneNode(true)); // remove old listeners
          document.getElementById('agentPingBtn').addEventListener('click', pingAdmin);
        }

        console.log('[AGENT] Access revoked — section locked.');

      } else if (status === 'valid' && isRevoked) {
        // Admin reinstated — auto-unlock without re-entering code
        isRevoked = false;
        console.log('[AGENT] Access reinstated — auto-unlocking.');

        const wrap = document.getElementById('agentContentWrap');
        const gate = document.getElementById('agentAccessGate');
        if (wrap) wrap.classList.remove('locked');
        if (gate) gate.classList.remove('visible');

        // Reset gate views
        const revokedView   = document.getElementById('agentRevokedView');
        const reqView       = document.getElementById('agentReqView');
        const unlockSection = document.querySelector('.agent-access-enter');
        if (revokedView)    revokedView.style.display   = 'none';
        if (reqView)        reqView.style.display       = 'block';
        if (unlockSection)  unlockSection.style.display = 'flex';

        // Restart feeds
        connectRTDS();
        refresh();
      }
    }, 10000);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();