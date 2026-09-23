/* ==========================================================
   FOREX DASHBOARD — Real-Time Prices + Technical Indicators
   ========================================================== */

const CONFIG = {
  pair: 'EURUSD',
  refreshMs: 5000,
  candleLimit: 60,
  candleInterval: '1h',
  rsiPeriod: 14,
  apiBase: 'https://biquote.io',
  radarPairs: ['EURUSD','USDJPY','GBPUSD','USDCHF','AUDUSD','USDCAD','NZDUSD','XAUUSD','BTCUSD','ETHUSD']
};

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
  LTCUSD: { decimals: 2, label: 'LTC/USD' }
};

let state = {
  candles: [],
  charts: {}
};

const $ = (id) => document.getElementById(id);

function fmtPrice(symbol, value) {
  if (value == null || isNaN(value)) return '--';
  const dec = SYMBOLS[symbol]?.decimals ?? 4;
  return value.toFixed(dec);
}

// Fallback Mock Generator in case API fails or CORS blocks
function generateMockCandles(count = 60) {
  const bars = [];
  let basePrice = CONFIG.pair.includes('JPY') ? 150.0 : CONFIG.pair.includes('BTC') ? 60000.0 : 1.0850;
  let now = Date.now() - count * 3600 * 1000;

  for (let i = 0; i < count; i++) {
    let open = basePrice + (Math.random() - 0.5) * (basePrice * 0.002);
    let high = open + Math.random() * (basePrice * 0.002);
    let low = open - Math.random() * (basePrice * 0.002);
    let close = (high + low) / 2;
    bars.push({ x: now + i * 3600 * 1000, o: open, h: high, l: low, c: close });
    basePrice = close;
  }
  return bars;
}

async function fetchTick(pair) {
  try {
    const res = await fetch(`${CONFIG.apiBase}/api/${encodeURIComponent(pair)}`);
    if(!res.ok) throw new Error('Network response error');
    const data = await res.json();
    return {
      price: parseFloat(data.mid),
      bid: parseFloat(data.bid),
      ask: parseFloat(data.ask),
      dayDiffPercent: parseFloat(data.dayDiffPercent || 0),
      high: parseFloat(data.high),
      low: parseFloat(data.low)
    };
  } catch (e) {
    const mockLast = state.candles[state.candles.length - 1]?.c || 1.0850;
    return { price: mockLast, bid: mockLast - 0.0001, ask: mockLast + 0.0001, dayDiffPercent: 0.12, high: mockLast * 1.002, low: mockLast * 0.998 };
  }
}

async function fetchCandles(pair) {
  try {
    const res = await fetch(`${CONFIG.apiBase}/api/${encodeURIComponent(pair)}/ohlc?interval=1h&limit=60`);
    if(!res.ok) throw new Error('Candle fetch error');
    const data = await res.json();
    if (!data.bars) return generateMockCandles(60);
    return data.bars.slice().reverse().map(b => ({
      x: new Date(b.openTime).getTime(),
      o: parseFloat(b.open),
      h: parseFloat(b.high),
      l: parseFloat(b.low),
      c: parseFloat(b.close)
    }));
  } catch (e) {
    return generateMockCandles(60);
  }
}

// Indicator Calculations
function calcSMA(values, period) {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const slice = values.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calcEMA(values, period) {
  const k = 2 / (period + 1);
  let ema = null;
  return values.map((v, i) => {
    if (i < period - 1) return null;
    if (ema === null) {
      ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      ema = v * k + ema * (1 - k);
    }
    return ema;
  });
}

function calcRSI(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    let diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < closes.length; i++) {
    let diff = closes[i] - closes[i - 1];
    let gain = diff > 0 ? diff : 0;
    let loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return out;
}

// Charts Initialization
function initCharts() {
  const commonOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { x: { display: false }, y: { ticks: { font: { size: 9 } } } }
  };

  // Candle Chart
  state.charts.candle = new Chart($('candleChart').getContext('2d'), {
    type: 'line',
    data: { datasets: [{ label: 'Price', data: [], borderColor: '#6b8fc4', borderWidth: 1.5, pointRadius: 0 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { type: 'time', time: { unit: 'hour' }, ticks: { font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } } }
      }
    }
  });

  // Mini Charts
  ['sma', 'ema', 'rsi', 'macd', 'stoch'].forEach(key => {
    state.charts[key] = new Chart($(key + 'Chart').getContext('2d'), {
      type: 'line',
      data: { datasets: [{ data: [], borderColor: '#6b8fc4', borderWidth: 1.5, pointRadius: 0 }] },
      options: commonOpts
    });
  });
}

async function refresh() {
  try {
    const tick = await fetchTick(CONFIG.pair);
    $('priceValue').textContent = fmtPrice(CONFIG.pair, tick.price);$('bidValue').textContent = fmtPrice(CONFIG.pair, tick.bid);
    $('askValue').textContent = fmtPrice(CONFIG.pair, tick.ask);$('spreadValue').textContent = fmtPrice(CONFIG.pair, tick.ask - tick.bid);
    $('highValue').textContent = fmtPrice(CONFIG.pair, tick.high);$('lowValue').textContent = fmtPrice(CONFIG.pair, tick.low);

    const changeEl = $('priceChange');
    changeEl.textContent = (tick.dayDiffPercent >= 0 ? '+' : '') + tick.dayDiffPercent.toFixed(2) + '%';
    changeEl.className = 'price-change ' + (tick.dayDiffPercent >= 0 ? 'up' : 'down');

    const candles = await fetchCandles(CONFIG.pair);
    state.candles = candles;

    const closes = candles.map(c => c.c);
    const times = candles.map(c => c.x);

    // Update Main Chart
    state.charts.candle.data.datasets[0].data = candles.map(c => ({ x: c.x, y: c.c }));
    state.charts.candle.update('none');

    // Update Indicators
    const sma20 = calcSMA(closes, 20);
    $('sma20').textContent = fmtPrice(CONFIG.pair, sma20[sma20.length - 1]);
    state.charts.sma.data.datasets[0].data = times.map((t, i) => ({ x: t, y: sma20[i] })).filter(p => p.y != null);
    state.charts.sma.update('none');

    const ema12 = calcEMA(closes, 12);
    $('ema12').textContent = fmtPrice(CONFIG.pair, ema12[ema12.length - 1]);
    state.charts.ema.data.datasets[0].data = times.map((t, i) => ({ x: t, y: ema12[i] })).filter(p => p.y != null);
    state.charts.ema.update('none');

    const rsi = calcRSI(closes, 14);
    const lastRsi = rsi[rsi.length - 1];
    $('rsiValue').textContent = lastRsi ? lastRsi.toFixed(1) : '--';
    $('rsiState').textContent = lastRsi > 70 ? 'Overbought' : lastRsi < 30 ? 'Oversold' : 'Neutral';
    state.charts.rsi.data.datasets[0].data = times.map((t, i) => ({ x: t, y: rsi[i] })).filter(p => p.y != null);
    state.charts.rsi.update('none');

    $('statusDot').classList.add('live');
    $('statusText').textContent = 'Live';$('lastUpdate').textContent = new Date().toLocaleTimeString();
  } catch (err) {
    $('statusText').textContent = 'Error';$('statusDot').classList.remove('live');
  }
}

document.querySelectorAll('.pair-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pair-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    CONFIG.pair = btn.dataset.pair;
    $('pricePairLabel').textContent = SYMBOLS[CONFIG.pair]?.label || CONFIG.pair;
    refresh();
  });
});

$('refreshBtn').addEventListener('click', refresh);

// Dynamic Year Footer
const yearEl = $('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Init App
initCharts();
refresh();
setInterval(refresh, CONFIG.refreshMs);
