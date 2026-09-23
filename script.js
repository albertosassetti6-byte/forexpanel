/* ==========================================================
   FOREX DASHBOARD — Real-Time Prices + Technical Indicators
   API: biquote.io (REST, CORS enabled)
   Charts: Chart.js 4 + chartjs-chart-financial
   ========================================================== */

// ---------- Configuration ----------
const CONFIG = {
  pair: 'EURUSD',
  refreshMs: 5000,
  candleLimit: 120,
  candleInterval: '1h',
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  stochPeriod: 14,
  stochSmooth: 3,
  apiBase: 'https://biquote.io',
  radarPairs: [
    'EURUSD','USDJPY','GBPUSD','USDCHF','AUDUSD','USDCAD','NZDUSD',
    'XAUUSD','XAGUSD','USOIL',
    'BTCUSD','ETHUSD','XRPUSD','BNBUSD','SOLUSD','ADAUSD','DOGEUSD','LTCUSD'
  ],
};

// ---------- Symbol Metadata ----------
const SYMBOLS = {
  EURUSD: { decimals: 5, label: 'EUR/USD' },
  USDJPY: { decimals: 3, label: 'USD/JPY' },
  GBPUSD: { decimals: 5, label: 'GBP/USD' },
  USDCHF: { decimals: 5, label: 'USD/CHF' },
  AUDUSD: { decimals: 5, label: 'AUD/USD' },
  USDCAD: { decimals: 5, label: 'USD/CAD' },
  NZDUSD: { decimals: 5, label: 'NZD/USD' },
  XAUUSD: { decimals: 2, label: 'XAU/USD' },
  XAGUSD: { decimals: 3, label: 'XAG/USD' },
  USOIL:  { decimals: 2, label: 'USOIL' },
  BTCUSD: { decimals: 2, label: 'BTC/USD' },
  ETHUSD: { decimals: 2, label: 'ETH/USD' },
  XRPUSD: { decimals: 4, label: 'XRP/USD' },
  BNBUSD: { decimals: 2, label: 'BNB/USD' },
  SOLUSD: { decimals: 2, label: 'SOL/USD' },
  ADAUSD: { decimals: 4, label: 'ADA/USD' },
  DOGEUSD: { decimals: 5, label: 'DOGE/USD' },
  LTCUSD: { decimals: 2, label: 'LTC/USD' },
};

function symDecimals(symbol) {
  return SYMBOLS[symbol]?.decimals ?? 5;
}

function fmtPrice(symbol, value) {
  if (value == null || isNaN(value)) return '--';
  return value.toFixed(symDecimals(symbol));
}

// ---------- State ----------
let state = {
  candles: [],
  currentPrice: null,
  prevPrice: null,
  charts: {},
  radarCache: [],
};

// ---------- DOM Refs ----------
const $ = (id) => document.getElementById(id);

// ==========================================================
// API CLIENT — biquote.io REST
// ==========================================================

async function apiFetch(path) {
  const url = `${CONFIG.apiBase}${path}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`biquote ${res.status} ${path}`);
  return res.json();
}

async function fetchTick(pair) {
  const data = await apiFetch(`/api/${encodeURIComponent(pair)}`);
  return {
    price: parseFloat(data.mid),
    bid: data.bid != null ? parseFloat(data.bid) : null,
    ask: data.ask != null ? parseFloat(data.ask) : null,
    dayDiffPercent: data.dayDiffPercent != null ? parseFloat(data.dayDiffPercent) : 0,
    high: data.high != null ? parseFloat(data.high) : null,
    low: data.low != null ? parseFloat(data.low) : null,
    time: data.timestamp || new Date().toISOString(),
  };
}

async function fetchCandles(pair, interval = '1h', limit = 120) {
  const data = await apiFetch(
    `/api/${encodeURIComponent(pair)}/ohlc?interval=${interval}&limit=${limit}`
  );
  const bars = data.bars ?? [];
  return bars.slice().reverse().map(b => ({
    x: new Date(b.openTime).getTime(),
    o: parseFloat(b.open),
    h: parseFloat(b.high),
    l: parseFloat(b.low),
    c: parseFloat(b.close),
    v: b.tickVolume || 0,
  }));
}

// ==========================================================
// TECHNICAL INDICATORS
// ==========================================================

function calcSMA(values, period) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let sum = 0;
    for (let j = 0; j < period; j++) sum += values[i - j];
    out.push(sum / period);
  }
  return out;
}

function calcEMA(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  let ema = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    if (ema === null) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[i - j];
      ema = sum / period;
    } else {
      ema = values[i] * k + ema * (1 - k);
    }
    out.push(ema);
  }
  return out;
}

function calcRSI(closes, period = 14) {
  const out = [];
  if (closes.length < period + 1) return closes.map(() => null);

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out.push(...new Array(period).fill(null));
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = closes.map((_, i) =>
    (emaFast[i] != null && emaSlow[i] != null) ? emaFast[i] - emaSlow[i] : null
  );
  const validMacd = macdLine.filter(v => v != null);
  const signalArr = calcEMA(validMacd, signal);
  const offset = macdLine.findIndex(v => v != null);
  const signalLine = new Array(closes.length).fill(null);
  if (offset >= 0) {
    for (let i = 0; i < signalArr.length; i++) signalLine[offset + i] = signalArr[i];
  }
  const histogram = macdLine.map((v, i) =>
    (v != null && signalLine[i] != null) ? v - signalLine[i] : null
  );
  return { macdLine, signalLine, histogram };
}

function calcStochastic(candles, period = 14, smooth = 3) {
  const kRaw = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { kRaw.push(null); continue; }
    let hh = -Infinity, ll = Infinity;
    for (let j = 0; j < period; j++) {
      hh = Math.max(hh, candles[i - j].h);
      ll = Math.min(ll, candles[i - j].l);
    }
    const close = candles[i].c;
    kRaw.push(hh === ll ? 50 : ((close - ll) / (hh - ll)) * 100);
  }
  const kSmooth = [];
  for (let i = 0; i < kRaw.length; i++) {
    if (kRaw[i] == null) { kSmooth.push(null); continue; }
    const w = kRaw.slice(Math.max(0, i - smooth + 1), i + 1).filter(v => v != null);
    kSmooth.push(w.reduce((a, b) => a + b, 0) / w.length);
  }
  const dLine = [];
  for (let i = 0; i < kSmooth.length; i++) {
    if (kSmooth[i] == null) { dLine.push(null); continue; }
    const w = kSmooth.slice(Math.max(0, i - smooth + 1), i + 1).filter(v => v != null);
    dLine.push(w.reduce((a, b) => a + b, 0) / w.length);
  }
  return { k: kSmooth, d: dLine };
}

// ==========================================================
// CHART.JS
// ==========================================================

const chartColors = {
  accent: '#6b8fc4',
  green: '#5ba88e',
  red: '#c77b7b',
  amber: '#c9a86a',
  grid: 'rgba(226, 232, 240, 0.6)',
  text: '#64748b',
};

function baseChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1e293b',
        titleFont: { size: 11 },
        bodyFont: { size: 11 },
        padding: 8,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        type: 'time',
        time: { unit: 'hour', displayFormats: { hour: 'HH:mm' } },
        grid: { display: false },
        ticks: { color: chartColors.text, font: { size: 10 }, maxTicksLimit: 6 },
      },
      y: {
        grid: { color: chartColors.grid, drawBorder: false },
        ticks: {
          color: chartColors.text,
          font: { size: 10 },
          callback: (v) => Number(v).toFixed(4),
        },
      },
    },
  };
}

function createCandleChart() {
  const ctx = $('candleChart').getContext('2d');
  const opts = baseChartOptions();
  opts.scales.y.ticks.callback = (v) => Number(v).toFixed(4);

  state.charts.candle = new Chart(ctx, {
    type: 'candlestick',
    data: { datasets: [{
      label: 'Price', data: [],
      color: { up: chartColors.green, down: chartColors.red, unchanged: chartColors.amber },
      borderColor: { up: chartColors.green, down: chartColors.red },
    }]},
    options: opts,
  });
}

function createSmaChart() {
  const ctx = $('smaChart').getContext('2d');
  const opts = baseChartOptions();
  opts.scales.y.ticks.callback = (v) => Number(v).toFixed(4);
  opts.scales.x.display = false;
  opts.scales.y.ticks.maxTicksLimit = 4;

  state.charts.sma = new Chart(ctx, {
    type: 'line',
    data: { datasets: [
      { label: 'SMA 20', data: [], borderColor: chartColors.accent, borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
      { label: 'SMA 50', data: [], borderColor: chartColors.amber, borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
    ]},
    options: opts,
  });
}

function createEmaChart() {
  const ctx = $('emaChart').getContext('2d');
  const opts = baseChartOptions();
  opts.scales.y.ticks.callback = (v) => Number(v).toFixed(4);
  opts.scales.x.display = false;
  opts.scales.y.ticks.maxTicksLimit = 4;

  state.charts.ema = new Chart(ctx, {
    type: 'line',
    data: { datasets: [
      { label: 'EMA 12', data: [], borderColor: chartColors.green, borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
      { label: 'EMA 26', data: [], borderColor: chartColors.red, borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
    ]},
    options: opts,
  });
}

function createRsiChart() {
  const ctx = $('rsiChart').getContext('2d');
  const opts = baseChartOptions();
  opts.scales.y.min = 0;
  opts.scales.y.max = 100;
  opts.scales.y.ticks.callback = (v) => v;
  opts.scales.x.display = false;
  opts.scales.y.ticks.maxTicksLimit = 3;

  state.charts.rsi = new Chart(ctx, {
    type: 'line',
    data: { datasets: [{
      label: 'RSI', data: [], borderColor: chartColors.accent, borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: false,
    }]},
    options: opts,
    plugins: [{
      id: 'rsiBands',
      beforeDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        const y70 = scales.y.getPixelForValue(70);
        const y30 = scales.y.getPixelForValue(30);
        ctx.save();
        ctx.strokeStyle = 'rgba(199, 123, 123, 0.3)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(chartArea.left, y70); ctx.lineTo(chartArea.right, y70); ctx.stroke();
        ctx.strokeStyle = 'rgba(91, 168, 142, 0.3)';
        ctx.beginPath(); ctx.moveTo(chartArea.left, y30); ctx.lineTo(chartArea.right, y30); ctx.stroke();
        ctx.restore();
      },
    }],
  });
}

function createMacdChart() {
  const ctx = $('macdChart').getContext('2d');
  const opts = baseChartOptions();
  opts.scales.y.ticks.callback = (v) => Number(v).toFixed(4);
  opts.scales.x.display = false;
  opts.scales.y.ticks.maxTicksLimit = 4;

  state.charts.macd = new Chart(ctx, {
    type: 'bar',
    data: { datasets: [
      { label: 'Histogram', data: [], backgroundColor: [], borderWidth: 0 },
      { label: 'MACD', type: 'line', data: [], borderColor: chartColors.accent, borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
      { label: 'Signal', type: 'line', data: [], borderColor: chartColors.amber, borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
    ]},
    options: opts,
  });
}

function createStochChart() {
  const ctx = $('stochChart').getContext('2d');
  const opts = baseChartOptions();
  opts.scales.y.min = 0;
  opts.scales.y.max = 100;
  opts.scales.y.ticks.callback = (v) => v;
  opts.scales.x.display = false;
  opts.scales.y.ticks.maxTicksLimit = 3;

  state.charts.stoch = new Chart(ctx, {
    type: 'line',
    data: { datasets: [
      { label: '%K', data: [], borderColor: chartColors.accent, borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
      { label: '%D', data: [], borderColor: chartColors.amber, borderWidth: 1.5, pointRadius: 0, tension: 0.3, borderDash: [3, 3] },
    ]},
    options: opts,
    plugins: [{
      id: 'stochBands',
      beforeDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        const y80 = scales.y.getPixelForValue(80);
        const y20 = scales.y.getPixelForValue(20);
        ctx.save();
        ctx.strokeStyle = 'rgba(199, 123, 123, 0.3)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(chartArea.left, y80); ctx.lineTo(chartArea.right, y80); ctx.stroke();
        ctx.strokeStyle = 'rgba(91, 168, 142, 0.3)';
        ctx.beginPath(); ctx.moveTo(chartArea.left, y20); ctx.lineTo(chartArea.right, y20); ctx.stroke();
        ctx.restore();
      },
    }],
  });
}

// ==========================================================
// UI UPDATE
// ==========================================================

function updatePriceCard(tick) {
  const priceEl = $('priceValue');
  const changeEl = $('priceChange');
  const sym = CONFIG.pair;

  priceEl.textContent = fmtPrice(sym, tick.price);
  $('bidValue').textContent = tick.bid ? fmtPrice(sym, tick.bid) : '--';
  $('askValue').textContent = tick.ask ? fmtPrice(sym, tick.ask) : '--';
  $('spreadValue').textContent = (tick.bid && tick.ask) ? fmtPrice(sym, tick.ask - tick.bid) : '--';
  $('highValue').textContent = tick.high ? fmtPrice(sym, tick.high) : '--';
  $('lowValue').textContent = tick.low ? fmtPrice(sym, tick.low) : '--';

  const diff = tick.dayDiffPercent;
  changeEl.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(3) + '%';
  changeEl.className = 'price-change ' + (diff >= 0 ? 'up' : 'down');

  if (state.prevPrice !== null && tick.price !== state.prevPrice) {
    priceEl.style.transition = 'color 0.2s';
    priceEl.style.color = tick.price > state.prevPrice ? chartColors.green : chartColors.red;
    setTimeout(() => { priceEl.style.color = ''; }, 400);
  }
  state.prevPrice = tick.price;
  state.currentPrice = tick.price;
}

function updateAllIndicators(candles) {
  if (!candles || candles.length < 2) return;

  const closes = candles.map(c => c.c);
  const times = candles.map(c => c.x);
  const sym = CONFIG.pair;

  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  $('sma20').textContent = sma20[sma20.length - 1] ? fmtPrice(sym, sma20[sma20.length - 1]) : '--';
  $('sma50').textContent = sma50[sma50.length - 1] ? fmtPrice(sym, sma50[sma50.length - 1]) : '--';
  updateLineChart('sma', [
    times.map((t, i) => ({ x: t, y: sma20[i] })).filter(p => p.y != null),
    times.map((t, i) => ({ x: t, y: sma50[i] })).filter(p => p.y != null),
  ]);

  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  $('ema12').textContent = ema12[ema12.length - 1] ? fmtPrice(sym, ema12[ema12.length - 1]) : '--';
  $('ema26').textContent = ema26[ema26.length - 1] ? fmtPrice(sym, ema26[ema26.length - 1]) : '--';
  updateLineChart('ema', [
    times.map((t, i) => ({ x: t, y: ema12[i] })).filter(p => p.y != null),
    times.map((t, i) => ({ x: t, y: ema26[i] })).filter(p => p.y != null),
  ]);

  const rsi = calcRSI(closes, CONFIG.rsiPeriod);
  const rsiLast = rsi[rsi.length - 1];
  $('rsiValue').textContent = rsiLast ? rsiLast.toFixed(1) : '--';
  let rsiState = 'Neutral';
  if (rsiLast != null) {
    if (rsiLast >= 70) rsiState = 'Overbought';
    else if (rsiLast <= 30) rsiState = 'Oversold';
  }
  $('rsiState').textContent = rsiState;
  updateLineChart('rsi', [times.map((t, i) => ({ x: t, y: rsi[i] })).filter(p => p.y != null)]);

  const macd = calcMACD(closes, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);
  $('macdLine').textContent = macd.macdLine[macd.macdLine.length - 1] != null ? fmtPrice(sym, macd.macdLine[macd.macdLine.length - 1]) : '--';
  $('macdSignal').textContent = macd.signalLine[macd.signalLine.length - 1] != null ? fmtPrice(sym, macd.signalLine[macd.signalLine.length - 1]) : '--';
  $('macdHist').textContent = macd.histogram[macd.histogram.length - 1] != null ? fmtPrice(sym, macd.histogram[macd.histogram.length - 1]) : '--';

  const histPoints = times.map((t, i) => ({
    x: t, y: macd.histogram[i], c: macd.histogram[i] >= 0 ? chartColors.green : chartColors.red,
  })).filter(p => p.y != null);

  const macdChart = state.charts.macd;
  macdChart.data.datasets[0].data = histPoints;
  macdChart.data.datasets[0].backgroundColor = histPoints.map(p => p.c + '99');
  macdChart.data.datasets[1].data = times.map((t, i) => ({ x: t, y: macd.macdLine[i] })).filter(p => p.y != null);
  macdChart.data.datasets[2].data = times.map((t, i) => ({ x: t, y: macd.signalLine[i] })).filter(p => p.y != null);
  macdChart.update('none');

  const stoch = calcStochastic(candles, CONFIG.stochPeriod, CONFIG.stochSmooth);
  const kLast = stoch.k[stoch.k.length - 1];
  const dLast = stoch.d[stoch.d.length - 1];
  $('stochK').textContent = kLast ? kLast.toFixed(1) : '--';
  $('stochD').textContent = dLast ? dLast.toFixed(1) : '--';
  let stochState = 'Neutral';
  if (kLast != null && dLast != null) {
    if (kLast >= 80) stochState = 'Overbought';
    else if (kLast <= 20) stochState = 'Oversold';
    else if (kLast > dLast) stochState = 'Bullish';
    else stochState = 'Bearish';
  }
  $('stochState').textContent = stochState;
  updateLineChart('stoch', [
    times.map((t, i) => ({ x: t, y: stoch.k[i] })).filter(p => p.y != null),
    times.map((t, i) => ({ x: t, y: stoch.d[i] })).filter(p => p.y != null),
  ]);
}

function updateLineChart(chartKey, datasets) {
  const chart = state.charts[chartKey];
  if (!chart) return;
  datasets.forEach((data, i) => {
    if (chart.data.datasets[i]) chart.data.datasets[i].data = data;
  });
  chart.update('none');
}

function updateCandleChart(candles) {
  const chart = state.charts.candle;
  if (!chart) return;
  chart.data.datasets[0].data = candles;
  chart.update('none');
}

// ==========================================================
// RADAR TABLE
// ==========================================================

async function updateRadar() {
  const results = [];

  for (const pair of CONFIG.radarPairs) {
    try {
      const candles = await fetchCandles(pair, '1h', 60);
      if (!candles || candles.length < 20) continue;

      const closes = candles.map(c => c.c);
      const rsiArr = calcRSI(closes, 14);
      const stoch = calcStochastic(candles, 14, 3);
      const rsiLast = rsiArr[rsiArr.length - 1];
      const kLast = stoch.k[stoch.k.length - 1];
      const tick = await fetchTick(pair);

      results.push({
        pair,
        label: SYMBOLS[pair]?.label ?? pair,
        price: tick.price,
        rsi: rsiLast,
        stochK: kLast,
        overbought: rsiLast != null && rsiLast >= 70,
        oversold: rsiLast != null && rsiLast <= 30,
      });
    } catch (e) {
      console.warn(`Radar skip ${pair}:`, e.message);
    }
  }

  const overbought = results.filter(r => r.overbought).sort((a, b) => b.rsi - a.rsi);
  const oversold = results.filter(r => r.oversold).sort((a, b) => a.rsi - b.rsi);
  const neutral = results.filter(r => !r.overbought && !r.oversold);

  const sorted = [...overbought, ...oversold, ...neutral];
  state.radarCache = sorted;

  const tbody = $('radarBody');
  const countEl = $('radarCount');

  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="radar-empty">No data available</td></tr>';
    countEl.textContent = '0 assets';
    return;
  }

  const extreme = sorted.filter(r => r.overbought || r.oversold);
  countEl.textContent = `${extreme.length} signal${extreme.length !== 1 ? 's' : ''}`;

  tbody.innerHTML = sorted.map(r => {
    const isOB = r.overbought;
    const isOS = r.oversold;
    const dotClass = isOB ? 'overbought' : isOS ? 'oversold' : '';
    const sigClass = isOB ? 'overbought' : isOS ? 'oversold' : '';
    const sigLabel = isOB ? 'Overbought' : isOS ? 'Oversold' : 'Neutral';
    const dot = (isOB || isOS) ? `<span class="radar-dot ${dotClass}"></span>` : '<span style="display:inline-block;width:10px;margin-right:6px;"></span>';

    return `<tr>
      <td><strong>${r.label}</strong></td>
      <td>${fmtPrice(r.pair, r.price)}</td>
      <td>${r.rsi != null ? r.rsi.toFixed(1) : '--'}</td>
      <td>${r.stochK != null ? r.stochK.toFixed(1) : '--'}</td>
      <td>${dot} ${sigLabel}</td>
      <td>${(isOB || isOS) ? `<span class="radar-signal ${sigClass}">${sigLabel}</span>` : '—'}</td>
    </tr>`;
  }).join('');
}

// ==========================================================
// MAIN REFRESH CYCLE
// ==========================================================

async function refresh() {
  const btn = $('refreshBtn');
  btn.classList.add('spinning');

  try {
    const tick = await fetchTick(CONFIG.pair);
    updatePriceCard(tick);

    if (!state.candles.length || Date.now() % 3 === 0) {
      const candles = await fetchCandles(CONFIG.pair, CONFIG.candleInterval, CONFIG.candleLimit);
      state.candles = candles;
      updateCandleChart(candles);
      updateAllIndicators(candles);
    }

    $('statusDot').classList.add('live');
    $('statusText').textContent = 'Live';
    $('lastUpdate').textContent = new Date().toLocaleTimeString('en-GB');
  } catch (err) {
    console.error('Refresh error:', err);
    $('statusDot').classList.remove('live');
    $('statusText').textContent = 'Error';
  } finally {
    btn.classList.remove('spinning');
  }
}

async function fullRefresh() {
  await refresh();
  await updateRadar();
}

// ==========================================================
// ASSET SELECTION
// ==========================================================

document.querySelectorAll('.pair-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.pair-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    CONFIG.pair = btn.dataset.pair;
    $('pricePairLabel').textContent = SYMBOLS[CONFIG.pair]?.label ?? btn.querySelector('.pair-name').textContent;
    state.candles = [];
    state.prevPrice = null;

    Object.values(state.charts).forEach(c => c && c.destroy());
    state.charts = {};
    initCharts();
    await refresh();
  });
});

// ==========================================================
// REFRESH BUTTON
// ==========================================================

$('refreshBtn').addEventListener('click', () => {
  fullRefresh();
});

// Keyboard shortcut F5
document.addEventListener('keydown', (e) => {
  if (e.key === 'F5') {
    e.preventDefault();
    fullRefresh();
  }
});

// ==========================================================
// INITIALIZATION
// ==========================================================

function initCharts() {
  createCandleChart();
  createSmaChart();
  createEmaChart();
  createRsiChart();
  createMacdChart();
  createStochChart();
}

async function init() {
  initCharts();
  await fullRefresh();
  setInterval(refresh, CONFIG.refreshMs);
  setInterval(updateRadar, 60000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
