const EASTMONEY_DATACENTER = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const STORAGE_KEY = 'stockValuations.v2';

let profitChart = null;
let savedValuations = readSavedValuations();
let currentValuation = null;

document.addEventListener('DOMContentLoaded', () => {
  applySavedTheme();
  initTabs();
  initButtons();
  initModals();
  loadHistory();
  refreshIcons();

  const queryStock = new URLSearchParams(window.location.search).get('stock');
  if (queryStock) {
    qs('stock-search').value = queryStock;
    autoFillByStock();
  }
});

function qs(id) {
  return document.getElementById(id);
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function readSavedValuations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('stockValuations');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function applySavedTheme() {
  const theme = localStorage.getItem('valuationTheme');
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  }
}

function initTabs() {
  document.querySelectorAll('#tabs button').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#tabs button').forEach((button) => {
        button.classList.remove('tab-active');
        button.classList.add('tab-inactive');
      });
      tab.classList.add('tab-active');
      tab.classList.remove('tab-inactive');

      document.querySelectorAll('.tab-content').forEach((content) => content.classList.add('hidden'));
      qs(`${tab.dataset.tab}-content`).classList.remove('hidden');

      if (tab.dataset.tab === 'history') {
        loadHistory();
      }
    });
  });
}

function initButtons() {
  qs('auto-fill-btn').addEventListener('click', autoFillByStock);
  qs('stock-search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      autoFillByStock();
    }
  });

  document.querySelectorAll('[data-stock]').forEach((button) => {
    button.addEventListener('click', () => {
      qs('stock-search').value = button.dataset.stock;
      autoFillByStock();
    });
  });

  qs('calculate-btn').addEventListener('click', () => {
    if (calculateValuation()) {
      showToast('估值已更新');
    }
  });
  qs('save-btn').addEventListener('click', saveValuation);
  qs('clear-history-btn').addEventListener('click', clearHistory);
  qs('export-history-btn').addEventListener('click', exportHistory);
  qs('share-link-btn').addEventListener('click', copyShareLink);

  qs('theme-toggle').addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('valuationTheme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  });

  qs('help-btn').addEventListener('click', () => openModal('help-modal'));
  qs('close-help-btn').addEventListener('click', () => closeModal('help-modal'));
  qs('close-modal-btn').addEventListener('click', () => closeModal('history-detail-modal'));
}

function initModals() {
  window.addEventListener('click', (event) => {
    if (event.target.id === 'help-modal') closeModal('help-modal');
    if (event.target.id === 'history-detail-modal') closeModal('history-detail-modal');
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal('help-modal');
      closeModal('history-detail-modal');
    }
  });
}

function openModal(id) {
  qs(id).classList.remove('hidden');
  refreshIcons();
}

function closeModal(id) {
  qs(id).classList.add('hidden');
}

function setDataStatus(message, type = 'info') {
  const status = qs('data-status');
  status.className = `status-box ${type}`;
  status.textContent = message;
}

function setAsOfTime(message) {
  qs('as-of-time').textContent = message;
}

function setAutoButtonLoading(isLoading) {
  const button = qs('auto-fill-btn');
  button.disabled = isLoading;
  button.innerHTML = isLoading
    ? '<i data-lucide="loader-2"></i><span>取数中</span>'
    : '<i data-lucide="cloud-download"></i><span>联网取数</span>';
  refreshIcons();
}

function showToast(message) {
  const toast = qs('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), 2600);
}

async function fetchJson(url, params = {}, timeoutMs = 15000, retries = 1) {
  const query = new URLSearchParams(params);
  const requestUrl = Object.keys(params).length ? `${url}?${query.toString()}` : url;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(requestUrl, {
        signal: controller.signal,
        credentials: 'omit'
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      const isAbort = error.name === 'AbortError' || /abort|aborted/i.test(error.message || '');
      if (attempt >= retries) {
        throw new Error(isAbort ? '数据接口响应超时' : error.message);
      }
      await delay(350 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('数据接口请求失败');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toYi(value) {
  const number = toNumber(value);
  return number === null ? null : number / 100000000;
}

function average(values) {
  const validValues = values.filter((value) => Number.isFinite(value));
  if (!validValues.length) return null;
  return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

function averagePositive(values) {
  return average(values.filter((value) => Number.isFinite(value) && value > 0));
}

function clamp(value, min, max) {
  const number = toNumber(value);
  if (number === null) return null;
  return Math.min(Math.max(number, min), max);
}

function weightedAverage(items) {
  const validItems = items.filter((item) => Number.isFinite(item.value) && item.value > 0 && Number.isFinite(item.weight) && item.weight > 0);
  const totalWeight = validItems.reduce((total, item) => total + item.weight, 0);
  if (!totalWeight) return null;
  return validItems.reduce((total, item) => total + item.value * item.weight, 0) / totalWeight;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function parseCnAmountToYi(value) {
  if (value === null || value === undefined || value === '' || value === false) return null;
  if (typeof value === 'number') return value / 100000000;

  const text = String(value).replace(/,/g, '').trim();
  if (!text || text === '--' || text === 'false') return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const number = Number(match[0]);
  if (!Number.isFinite(number)) return null;
  if (text.includes('万亿')) return number * 10000;
  if (text.includes('亿')) return number;
  if (text.includes('万')) return number / 10000;
  return number / 100000000;
}

function formatNumber(value, digits = 2) {
  const number = toNumber(value);
  if (number === null) return '--';
  return Number(number.toFixed(digits)).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function setInputValue(id, value, digits = 2) {
  const input = qs(id);
  const number = toNumber(value);
  input.value = number === null ? '' : Number(number.toFixed(digits)).toString();
}

function setTextValue(id, value, digits = 2, suffix = '') {
  const number = toNumber(value);
  qs(id).textContent = number === null ? '--' : `${formatNumber(number, digits)}${suffix}`;
}

function ratioToPercent(value) {
  const number = toNumber(value);
  return number === null ? null : number * 100;
}

function calcPointPrice(marketValue, totalShares) {
  const value = toNumber(marketValue);
  const shares = toNumber(totalShares);
  if (value === null || !shares || shares <= 0) return null;
  return value / shares;
}

function setPointPrice(id, marketValue, totalShares, fallbackText = '对应股价 -- 元/股') {
  const price = calcPointPrice(marketValue, totalShares);
  qs(id).textContent = price === null ? fallbackText : `对应股价 ${formatNumber(price, 2)} 元/股`;
  return price;
}

function getMarketStatus(targetValue, currentMarketCap) {
  const target = toNumber(targetValue);
  const current = toNumber(currentMarketCap);
  if (target === null || target <= 0 || current === null || current <= 0) {
    return {
      text: '当前市值对比 --',
      className: 'metric-price metric-price--muted',
      upside: null,
      premiumToTarget: null
    };
  }

  const upside = (target / current - 1) * 100;
  if (upside < 0) {
    const premiumToTarget = (current / target - 1) * 100;
    return {
      text: `当前市值高于卖点 ${formatNumber(premiumToTarget)}%，模型提示高估`,
      className: 'metric-price metric-price--danger',
      upside,
      premiumToTarget
    };
  }

  return {
    text: `距卖点空间 ${formatNumber(upside)}%，未触发卖点`,
    className: 'metric-price metric-price--success',
    upside,
    premiumToTarget: null
  };
}

function setMarketStatus(id, status) {
  const element = qs(id);
  element.textContent = status?.text || '当前市值对比 --';
  element.className = status?.className || 'metric-price metric-price--muted';
}

function normalizeStockKeyword(value) {
  const trimmed = value.trim();
  const codeMatch = trimmed.match(/(?:sh|sz|bj)?\s*(\d{6})|(\d{6})\s*(?:\.|\s)*(?:sh|sz|bj)/i);
  return codeMatch ? (codeMatch[1] || codeMatch[2]) : trimmed;
}

function getStockMarketPrefix(code) {
  const normalizedCode = String(code || '').replace(/\D/g, '');
  if (/^(600|601|603|605|688|689)\d{3}$/.test(normalizedCode)) return '1';
  return '0';
}

function isAStockCandidate(item) {
  const code = String(item.Code || item.UnifiedCode || '');
  const typeName = item.SecurityTypeName || '';
  const isAStockCode = /^(600|601|603|605|688|689|000|001|002|003|300|301|430|830|831|832|833|834|835|836|837|838|839|870|871|872|873|874|875|876|877|878|879|880|881|882|883|884|885|886|887|888|889)\d{3}$/.test(code);
  const isAStockType = /A|沪|深|京|科创|创业|北交/.test(typeName);
  return item.Code && item.Name && (item.Classify === 'AStock' || isAStockType || isAStockCode);
}

function buildStockSecId(candidate) {
  if (candidate.QuoteID) return candidate.QuoteID;
  const code = candidate.Code || candidate.UnifiedCode;
  if (!code) throw new Error('无法识别股票代码');
  return `${getStockMarketPrefix(code)}.${code}`;
}

function candidateFromCode(code) {
  const normalizedCode = normalizeStockKeyword(code);
  if (!/^\d{6}$/.test(normalizedCode)) return null;
  return {
    Code: normalizedCode,
    UnifiedCode: normalizedCode,
    Name: normalizedCode,
    QuoteID: `${getStockMarketPrefix(normalizedCode)}.${normalizedCode}`,
    SecurityTypeName: /^(688|689)/.test(normalizedCode) ? '科创板' : 'A股'
  };
}

function getYear(value) {
  const match = String(value || '').match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function calcGrossMargin(incomeRow) {
  if (!incomeRow) return null;
  const revenue = toNumber(incomeRow.TOTAL_OPERATE_INCOME);
  const cost = toNumber(incomeRow.OPERATE_COST);
  if (!revenue || cost === null) return null;
  return ((revenue - cost) / revenue) * 100;
}

function calcHistoricalProfitGrowth(annualRows) {
  if (!annualRows.length) return null;
  const latestProfit = toNumber(annualRows[0].PARENT_NETPROFIT);
  const baseIndex = Math.min(3, annualRows.length - 1);
  const baseProfit = toNumber(annualRows[baseIndex]?.PARENT_NETPROFIT);

  if (baseIndex > 0 && latestProfit !== null && baseProfit && latestProfit > 0) {
    return (Math.pow(latestProfit / baseProfit, 1 / baseIndex) - 1) * 100;
  }
  return toNumber(annualRows[0].PARENT_NETPROFIT_RATIO) ?? 0;
}

function chooseThreeYearsAgoAnnualRow(annualRows) {
  if (!annualRows.length) return null;
  const latestAnnualYear = getYear(annualRows[0].REPORT_DATE);
  const targetYear = latestAnnualYear ? latestAnnualYear - 3 : null;
  return annualRows.find((row) => getYear(row.REPORT_DATE) === targetYear)
    || annualRows[Math.min(3, annualRows.length - 1)]
    || null;
}

async function searchStockCandidate(keyword) {
  const input = normalizeStockKeyword(keyword);
  const directCandidate = candidateFromCode(input);
  if (directCandidate) return directCandidate;

  let aShares = await tencentSuggestStockCandidates(input).catch(() => []);
  if (!aShares.length) {
    aShares = await sinaSuggestStockCandidates(input).catch(() => []);
  }
  if (!aShares.length) {
    throw new Error('未找到匹配的 A 股股票');
  }

  return aShares.find((item) => item.Code === input)
    || aShares.find((item) => item.Name === keyword.trim())
    || aShares[0];
}

function tencentSuggestStockCandidates(keyword) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const previousValue = window.v_hint;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('腾讯股票搜索接口响应超时'));
    }, 7000);

    function cleanup() {
      clearTimeout(timer);
      if (previousValue === undefined) {
        delete window.v_hint;
      } else {
        window.v_hint = previousValue;
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    script.charset = 'UTF-8';
    script.onload = () => {
      const raw = window.v_hint || '';
      cleanup();
      resolve(parseTencentSuggest(raw).filter(isAStockCandidate));
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('腾讯股票搜索接口请求失败'));
    };
    script.src = `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(keyword)}&t=all`;
    document.body.appendChild(script);
  });
}

function parseTencentSuggest(raw) {
  return String(raw || '')
    .split('^')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [market, code, name, , type] = entry.split('~');
      if (!/^\d{6}$/.test(code || '')) return null;
      if (!['sh', 'sz', 'bj'].includes(market)) return null;
      if (type && !/GP-A|KCB/.test(type)) return null;
      return {
        Code: code,
        UnifiedCode: code,
        Name: name || code,
        QuoteID: `${market === 'sh' ? '1' : '0'}.${code}`,
        SecurityTypeName: /KCB|^(688|689)/.test(`${type || ''}${code}`) ? '科创板' : 'A股'
      };
    })
    .filter(Boolean);
}

function sinaSuggestStockCandidates(keyword) {
  return new Promise((resolve, reject) => {
    const variableName = `suggest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('股票搜索接口响应超时'));
    }, 8000);

    function cleanup() {
      clearTimeout(timer);
      delete window[variableName];
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    script.charset = 'GBK';
    script.onload = () => {
      const raw = window[variableName] || '';
      cleanup();
      resolve(parseSinaSuggest(raw).filter(isAStockCandidate));
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('股票搜索接口请求失败'));
    };
    script.src = `https://suggest3.sinajs.cn/suggest/type=11,12&key=${encodeURIComponent(keyword)}&name=${variableName}`;
    document.body.appendChild(script);
  });
}

function parseSinaSuggest(raw) {
  return String(raw || '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(',');
      const code = parts[2] || '';
      const marketCode = parts[3] || '';
      const name = parts[4] || parts[0] || code;
      if (!/^\d{6}$/.test(code)) return null;
      return {
        Code: code,
        UnifiedCode: code,
        Name: name,
        QuoteID: `${marketCode.startsWith('sh') ? '1' : '0'}.${code}`,
        SecurityTypeName: /^(688|689)/.test(code) ? '科创板' : 'A股'
      };
    })
    .filter(Boolean);
}

async function fetchStockQuote(candidate) {
  const response = await fetchJson('https://push2delay.eastmoney.com/api/qt/stock/get', {
    secid: buildStockSecId(candidate),
    fields: 'f43,f57,f58,f84,f85,f116,f117,f126,f127,f129,f152,f186,f188'
  }, 12000, 1);
  const data = response?.data;
  if (!data) {
    throw new Error('未取到实时行情数据');
  }

  const scale = Math.pow(10, toNumber(data.f152) ?? 2);
  return {
    code: data.f57 || candidate.Code,
    name: data.f58 || candidate.Name,
    price: toNumber(data.f43) === null ? null : data.f43 / scale,
    totalShares: toYi(data.f84 ?? data.f85),
    marketCap: toYi(data.f116 ?? data.f117),
    dividendRateTtm: toNumber(data.f126),
    industry: data.f127 || '',
    conceptText: data.f129 || '',
    latestGrossMargin: toNumber(data.f186),
    latestDebtRatio: toNumber(data.f188)
  };
}

async function fetchDatacenterRows(reportName, code, pageSize = 5, includeDateType = true) {
  const filter = includeDateType
    ? `(SECURITY_CODE="${code}")(DATE_TYPE_CODE="001")`
    : `(SECURITY_CODE="${code}")`;
  const response = await fetchJson(EASTMONEY_DATACENTER, {
    reportName,
    columns: 'ALL',
    filter,
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
    pageSize: String(pageSize),
    pageNumber: '1'
  }, 18000, 1);

  if (response?.success === false) {
    throw new Error(response.message || '财务数据接口返回异常');
  }
  return response?.result?.data || [];
}

async function fetchDatacenterReport(reportName, params = {}) {
  const response = await fetchJson(EASTMONEY_DATACENTER, {
    reportName,
    columns: 'ALL',
    pageSize: '20',
    pageNumber: '1',
    ...params
  }, 18000, 1);

  if (response?.success === false) {
    throw new Error(response.message || '数据中心接口返回异常');
  }
  return response?.result?.data || [];
}

async function fetchDividendRate(code, price) {
  const rows = await fetchDatacenterRows('RPT_SHAREBONUS_DET', code, 8, false);
  const dividend = rows.find((item) => toNumber(item.DIVIDENT_RATIO) || toNumber(item.PRETAX_BONUS_RMB));
  if (!dividend) return null;

  const ratio = toNumber(dividend.DIVIDENT_RATIO);
  if (ratio) {
    return ratio > 1 ? ratio : ratio * 100;
  }

  const pretaxBonusPerTenShares = toNumber(dividend.PRETAX_BONUS_RMB);
  if (pretaxBonusPerTenShares && price) {
    return (pretaxBonusPerTenShares / 10 / price) * 100;
  }
  return null;
}

async function fetchProfitForecast(code, totalShares, latestAnnualProfit) {
  const rows = await fetchDatacenterReport('RPT_WEB_RESPREDICT', {
    filter: `(SECURITY_CODE="${code}")`,
    pageSize: '1'
  });
  const row = rows[0];
  if (!row) return null;

  const forecastItems = [2, 3, 4].map((index) => {
    const eps = toNumber(row[`EPS${index}`]);
    const year = toNumber(row[`YEAR${index}`]);
    if (!eps || !totalShares) return null;
    return {
      year,
      eps,
      netProfit: eps * totalShares
    };
  }).filter(Boolean);

  if (!forecastItems.length) return null;

  const institutionCount = toNumber(row.RATING_LONG_NUM) ?? toNumber(row.RATING_ORG_NUM) ?? 0;
  const selectedNetProfit = institutionCount > 10
    ? Math.min(...forecastItems.map((item) => item.netProfit))
    : Math.max(...forecastItems.map((item) => item.netProfit));

  const yoyGrowth = [];
  let previousProfit = latestAnnualProfit;
  forecastItems.forEach((item) => {
    if (previousProfit && item.netProfit) {
      yoyGrowth.push((item.netProfit / previousProfit - 1) * 100);
    }
    previousProfit = item.netProfit;
  });

  return {
    institutionCount,
    selectedNetProfit,
    expectedGrowth: average(yoyGrowth),
    industry: row.INDUSTRY_BOARD || '',
    conceptText: row.CONCEPTINDEX_BOARD || '',
    forecastItems
  };
}

async function fetchTonghuashunCashAverages(code) {
  const response = await fetchJson(`https://basic.10jqka.com.cn/api/stock/finance/${code}_cash.json`);
  const cashData = JSON.parse(response.flashData || '{}');
  const titles = cashData.title || [];
  const annualRows = cashData.year || [];
  const years = annualRows[0] || [];

  function findRow(pattern) {
    const index = titles.findIndex((item) => {
      const name = Array.isArray(item) ? item[0] : item;
      return pattern.test(name || '');
    });
    return index > -1 ? annualRows[index] || [] : [];
  }

  const depreciation = findRow(/固定资产折旧|油气资产折耗|生产性生物资产折旧/);
  const intangibleAmortization = findRow(/无形资产摊销/);
  const longPrepaidAmortization = findRow(/长期待摊费用摊销/);
  const capex = findRow(/购建固定资产|构建固定资产/);
  const dAndAYearlyValues = [];
  const capexYearlyValues = [];

  for (let index = 0; index < Math.min(5, years.length); index += 1) {
    const components = [
      parseCnAmountToYi(depreciation[index]),
      parseCnAmountToYi(intangibleAmortization[index]),
      parseCnAmountToYi(longPrepaidAmortization[index])
    ];
    const validComponents = components.filter((value) => value !== null);
    if (validComponents.length) {
      dAndAYearlyValues.push({
        year: years[index],
        value: sum(validComponents),
        isComplete: validComponents.length === components.length
      });
    }

    const capexValue = parseCnAmountToYi(capex[index]);
    if (capexValue !== null) {
      capexYearlyValues.push({
        year: years[index],
        value: capexValue
      });
    }
  }

  const dAndAEstimate = estimateDAndA(dAndAYearlyValues);
  const capexEstimate = estimateCapex(capexYearlyValues);

  return {
    dAndA: dAndAEstimate.value,
    capex: capexEstimate.value,
    dAndAYearCount: dAndAEstimate.yearCount,
    capexYearCount: capexEstimate.yearCount,
    dAndAMethod: dAndAEstimate.method,
    capexMethod: capexEstimate.method,
    dAndABaseAverage: dAndAEstimate.baseAverage,
    capexBaseAverage: capexEstimate.baseAverage
  };
}

function estimateCashAverage(yearlyValues, preferredYears = 3) {
  const values = yearlyValues
    .filter((item) => Number.isFinite(item.value))
    .slice(0, Math.min(preferredYears, yearlyValues.length || preferredYears));
  return {
    value: average(values.map((item) => item.value)),
    baseAverage: average(values.map((item) => item.value)),
    yearCount: values.length,
    method: values.length ? 'average' : 'none'
  };
}

function estimateDAndA(yearlyValues) {
  const completeValues = yearlyValues.filter((item) => item.isComplete);
  const sourceValues = completeValues.length >= 3 ? completeValues : yearlyValues;
  return estimateTrendAdjustedCashItem(sourceValues, {
    preferredYears: 3,
    stableTolerance: 0.25,
    upThreshold: 1.08,
    downThreshold: 0.92,
    volatilityLimit: 2.8
  });
}

function estimateCapex(yearlyValues) {
  return estimateTrendAdjustedCashItem(yearlyValues, {
    preferredYears: 3,
    stableTolerance: 0.35,
    upThreshold: 1.15,
    downThreshold: 0.85,
    volatilityLimit: 2.5
  });
}

function estimateTrendAdjustedCashItem(yearlyValues, options = {}) {
  const {
    preferredYears = 3,
    stableTolerance = 0.3,
    upThreshold = 1.12,
    downThreshold = 0.88,
    volatilityLimit = 2.5
  } = options;
  const base = estimateCashAverage(yearlyValues, preferredYears);
  const selectedValues = yearlyValues
    .filter((item) => Number.isFinite(item.value))
    .slice(0, base.yearCount);
  const recentTwo = selectedValues.slice(0, 2);
  const recentTwoAverage = average(recentTwo.map((item) => item.value));
  const values = selectedValues.map((item) => item.value);
  const [newest, previous, oldest] = values;
  const positiveValues = values.filter((value) => value > 0);
  const maxValue = positiveValues.length ? Math.max(...positiveValues) : null;
  const minValue = positiveValues.length ? Math.min(...positiveValues) : null;
  const recentIsStable = recentTwoAverage && newest && previous && Math.abs(newest - previous) / recentTwoAverage <= stableTolerance;
  const recentIsHigher = recentTwoAverage && base.baseAverage && recentTwoAverage > base.baseAverage * upThreshold;
  const recentIsLower = recentTwoAverage && base.baseAverage && recentTwoAverage < base.baseAverage * downThreshold;
  const trendIsRising = newest && previous && oldest && newest >= previous && previous >= oldest;
  const trendIsFalling = newest && previous && oldest && newest <= previous && previous <= oldest;
  const volatilityIsHigh = maxValue && minValue && maxValue / minValue >= volatilityLimit;

  if (base.yearCount >= 3 && recentIsStable && (recentIsHigher || trendIsRising)) {
    return {
      value: recentTwoAverage,
      baseAverage: base.baseAverage,
      yearCount: base.yearCount,
      method: 'trend-up'
    };
  }

  if (base.yearCount >= 3 && recentIsStable && (recentIsLower || trendIsFalling)) {
    return {
      value: recentTwoAverage,
      baseAverage: base.baseAverage,
      yearCount: base.yearCount,
      method: 'trend-down'
    };
  }

  if (base.yearCount >= 3 && trendIsRising && newest > base.baseAverage * upThreshold) {
    return {
      value: newest * 0.5 + previous * 0.3 + oldest * 0.2,
      baseAverage: base.baseAverage,
      yearCount: base.yearCount,
      method: 'trend-up'
    };
  }

  if (base.yearCount >= 3 && trendIsFalling && newest < base.baseAverage * downThreshold) {
    return {
      value: newest * 0.5 + previous * 0.3 + oldest * 0.2,
      baseAverage: base.baseAverage,
      yearCount: base.yearCount,
      method: 'trend-down'
    };
  }

  if (base.yearCount >= 3 && volatilityIsHigh && !trendIsRising && !trendIsFalling) {
    return {
      value: median(values),
      baseAverage: base.baseAverage,
      yearCount: base.yearCount,
      method: 'median'
    };
  }

  return base;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function describeCashEstimate(label, value, estimate) {
  if (!estimate?.yearCount || value === null || value === undefined) return '';
  const amount = formatNumber(value, 2);
  const yearText = `近${estimate.yearCount}年`;
  const methodText = {
    'trend-up': `${label}按${yearText}明细均值，并结合近年抬升趋势上调至${amount}亿元`,
    'trend-down': `${label}按${yearText}明细均值，并结合近年下降趋势下调至${amount}亿元`,
    median: `${label}近年波动较大，按${yearText}中位数估计为${amount}亿元`,
    average: `${label}按${yearText}年度现金流明细均值估计为${amount}亿元`
  };
  return methodText[estimate.method] || `${label}按${yearText}年度现金流明细估计为${amount}亿元`;
}

function estimatePerpetualGrowth(industryText) {
  const text = industryText || '';
  if (/房地产|房屋|物业|建筑|水泥|钢铁|煤炭|石油|银行|保险|证券|公路|铁路|港口|机场|电力|燃气|水务|环保/.test(text)) {
    return 1;
  }
  if (/半导体|芯片|集成电路|人工智能|AI|软件|计算机|通信|电子|机器人|新能源|电池|光伏|军工|高端装备|创新药|生物医药/.test(text)) {
    return 3.8;
  }
  if (/医药|医疗|消费电子|汽车|机械|化工|新材料|传媒|互联网|游戏/.test(text)) {
    return 3;
  }
  if (/食品|饮料|白酒|家电|家居|农业|纺织|服装|零售|物流/.test(text)) {
    return 2.5;
  }
  return 2.5;
}

function chooseIndexForProfitTaking(forecast, quote) {
  const text = `${forecast?.conceptText || ''},${quote.conceptText || ''}`;
  if (/HS300|沪深300|上证50|上证180/.test(text)) {
    return { tencentCode: 'sh000300', name: '沪深300' };
  }
  if (/中证500|ZZ500|500/.test(text)) {
    return { tencentCode: 'sh000905', name: '中证500' };
  }
  return (quote.marketCap || 0) >= 500
    ? { tencentCode: 'sh000300', name: '沪深300' }
    : { tencentCode: 'sh000905', name: '中证500' };
}

async function fetchProfitTakingCoefficient(indexInfo) {
  const code = indexInfo.tencentCode;
  const response = await fetchJson('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get', {
    param: `${code},day,,,260,qfq`
  }, 10000);
  const closes = (response?.data?.[code]?.day || [])
    .map((item) => toNumber(item[2]))
    .filter((value) => value !== null);
  if (closes.length < 250) return { coefficient: 1.382, ma60: null, ma250: null, indexName: indexInfo.name };

  const ma60 = average(closes.slice(-60));
  const ma250 = average(closes.slice(-250));
  return {
    coefficient: ma60 > ma250 ? 1.618 : 1.382,
    ma60,
    ma250,
    indexName: indexInfo.name
  };
}

async function autoFillByStock() {
  const keyword = qs('stock-search').value.trim()
    || qs('stock-code').value.trim()
    || qs('stock-name').value.trim();
  if (!keyword) {
    setDataStatus('请输入股票代码或公司名称。', 'error');
    return;
  }

  setAutoButtonLoading(true);
  setDataStatus('正在联网获取行情、财务、现金流、盈利预测和指数均线数据...', 'loading');

  try {
    const candidate = await searchStockCandidate(keyword);
    const quote = await fetchStockQuote(candidate);
    const code = quote.code || candidate.Code;

    const [latestIncomeRows, annualIncomeRows, latestBalanceRows, annualCashFlowRows, dividendRateFallback] = await Promise.all([
      fetchDatacenterRows('RPT_DMSK_FN_INCOME', code, 8, false),
      fetchDatacenterRows('RPT_DMSK_FN_INCOME', code, 8, true),
      fetchDatacenterRows('RPT_DMSK_FN_BALANCE', code, 3, false).catch(() => []),
      fetchDatacenterRows('RPT_DMSK_FN_CASHFLOW', code, 5, true).catch(() => []),
      fetchDividendRate(code, quote.price).catch(() => null)
    ]);

    if (!latestIncomeRows.length) {
      throw new Error('未取到利润表数据');
    }

    const latestIncome = latestIncomeRows[0];
    const annualIncome = annualIncomeRows[0] || latestIncome;
    const threeYearsAgoAnnualIncome = chooseThreeYearsAgoAnnualRow(annualIncomeRows);
    const latestBalance = latestBalanceRows[0] || {};
    const latestGrossMargin = quote.latestGrossMargin ?? calcGrossMargin(latestIncome);
    const previousGrossMargin = calcGrossMargin(threeYearsAgoAnnualIncome);
    const debtRatio = quote.latestDebtRatio
      ?? toNumber(latestBalance.DEBT_ASSET_RATIO)
      ?? (toNumber(latestBalance.TOTAL_ASSETS) ? ((toNumber(latestBalance.TOTAL_LIABILITIES) || 0) / toNumber(latestBalance.TOTAL_ASSETS)) * 100 : null);
    const latestAnnualProfit = toYi(annualIncome.PARENT_NETPROFIT);
    const historicalGrowth = calcHistoricalProfitGrowth(annualIncomeRows);
    const fallbackCapex = average(annualCashFlowRows.map((row) => toYi(row.CONSTRUCT_LONG_ASSET)).filter((value) => value !== null));

    const [cashAverages, forecast] = await Promise.all([
      fetchTonghuashunCashAverages(code).catch(() => null),
      fetchProfitForecast(code, quote.totalShares, latestAnnualProfit).catch(() => null)
    ]);

    const industryText = `${forecast?.industry || ''},${forecast?.conceptText || ''},${quote.industry || ''},${quote.conceptText || ''}`;
    const indexInfo = chooseIndexForProfitTaking(forecast, quote);
    const profitTakingInfo = await fetchProfitTakingCoefficient(indexInfo).catch(() => ({
      coefficient: 1.382,
      ma60: null,
      ma250: null,
      indexName: indexInfo.name
    }));

    const dividendRate = quote.dividendRateTtm ?? dividendRateFallback;
    const dAndA = cashAverages?.dAndA;
    const capex = cashAverages?.capex ?? fallbackCapex;
    const perpetualGrowth = estimatePerpetualGrowth(industryText);
    const expectedGrowth = forecast?.expectedGrowth ?? historicalGrowth;
    const netProfit = forecast?.selectedNetProfit ?? latestAnnualProfit;
    const notes = [];

    qs('stock-search').value = `${quote.name} ${code}`;
    qs('stock-name').value = quote.name;
    qs('stock-code').value = code;
    setInputValue('stock-price', quote.price);
    setInputValue('dividend-rate', dividendRate ?? 0);
    setInputValue('total-shares', quote.totalShares);
    setInputValue('current-gross-margin', latestGrossMargin ?? 0);
    setInputValue('previous-gross-margin', previousGrossMargin ?? 0);
    setInputValue('debt-ratio', debtRatio ?? 0);
    setInputValue('d-and-a', dAndA ?? 0);
    setInputValue('capex', capex ?? 0);
    setInputValue('perpetual-growth', perpetualGrowth);
    setInputValue('expected-growth', expectedGrowth ?? 0);
    setInputValue('net-profit', netProfit ?? 0);
    setInputValue('profit-taking', profitTakingInfo.coefficient, 3);

    if (!dividendRate) notes.push('股息率TTM未取到，按0处理');
    if (latestGrossMargin === null) notes.push('最新毛利率未取到，按0处理');
    if (previousGrossMargin === null) notes.push('三年前年报毛利率未取到，按0处理');
    if (debtRatio === null) notes.push('负债率未取到，按0处理');
    if (dAndA === null || dAndA === undefined) notes.push('同花顺D&A明细未取到，按0处理');
    if (capex === null || capex === undefined) notes.push('Capex未取到，按0处理');
    if (!forecast) {
      notes.push('券商盈利预测未取到，使用历史年报增速和最近年报净利润兜底');
    } else {
      notes.push(`券商预测机构数${forecast.institutionCount}家，${forecast.institutionCount > 10 ? '高关注取三年预测低值' : '低关注取三年预测高值'}`);
    }
    const dAndANote = describeCashEstimate('D&A', dAndA, {
      yearCount: cashAverages?.dAndAYearCount,
      method: cashAverages?.dAndAMethod
    });
    const capexNote = describeCashEstimate('Capex', capex, {
      yearCount: cashAverages?.capexYearCount,
      method: cashAverages?.capexMethod
    });
    if (dAndANote) notes.push(dAndANote);
    if (capexNote) notes.push(capexNote);
    if (!capexNote && capex !== null && capex !== undefined) {
      notes.push('Capex按东方财富年度现金流均值兜底');
    }
    if (profitTakingInfo.ma60 === null || profitTakingInfo.ma250 === null) {
      notes.push(`${profitTakingInfo.indexName}均线数据不足，止盈系数按1.382`);
    } else {
      notes.push(`${profitTakingInfo.indexName} MA60${profitTakingInfo.ma60 > profitTakingInfo.ma250 ? '高于' : '低于'}MA250，止盈系数${profitTakingInfo.coefficient}`);
    }

    calculateValuation();

    const latestReportDate = latestIncome.REPORT_DATE ? latestIncome.REPORT_DATE.slice(0, 10) : '最新财报';
    const annualReportDate = annualIncome.REPORT_DATE ? annualIncome.REPORT_DATE.slice(0, 10) : '最新年报';
    setAsOfTime(`最新取数：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
    setDataStatus(`已填充 ${quote.name}（${code}），最新财报：${latestReportDate}，盈利预测基准年报：${annualReportDate}。${notes.join('；')}`, notes.length ? 'warning' : 'success');
    updateUrlStock(code);
  } catch (error) {
    setDataStatus(`取数失败：${error.message}`, 'error');
  } finally {
    setAutoButtonLoading(false);
  }
}

function getInputNumber(id) {
  const raw = qs(id).value.trim();
  if (raw === '') return null;
  return toNumber(raw);
}

function calculateInvestmentBankValuation({
  profitPredictions,
  discountRate,
  perpetualGrowth,
  expectedGrowth,
  currentGrossMargin,
  previousGrossMargin,
  debtRatio,
  dividendRate,
  dAndA,
  capex,
  reasonablePE,
  totalMarketCap
}) {
  const forwardNetProfit = profitPredictions[2];
  const debtRatioValue = debtRatio / 100;
  const dividendYield = dividendRate / 100;
  const growthRate = expectedGrowth / 100;
  const marginLevel = currentGrossMargin / 100;
  const marginTrend = (currentGrossMargin - previousGrossMargin) / 100;
  const rawTerminalGrowth = Math.max(perpetualGrowth / 100, 0.005);
  const terminalGrowth = Math.min(rawTerminalGrowth, Math.max(0.005, discountRate - 0.015));
  const forecastFcf = profitPredictions.slice(0, 5).map((profit) => profit + dAndA - capex);
  const pvFcf = forecastFcf.reduce((total, fcf, index) => total + fcf / Math.pow(1 + discountRate, index + 1), 0);
  const terminalFcf = forecastFcf[4] * (1 + terminalGrowth);
  const dcfValue = terminalFcf > 0 && discountRate > terminalGrowth
    ? pvFcf + (terminalFcf / (discountRate - terminalGrowth)) / Math.pow(1 + discountRate, 5)
    : null;
  const qualityAdjustment = clamp(
    1
      + marginTrend * 0.6
      + (marginLevel - 0.3) * 0.2
      - Math.max(debtRatioValue - 0.45, 0) * 0.35
      + dividendYield * 0.35,
    0.75,
    1.3
  ) ?? 1;
  const growthMultiple = 12 + (clamp(expectedGrowth, -20, 60) ?? 0) * 0.45;
  const targetPE = clamp((reasonablePE * 0.45 + growthMultiple * 0.55) * qualityAdjustment, 8, 45);
  const forwardPeValue = targetPE * forwardNetProfit;
  const forwardFcf = forwardNetProfit + dAndA - capex;
  const requiredFcfYield = clamp(discountRate - terminalGrowth + 0.015, 0.045, 0.12);
  const fcfYieldValue = forwardFcf > 0 && requiredFcfYield
    ? forwardFcf / requiredFcfYield
    : null;
  const fairValue = weightedAverage([
    { value: dcfValue, weight: 0.45 },
    { value: forwardPeValue, weight: 0.35 },
    { value: fcfYieldValue, weight: 0.2 }
  ]);
  const debtPenalty = Math.max(debtRatioValue - 0.45, 0);
  const growthSupport = clamp(growthRate, 0, 0.35) ?? 0;
  const marginSupport = Math.max(marginTrend, 0);
  const safetyMargin = clamp(
    0.22 + debtPenalty * 0.35 - growthSupport * 0.25 - marginSupport * 0.2 - dividendYield * 0.3,
    0.15,
    0.35
  );
  const sellPremium = clamp(
    0.18 + growthSupport * 0.4 + marginSupport * 0.25 - debtPenalty * 0.2,
    0.12,
    0.32
  );
  const buyValue = fairValue === null || safetyMargin === null ? null : fairValue * (1 - safetyMargin);
  const sellValue = fairValue === null || sellPremium === null ? null : fairValue * (1 + sellPremium);
  const upside = sellValue && totalMarketCap > 0 ? (sellValue / totalMarketCap - 1) * 100 : null;

  return {
    dcfValue,
    forwardPeValue,
    fcfYieldValue,
    fairValue,
    buyValue,
    sellValue,
    targetPE,
    safetyMargin,
    sellPremium,
    upside,
    terminalGrowth,
    requiredFcfYield,
    forwardFcf
  };
}

function calculateValuation() {
  const stockPrice = getInputNumber('stock-price') ?? 0;
  const dividendRate = getInputNumber('dividend-rate') ?? 0;
  const totalShares = getInputNumber('total-shares') ?? 0;
  const currentGrossMargin = getInputNumber('current-gross-margin') ?? 0;
  const previousGrossMargin = getInputNumber('previous-gross-margin') ?? 0;
  const debtRatio = getInputNumber('debt-ratio') ?? 0;
  const dAndA = getInputNumber('d-and-a') ?? 0;
  const capex = getInputNumber('capex') ?? 0;
  const perpetualGrowth = getInputNumber('perpetual-growth') ?? 0;
  const expectedGrowth = getInputNumber('expected-growth');
  const netProfit = getInputNumber('net-profit') ?? 0;
  const profitTaking = getInputNumber('profit-taking') ?? 0;

  if (stockPrice <= 0 || totalShares <= 0 || netProfit <= 0 || !Number.isFinite(expectedGrowth)) {
    setDataStatus('请先补齐股价、总股本、预计N归母净利润和预期增速。', 'error');
    return null;
  }

  const discountRate = 0.035 + (debtRatio / 100) * 0.09;
  const totalMarketCap = stockPrice * totalShares;
  const profitPredictions = [netProfit];

  for (let index = 1; index <= 2; index += 1) {
    profitPredictions.push(netProfit * Math.pow(1 + expectedGrowth / 100, index));
  }
  profitPredictions.push(profitPredictions[2] * (1 + (expectedGrowth / 100) * 0.6));
  for (let index = 4; index <= 9; index += 1) {
    profitPredictions.push(profitPredictions[index - 1] * (1 + (expectedGrowth / 100) * 0.6));
  }

  const tenYearTotalProfit = profitPredictions.reduce((sum, profit) => sum + profit, 0);
  const grossMarginDiff = (currentGrossMargin - previousGrossMargin) / 100;
  const debtAdjustment = clamp(1 + (0.5 - debtRatio / 100), 0.6, 1.4);
  const buyingCoefficient = debtAdjustment * (1 + dividendRate / 100) * (1 + grossMarginDiff);
  const intrinsicValue = tenYearTotalProfit * buyingCoefficient;
  const intrinsicSellValue = intrinsicValue * profitTaking;
  const buyPoints = Array.from({ length: 5 }, (_, index) => intrinsicValue * Math.pow(0.9, index + 1));
  const finalBuyPoint = intrinsicValue * Math.pow(0.9, 9);
  const reasonablePE = (1 / (discountRate / 2)) * 0.8;
  const peSellValue = reasonablePE * profitPredictions[2];
  const normalizedFcf = profitPredictions[2] + dAndA - capex;
  const fcfBasedValuationUsable = normalizedFcf > 0;
  const totalSurplusValue = fcfBasedValuationUsable ? normalizedFcf / discountRate : null;
  const surplusDenominator = discountRate - perpetualGrowth / 100;
  const surplusSellValue = fcfBasedValuationUsable && surplusDenominator > 0.001
    ? normalizedFcf / surplusDenominator
    : null;
  const comprehensiveSellValue = averagePositive([intrinsicSellValue, peSellValue, surplusSellValue]);
  const comprehensiveMarketStatus = getMarketStatus(comprehensiveSellValue, totalMarketCap);
  const investmentBankValuation = calculateInvestmentBankValuation({
    profitPredictions,
    discountRate,
    perpetualGrowth,
    expectedGrowth,
    currentGrossMargin,
    previousGrossMargin,
    debtRatio,
    dividendRate,
    dAndA,
    capex,
    reasonablePE,
    totalMarketCap
  });

  setTextValue('discount-rate', discountRate * 100, 2, '%');
  setTextValue('buying-coefficient', buyingCoefficient, 4);
  setTextValue('intrinsic-value', intrinsicValue);
  setTextValue('total-surplus-value', totalSurplusValue);
  setTextValue('reasonable-pe', reasonablePE);
  setTextValue('total-market-cap', totalMarketCap);
  setTextValue('intrinsic-sell-value', intrinsicSellValue);
  setTextValue('pe-sell-value', peSellValue);
  setTextValue('surplus-sell-value', surplusSellValue);
  setTextValue('comprehensive-sell-value', comprehensiveSellValue);
  setTextValue('summary-sell-value', comprehensiveSellValue);
  setTextValue('ib-fair-value', investmentBankValuation.fairValue);
  setTextValue('ib-buy-value', investmentBankValuation.buyValue);
  setTextValue('ib-sell-value', investmentBankValuation.sellValue);
  setTextValue('ib-upside', investmentBankValuation.upside, 2, '%');
  setTextValue('ib-dcf-value', investmentBankValuation.dcfValue);
  setTextValue('ib-forward-pe-value', investmentBankValuation.forwardPeValue);
  setTextValue('ib-fcf-yield-value', investmentBankValuation.fcfYieldValue);
  setTextValue('ib-target-pe', investmentBankValuation.targetPE, 2, 'x');
  setTextValue('ib-safety-margin', ratioToPercent(investmentBankValuation.safetyMargin), 2, '%');
  setTextValue('ib-sell-premium', ratioToPercent(investmentBankValuation.sellPremium), 2, '%');
  const surplusFallbackText = fcfBasedValuationUsable
    ? '对应股价 -- 元/股'
    : 'N+2自由现金流为负，暂不纳入综合';
  const sellPrices = {
    intrinsicSellPrice: setPointPrice('intrinsic-sell-price', intrinsicSellValue, totalShares),
    peSellPrice: setPointPrice('pe-sell-price', peSellValue, totalShares),
    surplusSellPrice: setPointPrice('surplus-sell-price', surplusSellValue, totalShares, surplusFallbackText),
    comprehensiveSellPrice: setPointPrice('comprehensive-sell-price', comprehensiveSellValue, totalShares)
  };
  setPointPrice('summary-sell-price', comprehensiveSellValue, totalShares);
  setMarketStatus('comprehensive-market-status', comprehensiveMarketStatus);
  setMarketStatus('summary-market-status', comprehensiveMarketStatus);
  const investmentBankPrices = {
    ibFairPrice: setPointPrice('ib-fair-price', investmentBankValuation.fairValue, totalShares),
    ibBuyPrice: setPointPrice('ib-buy-price', investmentBankValuation.buyValue, totalShares),
    ibSellPrice: setPointPrice('ib-sell-price', investmentBankValuation.sellValue, totalShares)
  };
  buyPoints.forEach((point, index) => setTextValue(`buy-point-${index + 1}`, point));
  setTextValue('final-buy-point', finalBuyPoint);
  const buyPointPrices = buyPoints.map((point, index) => setPointPrice(`buy-point-${index + 1}-price`, point, totalShares));
  const finalBuyPointPrice = setPointPrice('final-buy-point-price', finalBuyPoint, totalShares);
  renderProfitChart(profitPredictions);
  qs('save-btn').disabled = false;

  currentValuation = {
    stockName: qs('stock-name').value || '未知公司',
    stockCode: qs('stock-code').value || '未知代码',
    valuationDate: new Date().toISOString().split('T')[0],
    sourceNote: qs('data-status').textContent,
    inputs: {
      stockPrice,
      dividendRate,
      totalShares,
      currentGrossMargin,
      previousGrossMargin,
      debtRatio,
      dAndA,
      capex,
      perpetualGrowth,
      expectedGrowth,
      netProfit,
      profitTaking
    },
    outputs: {
      discountRate,
      debtAdjustment,
      buyingCoefficient,
      normalizedFcf,
      fcfBasedValuationUsable,
      intrinsicValue,
      totalSurplusValue,
      reasonablePE,
      totalMarketCap,
      intrinsicSellValue,
      peSellValue,
      surplusSellValue,
      comprehensiveSellValue,
      comprehensiveMarketStatus,
      ...sellPrices,
      investmentBankValuation,
      ...investmentBankPrices,
      buyPoints,
      buyPointPrices,
      finalBuyPoint,
      finalBuyPointPrice,
      profitPredictions
    }
  };

  return currentValuation;
}

function renderProfitChart(profitPredictions) {
  if (!window.Chart) {
    qs('chart-fallback').classList.remove('hidden');
    return;
  }
  qs('chart-fallback').classList.add('hidden');
  const context = qs('profit-chart').getContext('2d');
  if (profitChart) {
    profitChart.destroy();
  }

  profitChart = new Chart(context, {
    type: 'bar',
    data: {
      labels: ['N', 'N+1', 'N+2', 'N+3', 'N+4', 'N+5', 'N+6', 'N+7', 'N+8', 'N+9'],
      datasets: [{
        label: '预计归母净利润（亿元）',
        data: profitPredictions,
        backgroundColor: '#0f766e',
        borderColor: '#0b5f59',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true },
        x: { grid: { display: false } }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (context) => `净利润：${formatNumber(context.raw)} 亿元`
          }
        },
        legend: {
          display: true,
          position: 'top'
        }
      }
    }
  });
}

function saveValuation() {
  const valuation = currentValuation || calculateValuation();
  if (!valuation) return;

  const record = {
    id: Date.now(),
    ...valuation
  };
  savedValuations.unshift(record);
  savedValuations = savedValuations.slice(0, 100);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedValuations));
  loadHistory();
  showToast('估值结果已保存');
}

function loadHistory() {
  const body = qs('history-table-body');
  body.innerHTML = '';

  if (!savedValuations.length) {
    body.innerHTML = '<tr><td colspan="6">暂无历史记录</td></tr>';
    return;
  }

  savedValuations.forEach((record) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHTML(record.stockName)}</td>
      <td>${escapeHTML(record.stockCode)}</td>
      <td>${escapeHTML(record.valuationDate)}</td>
      <td>${formatNumber(record.outputs?.intrinsicValue)}</td>
      <td>${formatNumber(record.outputs?.comprehensiveSellValue)}</td>
      <td>
        <button class="ghost-btn view-detail-btn" type="button" data-id="${record.id}"><i data-lucide="eye"></i><span>查看</span></button>
        <button class="ghost-btn ghost-btn--danger delete-record-btn" type="button" data-id="${record.id}"><i data-lucide="trash-2"></i><span>删除</span></button>
      </td>
    `;
    body.appendChild(row);
  });

  body.querySelectorAll('.view-detail-btn').forEach((button) => {
    button.addEventListener('click', () => showHistoryDetail(Number(button.dataset.id)));
  });
  body.querySelectorAll('.delete-record-btn').forEach((button) => {
    button.addEventListener('click', () => deleteRecord(Number(button.dataset.id)));
  });
  refreshIcons();
}

function showHistoryDetail(recordId) {
  const record = savedValuations.find((item) => item.id === recordId);
  if (!record) return;

  qs('modal-title').textContent = `${record.stockName}（${record.stockCode}）估值详情`;
  qs('modal-content').innerHTML = `
    <div class="detail-grid">
      ${detailSection('基本信息', [
    ['估值日期', record.valuationDate],
    ['股价', `${formatNumber(record.inputs.stockPrice)} 元`],
    ['总股本', `${formatNumber(record.inputs.totalShares)} 亿股`],
    ['总市值', `${formatNumber(record.outputs.totalMarketCap)} 亿元`]
  ])}
      ${detailSection('关键指标', [
    ['贴现率', `${formatNumber(record.outputs.discountRate * 100)}%`],
    ['买入系数', formatNumber(record.outputs.buyingCoefficient, 4)],
    ['合理PE', formatNumber(record.outputs.reasonablePE)],
    ['N+2自由现金流', `${formatNumber(record.outputs.normalizedFcf)} 亿元`],
    ['总体盈余口径', record.outputs.fcfBasedValuationUsable ? '已纳入综合卖点' : '自由现金流为负，未纳入综合卖点'],
    ['股息率TTM', `${formatNumber(record.inputs.dividendRate)}%`]
  ])}
      ${detailSection('输入参数', [
    ['负债率', `${formatNumber(record.inputs.debtRatio)}%`],
    ['最新毛利率', `${formatNumber(record.inputs.currentGrossMargin)}%`],
    ['三年前毛利率', `${formatNumber(record.inputs.previousGrossMargin)}%`],
    ['D&A', `${formatNumber(record.inputs.dAndA)} 亿元`],
    ['Capex', `${formatNumber(record.inputs.capex)} 亿元`],
    ['永续增长率', `${formatNumber(record.inputs.perpetualGrowth)}%`],
    ['预期增速', `${formatNumber(record.inputs.expectedGrowth)}%`],
    ['预计N归母净利润', `${formatNumber(record.inputs.netProfit)} 亿元`],
    ['止盈系数', `${formatNumber(record.inputs.profitTaking, 3)} 倍`]
  ])}
      ${detailSection('估值结果', [
    ['内在价值', `${formatNumber(record.outputs.intrinsicValue)} 亿元`],
    ['总体盈余内在价值', `${formatNumber(record.outputs.totalSurplusValue)} 亿元`],
    ['内在价值卖点', `${formatNumber(record.outputs.intrinsicSellValue)} 亿元`],
    ['PE卖点', `${formatNumber(record.outputs.peSellValue)} 亿元`],
    ['总体盈余卖点', `${formatNumber(record.outputs.surplusSellValue)} 亿元`],
    ['综合卖点', `${formatNumber(record.outputs.comprehensiveSellValue)} 亿元`],
    ['综合卖点状态', record.outputs.comprehensiveMarketStatus?.text || '当前市值对比 --']
  ])}
      ${detailSection('投行估值口径', [
    ['DCF/FCFF估值', `${formatNumber(record.outputs.investmentBankValuation?.dcfValue)} 亿元`],
    ['远期PE估值', `${formatNumber(record.outputs.investmentBankValuation?.forwardPeValue)} 亿元`],
    ['FCF收益率估值', `${formatNumber(record.outputs.investmentBankValuation?.fcfYieldValue)} 亿元`],
    ['投行合理市值', `${formatNumber(record.outputs.investmentBankValuation?.fairValue)} 亿元`],
    ['投行买点市值', `${formatNumber(record.outputs.investmentBankValuation?.buyValue)} 亿元`],
    ['投行卖点市值', `${formatNumber(record.outputs.investmentBankValuation?.sellValue)} 亿元`],
    ['投行目标PE', `${formatNumber(record.outputs.investmentBankValuation?.targetPE)}x`],
    ['安全边际', `${formatNumber(ratioToPercent(record.outputs.investmentBankValuation?.safetyMargin))}%`],
    ['卖点溢价', `${formatNumber(ratioToPercent(record.outputs.investmentBankValuation?.sellPremium))}%`]
  ])}
      ${detailSection('对应股价', [
    ['内在价值卖点股价', `${formatNumber(record.outputs.intrinsicSellPrice)} 元/股`],
    ['PE卖点股价', `${formatNumber(record.outputs.peSellPrice)} 元/股`],
    ['总体盈余卖点股价', `${formatNumber(record.outputs.surplusSellPrice)} 元/股`],
    ['综合卖点股价', `${formatNumber(record.outputs.comprehensiveSellPrice)} 元/股`],
    ['投行合理股价', `${formatNumber(record.outputs.ibFairPrice)} 元/股`],
    ['投行买点股价', `${formatNumber(record.outputs.ibBuyPrice)} 元/股`],
    ['投行卖点股价', `${formatNumber(record.outputs.ibSellPrice)} 元/股`],
    ['加仓点一股价', `${formatNumber(record.outputs.buyPointPrices?.[0])} 元/股`],
    ['加仓点二股价', `${formatNumber(record.outputs.buyPointPrices?.[1])} 元/股`],
    ['加仓点三股价', `${formatNumber(record.outputs.buyPointPrices?.[2])} 元/股`],
    ['加仓点四股价', `${formatNumber(record.outputs.buyPointPrices?.[3])} 元/股`],
    ['加仓点五股价', `${formatNumber(record.outputs.buyPointPrices?.[4])} 元/股`],
    ['最后加仓点股价', `${formatNumber(record.outputs.finalBuyPointPrice)} 元/股`]
  ])}
    </div>
    <div class="detail-section" style="margin-top:12px">
      <h4>取数说明</h4>
      <p>${escapeHTML(record.sourceNote || '无')}</p>
    </div>
  `;
  openModal('history-detail-modal');
}

function detailSection(title, rows) {
  const content = rows.map(([label, value]) => `<p><strong>${escapeHTML(label)}：</strong>${escapeHTML(value)}</p>`).join('');
  return `<div class="detail-section"><h4>${escapeHTML(title)}</h4>${content}</div>`;
}

function deleteRecord(recordId) {
  if (!window.confirm('确定要删除这条记录吗？')) return;
  savedValuations = savedValuations.filter((record) => record.id !== recordId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedValuations));
  loadHistory();
  showToast('记录已删除');
}

function clearHistory() {
  if (!savedValuations.length) return;
  if (!window.confirm('确定要清空所有历史记录吗？此操作不可恢复。')) return;
  savedValuations = [];
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('stockValuations');
  loadHistory();
  showToast('历史记录已清空');
}

function exportHistory() {
  const payload = JSON.stringify(savedValuations, null, 2);
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `valuation-history-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyShareLink() {
  const code = qs('stock-code').value.trim() || normalizeStockKeyword(qs('stock-search').value.trim());
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('stock', code);

  try {
    await navigator.clipboard.writeText(url.toString());
    showToast('链接已复制');
  } catch {
    window.prompt('复制链接', url.toString());
  }
}

function updateUrlStock(code) {
  if (!code || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.set('stock', code);
  window.history.replaceState({}, '', url);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
