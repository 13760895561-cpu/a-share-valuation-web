const valuationService = require('../miniprogram/services/valuation');
const { execFileSync } = require('node:child_process');

const EASTMONEY_ALL_STOCKS =
  'https://push2delay.eastmoney.com/api/qt/clist/get';

function buildAllStocksUrl(pageNumber, pageSize) {
  const params = new URLSearchParams({
    pn: String(pageNumber),
    pz: String(pageSize),
    po: '1',
    np: '1',
    ut: 'bd1d9ddb04089700cf9c27f6f7426281',
    fltt: '2',
    invt: '2',
    fid: 'f3',
    fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
    fields: 'f12,f14,f2,f20,f3'
  });
  return `${EASTMONEY_ALL_STOCKS}?${params.toString()}`;
}

function parseArgs() {
  const args = new Map();
  process.argv.slice(2).forEach((arg) => {
    const [key, value] = arg.split('=');
    args.set(key, value ?? true);
  });
  return {
    deep: Number(args.get('--deep') || 0),
    workers: Number(args.get('--workers') || 5)
  };
}

function createWxRequestShim() {
  global.wx = {
    request(options) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);
      fetch(options.url, {
        method: options.method || 'GET',
        headers: options.header || {},
        signal: controller.signal
      })
        .then(async (res) => {
          clearTimeout(timeout);
          const data = options.responseType === 'arraybuffer' ? await res.arrayBuffer() : await res.text();
          if (options.success) {
            options.success({
              statusCode: res.status,
              data,
              header: Object.fromEntries(res.headers.entries())
            });
          }
        })
        .catch((error) => {
          clearTimeout(timeout);
          if (options.fail) options.fail({ errMsg: error.message });
        });
    }
  };
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseFormattedNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(number) ? number : null;
}

async function fetchAllStocks() {
  const pageSize = 100;
  const firstText = execFileSync('curl', [
    '-sL',
    '--max-time',
    '20',
    buildAllStocksUrl(1, pageSize)
  ], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  const firstPage = JSON.parse(firstText);
  const total = firstPage?.data?.total || 0;
  const pages = Math.ceil(total / pageSize);
  const rows = [...(firstPage?.data?.diff || [])];
  for (let page = 2; page <= pages; page += 1) {
    const text = execFileSync('curl', [
      '-sL',
      '--max-time',
      '20',
      buildAllStocksUrl(page, pageSize)
    ], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
    rows.push(...(JSON.parse(text)?.data?.diff || []));
  }
  return rows
    .map((item) => ({
      code: item.f12,
      name: item.f14,
      price: toNumber(item.f2),
      marketCapYi: toNumber(item.f20) === null ? null : item.f20 / 100000000,
      changePct: toNumber(item.f3)
    }))
    .filter((item) => item.code && item.name && item.price > 0 && item.marketCapYi > 0)
    .map((item) => ({
      ...item,
      totalShares: item.marketCapYi / item.price
    }));
}

function buildStressContext(stock, scenario) {
  const profile = valuationService._test.getIndustryProfile(`${stock.name} ${stock.code}`);
  const trendScore = scenario === 'weak' ? 30 : scenario === 'strong' ? 88 : 55;
  const marketTrend = {
    trendScore,
    trendLabel: scenario === 'weak' ? '中长期偏弱' : scenario === 'strong' ? '长期强势' : '中性震荡',
    medianMarketCap250: stock.marketCapYi * (scenario === 'weak' ? 0.78 : scenario === 'strong' ? 1.08 : 0.92),
    medianMarketCap500: stock.marketCapYi * (scenario === 'weak' ? 0.82 : scenario === 'strong' ? 0.98 : 0.88),
    high: stock.price * (scenario === 'strong' ? 1.12 : 1.4),
    low: stock.price * (scenario === 'weak' ? 0.55 : 0.68)
  };
  const annualMetrics = [
    { revenue: stock.marketCapYi * 0.25, profit: stock.marketCapYi * 0.006 },
    { revenue: stock.marketCapYi * 0.23, profit: stock.marketCapYi * 0.004 }
  ];
  const expectedGrowth = scenario === 'strong' ? 80 : scenario === 'weak' ? -20 : 18;
  const valuationEnvironment = valuationService._test.calculateValuationEnvironment({
    stockName: stock.name,
    stockCode: stock.code,
    industryText: `${stock.name} ${stock.code}`,
    marketTrend,
    annualMetrics,
    expectedGrowth,
    currentGrossMargin: profile.stage === 'growth' ? 38 : 22,
    previousGrossMargin: profile.stage === 'growth' ? 30 : 20,
    debtRatio: profile.stage === 'traditional' ? 62 : 42,
    dividendRate: profile.stage === 'mature-consumption' ? 2.5 : 0.4
  });
  const forecastMeta = {
    source: scenario === 'strong' ? 'broker' : scenario === 'weak' ? 'investment-bank' : 'broker',
    institutionCount: scenario === 'strong' ? 1 : scenario === 'weak' ? 0 : 6,
    forecastItems: [
      { netProfit: stock.marketCapYi * 0.002 },
      { netProfit: stock.marketCapYi * (scenario === 'strong' ? 0.006 : 0.003) },
      { netProfit: stock.marketCapYi * (scenario === 'strong' ? 0.02 : 0.005) }
    ]
  };
  const series = valuationService._test.buildProfitPredictionSeries({
    netProfit: forecastMeta.forecastItems[0].netProfit,
    expectedGrowth,
    forecastMeta,
    profile: valuationEnvironment.profile
  });
  const rawComprehensiveSellValue = scenario === 'strong' ? stock.marketCapYi * 30 : scenario === 'weak' ? stock.marketCapYi * 0.015 : stock.marketCapYi * 1.2;
  const intrinsicValue = scenario === 'strong' ? stock.marketCapYi * 18 : scenario === 'weak' ? stock.marketCapYi * 0.02 : stock.marketCapYi * 0.8;
  const investmentBankValuation = {
    fairValue: stock.marketCapYi * (scenario === 'weak' ? 0.35 : scenario === 'strong' ? 1.7 : 0.9)
  };
  const adaptiveValuation = {
    fairValue: stock.marketCapYi * (scenario === 'weak' ? 0.3 : scenario === 'strong' ? 1.5 : 0.95)
  };
  const stability = valuationService._test.stabilizeValuationOutputs({
    rawComprehensiveSellValue,
    intrinsicValue,
    totalSurplusValue: stock.marketCapYi * (scenario === 'weak' ? 0.18 : 0.8),
    investmentBankValuation,
    adaptiveValuation,
    totalMarketCap: stock.marketCapYi,
    totalShares: stock.totalShares,
    marketTrend,
    valuationEnvironment,
    forecastMeta,
    profitPredictions: series.predictions
  });
  return { stability, series };
}

function runQuoteLevelStress(stocks) {
  const failures = [];
  const scenarios = ['strong', 'neutral', 'weak'];
  for (const stock of stocks) {
    for (const scenario of scenarios) {
      const { stability } = buildStressContext(stock, scenario);
      const sell = stability.comprehensiveSellValue;
      const buy1 = stability.buyBaseValue * 0.9;
      const finalBuy = stability.buyBaseValue * Math.pow(0.9, 9);
      const sellToMarket = sell / stock.marketCapYi;
      const buyToSell = buy1 / sell;
      const finalToSell = finalBuy / sell;
      if (
        !Number.isFinite(sell)
        || !Number.isFinite(buy1)
        || sell <= 0
        || buy1 <= 0
        || finalBuy <= 0
        || buy1 >= sell
        || finalBuy >= buy1
        || sellToMarket > 6
        || sellToMarket < 0.12
        || buyToSell > 0.82
        || buyToSell < 0.3
        || finalToSell < 0.1
      ) {
        failures.push({
          code: stock.code,
          name: stock.name,
          scenario,
          sellToMarket,
          buyToSell,
          finalToSell,
          sell,
          buy1,
          finalBuy
        });
      }
    }
  }
  return failures;
}

async function runDeepSample(stocks, limit, workers) {
  if (!limit) return { tested: 0, success: 0, failures: [] };
  createWxRequestShim();
  const sample = [];
  const step = Math.max(Math.floor(stocks.length / limit), 1);
  for (let index = 0; index < stocks.length && sample.length < limit; index += step) sample.push(stocks[index]);

  let cursor = 0;
  const failures = [];
  let success = 0;
  async function worker() {
    while (cursor < sample.length) {
      const stock = sample[cursor];
      cursor += 1;
      try {
        const result = await valuationService.evaluateStock(stock.code);
        const sell = parseFormattedNumber(result.summary.comprehensiveSellValue);
        const marketCap = parseFormattedNumber(result.summary.totalMarketCap);
        const buy1 = parseFormattedNumber(result.buyPoints?.[0]?.value);
        const finalBuy = parseFormattedNumber(result.buyPoints?.[result.buyPoints.length - 1]?.value);
        if (!sell || !marketCap || !buy1 || !finalBuy || sell <= 0 || buy1 <= 0 || finalBuy <= 0 || buy1 >= sell || finalBuy >= buy1 || sell / marketCap > 8 || sell / marketCap < 0.08) {
          failures.push({ code: stock.code, name: stock.name, reason: 'range', sell, marketCap, buy1, finalBuy });
        } else {
          success += 1;
        }
      } catch (error) {
        failures.push({ code: stock.code, name: stock.name, reason: error.message || String(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  return { tested: sample.length, success, failures };
}

async function main() {
  const options = parseArgs();
  const stocks = await fetchAllStocks();
  const quoteFailures = runQuoteLevelStress(stocks);
  const deep = await runDeepSample(stocks, options.deep, options.workers);
  const result = {
    allStockCount: stocks.length,
    quoteStressCases: stocks.length * 3,
    quoteStressFailures: quoteFailures.length,
    quoteStressFailureSample: quoteFailures.slice(0, 10),
    deepSample: {
      tested: deep.tested,
      success: deep.success,
      failures: deep.failures.length,
      failureSample: deep.failures.slice(0, 10)
    }
  };
  console.log(JSON.stringify(result, null, 2));
  if (quoteFailures.length || deep.failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
