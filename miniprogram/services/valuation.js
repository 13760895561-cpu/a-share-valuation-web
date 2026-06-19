const EASTMONEY_DATACENTER = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const SEARCH_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';

function buildQuery(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

function requestJson(url, params = {}, options = {}) {
  const query = buildQuery(params);
  const requestUrl = query ? `${url}?${query}` : url;
  const retries = options.retries ?? 1;
  const timeout = options.timeout ?? 15000;

  function run(attempt) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: requestUrl,
        method: 'GET',
        timeout,
        header: {
          Accept: 'application/json,text/plain,*/*'
        },
        success(res) {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
            resolve(data);
          } catch (error) {
            reject(new Error('接口返回不是有效JSON'));
          }
        },
        fail(error) {
          reject(new Error(error?.errMsg || '网络请求失败'));
        }
      });
    }).catch((error) => {
      if (attempt >= retries) throw error;
      return new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1))).then(() => run(attempt + 1));
    });
  }

  return run(0);
}

function decodeArrayBuffer(buffer, encoding = 'utf-8') {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch (error) {
      try {
        return new TextDecoder('utf-8').decode(buffer);
      } catch {
        return '';
      }
    }
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  try {
    return decodeURIComponent(escape(binary));
  } catch {
    return binary;
  }
}

function requestText(url, params = {}, options = {}) {
  const query = buildQuery(params);
  const requestUrl = query ? `${url}?${query}` : url;
  const timeout = options.timeout ?? 15000;
  const encoding = options.encoding ?? 'utf-8';

  return new Promise((resolve, reject) => {
    wx.request({
      url: requestUrl,
      method: 'GET',
      timeout,
      responseType: 'arraybuffer',
      header: {
        Accept: 'text/html,text/plain,*/*'
      },
      success(res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        resolve(decodeArrayBuffer(res.data, encoding));
      },
      fail(error) {
        reject(new Error(error?.errMsg || '文本请求失败'));
      }
    });
  });
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

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
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

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatNumber(value, digits = 2) {
  const number = toNumber(value);
  if (number === null) return '--';
  return Number(number.toFixed(digits)).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function calcPointPrice(marketValue, totalShares) {
  const value = toNumber(marketValue);
  const shares = toNumber(totalShares);
  if (value === null || !shares || shares <= 0) return null;
  return value / shares;
}

function formatPointPrice(marketValue, totalShares) {
  const price = calcPointPrice(marketValue, totalShares);
  return price === null ? '对应股价 -- 元/股' : `对应股价 ${formatNumber(price)} 元/股`;
}

function normalizeStockKeyword(value) {
  const trimmed = String(value || '').trim();
  const codeMatch = trimmed.match(/(?:sh|sz|bj)?\s*(\d{6})|(\d{6})\s*(?:\.|\s)*(?:sh|sz|bj)/i);
  return codeMatch ? (codeMatch[1] || codeMatch[2]) : trimmed;
}

function getStockMarketPrefix(code) {
  const normalizedCode = String(code || '').replace(/\D/g, '');
  if (/^(600|601|603|605|688|689)\d{3}$/.test(normalizedCode)) return '1';
  return '0';
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

function isAStockCandidate(item) {
  const code = String(item.Code || item.UnifiedCode || '');
  const typeName = item.SecurityTypeName || '';
  const isAStockCode = /^(600|601|603|605|688|689|000|001|002|003|300|301|430|830|831|832|833|834|835|836|837|838|839|870|871|872|873|874|875|876|877|878|879|880|881|882|883|884|885|886|887|888|889)\d{3}$/.test(code);
  const isAStockType = /A|沪|深|京|科创|创业|北交/.test(typeName);
  return item.Code && item.Name && (item.Classify === 'AStock' || isAStockType || isAStockCode);
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

function getAnnualFinancialMetrics(row) {
  const revenue = toYi(row?.TOTAL_OPERATE_INCOME);
  const profit = toYi(row?.PARENT_NETPROFIT);
  return {
    year: getYear(row?.REPORT_DATE),
    revenue,
    profit,
    grossMargin: calcGrossMargin(row),
    netMargin: revenue && profit !== null ? (profit / revenue) * 100 : null
  };
}

function calculateGrowthRate(current, previous) {
  const currentNumber = toNumber(current);
  const previousNumber = toNumber(previous);
  if (currentNumber === null || previousNumber === null || previousNumber <= 0) return null;
  return (currentNumber / previousNumber - 1) * 100;
}

function calculateCagr(current, base, years) {
  const currentNumber = toNumber(current);
  const baseNumber = toNumber(base);
  if (currentNumber === null || baseNumber === null || !years || currentNumber <= 0 || baseNumber <= 0) return null;
  return (Math.pow(currentNumber / baseNumber, 1 / years) - 1) * 100;
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

function getIndustryProfile(industryText) {
  const text = industryText || '';
  if (/银行|保险|证券|金融/.test(text)) {
    return { label: '金融行业', baseGrowth: 3, hotspotScore: 38, targetMargin: 12, marketAnchorMultiple: 10, growthCap: 12, stage: 'financial', cycleScore: 45, demandScore: 48, supplyScore: 52, valuationBias: 0.88, peBase: 8, peMin: 4.5, peMax: 12, pbBase: 0.85, preferredMethods: ['PB', 'DDM', 'forwardPE'], cycleLabel: '金融资产质量和利差周期约束估值' };
  }
  if (/白酒|酿酒|酒类|贵州茅台|五粮液|泸州老窖|山西汾酒|洋河股份/.test(text)) {
    return { label: '高端白酒/可选消费', baseGrowth: 2, hotspotScore: 30, targetMargin: 32, marketAnchorMultiple: 16, growthCap: 12, stage: 'mature-consumption', cycleScore: 38, demandScore: 42, supplyScore: 44, valuationBias: 0.82, peBase: 18, peMin: 12, peMax: 24, preferredMethods: ['forwardPE', 'DDM', 'FCFE', 'EVEBITDA'], cycleLabel: '需求换挡，渠道和价格体系更需保守验证' };
  }
  if (/半导体|芯片|集成电路|人工智能|AI|算力|软件|计算机|通信|电子|机器人|新能源|电池|光伏|军工|高端装备|创新药|生物医药|低空经济|卫星|数据中心/.test(text)) {
    return { label: '高成长科技/创新产业', baseGrowth: 15, hotspotScore: 82, targetMargin: 8, marketAnchorMultiple: 24, growthCap: 45, stage: 'growth', cycleScore: 74, demandScore: 72, supplyScore: 58, valuationBias: 1.08, peBase: 28, peMin: 16, peMax: 48, preferredMethods: ['forwardPE', 'PEG', 'FCFF', 'EVSales', 'Capacity'], cycleLabel: '成长景气较高，但需验证订单、产能和现金流兑现' };
  }
  if (/医药|医疗|消费电子|汽车|机械|化工|新材料|传媒|互联网|游戏|智能终端|智能硬件|MR|AR|VR|折叠屏/.test(text)) {
    return { label: '成长制造/消费科技', baseGrowth: 11, hotspotScore: 68, targetMargin: 6, marketAnchorMultiple: 22, growthCap: 38, stage: 'growth', cycleScore: 62, demandScore: 63, supplyScore: 55, valuationBias: 1, peBase: 24, peMin: 14, peMax: 40, preferredMethods: ['forwardPE', 'PEG', 'FCFF', 'EVSales'], cycleLabel: '成长属性仍在，但景气与竞争格局需要动态跟踪' };
  }
  if (/食品|饮料|白酒|家电|家居|农业|纺织|服装|零售|物流|快递/.test(text)) {
    return { label: '消费/稳定经营行业', baseGrowth: 6, hotspotScore: 48, targetMargin: 8, marketAnchorMultiple: 18, growthCap: 24, stage: 'stable', cycleScore: 52, demandScore: 55, supplyScore: 58, valuationBias: 0.92, peBase: 20, peMin: 12, peMax: 30, preferredMethods: ['forwardPE', 'DDM', 'FCFE'], cycleLabel: '稳定消费，重点看需求韧性和渠道库存' };
  }
  if (/房地产|房屋|物业|建筑|水泥|钢铁|煤炭|石油|公路|铁路|港口|机场|电力|燃气|水务|环保/.test(text)) {
    return { label: '传统周期/金融公用行业', baseGrowth: 3, hotspotScore: 35, targetMargin: 3, marketAnchorMultiple: 12, growthCap: 16, stage: 'traditional', cycleScore: 40, demandScore: 44, supplyScore: 50, valuationBias: 0.86, peBase: 12, peMin: 6, peMax: 18, pbBase: 1, preferredMethods: ['PB', 'FCFF', 'EVEBITDA', 'NAV'], cycleLabel: '周期和政策约束较强，重视资产质量与现金流' };
  }
  return { label: '一般制造/综合行业', baseGrowth: 8, hotspotScore: 55, targetMargin: 4, marketAnchorMultiple: 18, growthCap: 30, stage: 'balanced', cycleScore: 55, demandScore: 56, supplyScore: 55, valuationBias: 0.96, peBase: 20, peMin: 10, peMax: 32, preferredMethods: ['forwardPE', 'FCFF', 'EVEBITDA'], cycleLabel: '综合行业，按盈利质量和现金流折中估值' };
}

function getScoreLabel(score) {
  const value = toNumber(score);
  if (value === null) return '数据不足';
  if (value >= 72) return '偏强';
  if (value >= 58) return '中性偏强';
  if (value >= 45) return '中性';
  if (value >= 35) return '偏弱';
  return '明显偏弱';
}

function getTerminalGrowthCap(profile) {
  if (profile?.stage === 'mature-consumption') return 0.015;
  if (profile?.stage === 'financial' || profile?.stage === 'traditional') return 0.012;
  if (profile?.stage === 'growth') return 0.03;
  return 0.022;
}

async function searchStockCandidate(keyword) {
  const input = normalizeStockKeyword(keyword);
  const directCandidate = candidateFromCode(input);
  if (directCandidate) return directCandidate;

  const response = await requestJson('https://searchapi.eastmoney.com/api/suggest/get', {
    input,
    type: '14',
    token: SEARCH_TOKEN,
    count: '8'
  }, { timeout: 10000, retries: 1 });

  const candidates = response?.QuotationCodeTable?.Data || [];
  const aShares = candidates.filter(isAStockCandidate);
  if (!aShares.length) throw new Error('未找到匹配的A股股票');
  return aShares.find((item) => item.Code === input) || aShares.find((item) => item.Name === keyword.trim()) || aShares[0];
}

async function fetchStockQuote(candidate) {
  const response = await requestJson('https://push2delay.eastmoney.com/api/qt/stock/get', {
    secid: buildStockSecId(candidate),
    fields: 'f43,f57,f58,f84,f85,f116,f117,f126,f127,f129,f152,f186,f188'
  }, { timeout: 12000, retries: 1 });
  const data = response?.data;
  if (!data) throw new Error('未取到实时行情数据');
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
  const filter = includeDateType ? `(SECURITY_CODE="${code}")(DATE_TYPE_CODE="001")` : `(SECURITY_CODE="${code}")`;
  const response = await requestJson(EASTMONEY_DATACENTER, {
    reportName,
    columns: 'ALL',
    filter,
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
    pageSize: String(pageSize),
    pageNumber: '1'
  }, { timeout: 18000, retries: 1 });
  if (response?.success === false) throw new Error(response.message || '财务数据接口返回异常');
  return response?.result?.data || [];
}

async function fetchDatacenterReport(reportName, params = {}) {
  const response = await requestJson(EASTMONEY_DATACENTER, {
    reportName,
    columns: 'ALL',
    pageSize: '20',
    pageNumber: '1',
    ...params
  }, { timeout: 18000, retries: 1 });
  if (response?.success === false) throw new Error(response.message || '数据中心接口返回异常');
  return response?.result?.data || [];
}

async function fetchDividendRate(code, price) {
  const rows = await fetchDatacenterRows('RPT_SHAREBONUS_DET', code, 8, false);
  const dividend = rows.find((item) => toNumber(item.DIVIDENT_RATIO) || toNumber(item.PRETAX_BONUS_RMB));
  if (!dividend) return null;
  const ratio = toNumber(dividend.DIVIDENT_RATIO);
  if (ratio) return ratio > 1 ? ratio : ratio * 100;
  const pretaxBonusPerTenShares = toNumber(dividend.PRETAX_BONUS_RMB);
  if (pretaxBonusPerTenShares && price) return (pretaxBonusPerTenShares / 10 / price) * 100;
  return null;
}

function buildProfitForecastResult({ forecastItems, institutionCount = 0, latestAnnualProfit, industry = '', conceptText = '', source = 'broker', detail = '' }) {
  const validItems = (forecastItems || [])
    .filter((item) => Number.isFinite(item.netProfit) && item.netProfit !== 0)
    .sort((a, b) => (a.year || 0) - (b.year || 0));
  if (!validItems.length) return null;
  const selectedNetProfit = institutionCount > 10
    ? Math.min(...validItems.map((item) => item.netProfit))
    : Math.max(...validItems.map((item) => item.netProfit));
  const yoyGrowth = [];
  let previousProfit = latestAnnualProfit;
  validItems.forEach((item) => {
    if (previousProfit && item.netProfit && previousProfit > 0) yoyGrowth.push((item.netProfit / previousProfit - 1) * 100);
    previousProfit = item.netProfit;
  });
  return { institutionCount, selectedNetProfit, expectedGrowth: average(yoyGrowth), industry, conceptText, forecastItems: validItems, source, detail };
}

function buildEastmoneyF10Code(code) {
  const normalizedCode = String(code || '').replace(/\D/g, '');
  return /^(600|601|603|605|688|689)\d{3}$/.test(normalizedCode) ? `SH${normalizedCode}` : `SZ${normalizedCode}`;
}

async function fetchEastmoneyDatacenterProfitForecast(code, totalShares, latestAnnualProfit) {
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
    return { year, eps, netProfit: eps * totalShares };
  }).filter(Boolean);
  const institutionCount = toNumber(row.RATING_LONG_NUM) ?? toNumber(row.RATING_ORG_NUM) ?? 0;
  return buildProfitForecastResult({
    forecastItems,
    institutionCount,
    latestAnnualProfit,
    industry: row.INDUSTRY_BOARD || '',
    conceptText: row.CONCEPTINDEX_BOARD || '',
    source: 'eastmoney-datacenter',
    detail: `东方财富一致预测，券商预测机构数${institutionCount}家`
  });
}

async function fetchEastmoneyF10ProfitForecast(code, totalShares, latestAnnualProfit) {
  const response = await requestJson('https://emweb.eastmoney.com/PC_HSF10/ProfitForecast/PageAjax', {
    code: buildEastmoneyF10Code(code)
  }, { timeout: 15000, retries: 1 });
  const chartItems = (response?.yctj_chart || [])
    .filter((row) => String(row.YEAR_MARK || '').toUpperCase() === 'E')
    .map((row) => {
      const netProfit = toYi(row.PARENT_NETPROFIT);
      const eps = toNumber(row.EPS);
      const year = toNumber(row.YEAR);
      if (!netProfit || !year) return null;
      return { year, eps: eps ?? (totalShares ? netProfit / totalShares : null), netProfit };
    })
    .filter(Boolean);
  const consensusRow = (response?.jgyc || []).find((row) => [2, 3, 4].some((index) => toNumber(row[`EPS${index}`])));
  const consensusItems = consensusRow
    ? [2, 3, 4].map((index) => {
      const eps = toNumber(consensusRow[`EPS${index}`]);
      const year = toNumber(consensusRow[`YEAR${index}`]);
      if (!eps || !year || !totalShares) return null;
      return { year, eps, netProfit: eps * totalShares };
    }).filter(Boolean)
    : [];
  const ratingCounts = (response?.pjtj || []).map((row) => toNumber(row.RATING_ORG_NUM)).filter((value) => Number.isFinite(value));
  const institutionCount = ratingCounts.length ? Math.max(...ratingCounts) : (consensusItems.length ? 1 : 0);
  return buildProfitForecastResult({
    forecastItems: chartItems.length ? chartItems : consensusItems,
    institutionCount,
    latestAnnualProfit,
    source: 'eastmoney-f10',
    detail: `东方财富F10盈利预测，券商预测机构数${institutionCount}家`
  });
}

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '。')
    .replace(/<\/(p|div|dd|dt|li|h\d)>/gi, '。')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTonghuashunReportForecast(html, totalShares) {
  const plainText = htmlToPlainText(html);
  const compactText = plainText.replace(/\s+/g, '');
  const candidates = compactText.match(/(?:我们预计|预计公司|预测公司)[^。；;]{0,260}(?:归母净利润|归属于母公司[^。；;]{0,20}净利润|净利润)[^。；;]{0,160}/g) || [];
  for (const candidate of candidates) {
    const yearMatch = candidate.match(/(20\d{2})\s*\/\s*(20\d{2})\s*\/\s*(20\d{2})/);
    const profitMatch = candidate.match(/(?:归母净利润|归属于母公司[^，。；;]{0,20}净利润|净利润)(?:分别)?(?:为|达|约)?(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)(万亿|亿元|亿|万元|万)?/);
    if (!yearMatch || !profitMatch) continue;
    const unit = profitMatch[4] || '亿元';
    const unitMultiplier = unit.includes('万') && !unit.includes('亿') ? 1 / 10000 : unit.includes('万亿') ? 10000 : 1;
    const years = yearMatch.slice(1, 4).map(Number);
    const profits = profitMatch.slice(1, 4).map((value) => Number(value) * unitMultiplier);
    if (years.some((year) => !Number.isFinite(year)) || profits.some((profit) => !Number.isFinite(profit))) continue;
    const sourceMatch = plainText.match(/发布时间[:：]\s*(20\d{2}-\d{2}-\d{2})\s*来源[:：]\s*([^\s。]+)/);
    const countMatches = [...String(html || '').matchAll(/profit-forecast-tab-count-\d+">\s*(\d+)/g)].map((match) => Number(match[1])).filter((value) => Number.isFinite(value));
    const institutionCount = Math.max(sum(countMatches), 1);
    return {
      forecastItems: years.map((year, index) => ({ year, netProfit: profits[index], eps: totalShares ? profits[index] / totalShares : null })),
      institutionCount,
      detail: sourceMatch ? `同花顺研报预测${institutionCount}篇（${sourceMatch[2]}，${sourceMatch[1]}）` : `同花顺研报预测${institutionCount}篇`
    };
  }
  return null;
}

async function fetchTonghuashunResearchProfitForecast(code, totalShares, latestAnnualProfit) {
  const html = await requestText(`https://basic.10jqka.com.cn/${code}/worth.html`, {}, { timeout: 15000, encoding: 'gb18030' });
  const parsed = extractTonghuashunReportForecast(html, totalShares);
  if (!parsed) return null;
  return buildProfitForecastResult({
    forecastItems: parsed.forecastItems,
    institutionCount: parsed.institutionCount,
    latestAnnualProfit,
    source: 'tonghuashun-report',
    detail: parsed.detail
  });
}

async function fetchProfitForecast(code, totalShares, latestAnnualProfit) {
  const providers = [
    () => fetchEastmoneyDatacenterProfitForecast(code, totalShares, latestAnnualProfit),
    () => fetchEastmoneyF10ProfitForecast(code, totalShares, latestAnnualProfit),
    () => fetchTonghuashunResearchProfitForecast(code, totalShares, latestAnnualProfit)
  ];
  for (const provider of providers) {
    const result = await provider().catch(() => null);
    if (result) return result;
  }
  return null;
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

function estimateCashAverage(yearlyValues, preferredYears = 3) {
  const values = yearlyValues.filter((item) => Number.isFinite(item.value)).slice(0, Math.min(preferredYears, yearlyValues.length || preferredYears));
  return { value: average(values.map((item) => item.value)), baseAverage: average(values.map((item) => item.value)), yearCount: values.length, method: values.length ? 'average' : 'none' };
}

function estimateTrendAdjustedCashItem(yearlyValues, options = {}) {
  const { preferredYears = 3, stableTolerance = 0.3, upThreshold = 1.12, downThreshold = 0.88, volatilityLimit = 2.5 } = options;
  const base = estimateCashAverage(yearlyValues, preferredYears);
  const selectedValues = yearlyValues.filter((item) => Number.isFinite(item.value)).slice(0, base.yearCount);
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
  if (base.yearCount >= 3 && recentIsStable && (recentIsHigher || trendIsRising)) return { value: recentTwoAverage, baseAverage: base.baseAverage, yearCount: base.yearCount, method: 'trend-up' };
  if (base.yearCount >= 3 && recentIsStable && (recentIsLower || trendIsFalling)) return { value: recentTwoAverage, baseAverage: base.baseAverage, yearCount: base.yearCount, method: 'trend-down' };
  if (base.yearCount >= 3 && trendIsRising && newest > base.baseAverage * upThreshold) return { value: newest * 0.5 + previous * 0.3 + oldest * 0.2, baseAverage: base.baseAverage, yearCount: base.yearCount, method: 'trend-up' };
  if (base.yearCount >= 3 && trendIsFalling && newest < base.baseAverage * downThreshold) return { value: newest * 0.5 + previous * 0.3 + oldest * 0.2, baseAverage: base.baseAverage, yearCount: base.yearCount, method: 'trend-down' };
  if (base.yearCount >= 3 && volatilityIsHigh && !trendIsRising && !trendIsFalling) return { value: median(values), baseAverage: base.baseAverage, yearCount: base.yearCount, method: 'median' };
  return base;
}

async function fetchTonghuashunCashAverages(code) {
  const response = await requestJson(`https://basic.10jqka.com.cn/api/stock/finance/${code}_cash.json`, {}, { timeout: 15000, retries: 1 });
  const cashData = typeof response.flashData === 'string' ? JSON.parse(response.flashData || '{}') : {};
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
    const components = [parseCnAmountToYi(depreciation[index]), parseCnAmountToYi(intangibleAmortization[index]), parseCnAmountToYi(longPrepaidAmortization[index])];
    const validComponents = components.filter((value) => value !== null);
    if (validComponents.length) dAndAYearlyValues.push({ year: years[index], value: sum(validComponents), isComplete: validComponents.length === components.length });
    const capexValue = parseCnAmountToYi(capex[index]);
    if (capexValue !== null) capexYearlyValues.push({ year: years[index], value: capexValue });
  }
  const completeValues = dAndAYearlyValues.filter((item) => item.isComplete);
  const dAndAEstimate = estimateTrendAdjustedCashItem(completeValues.length >= 3 ? completeValues : dAndAYearlyValues, { preferredYears: 3, stableTolerance: 0.25, upThreshold: 1.08, downThreshold: 0.92, volatilityLimit: 2.8 });
  const capexEstimate = estimateTrendAdjustedCashItem(capexYearlyValues, { preferredYears: 3, stableTolerance: 0.35, upThreshold: 1.15, downThreshold: 0.85, volatilityLimit: 2.5 });
  return { dAndA: dAndAEstimate.value, capex: capexEstimate.value, dAndAYearCount: dAndAEstimate.yearCount, capexYearCount: capexEstimate.yearCount, dAndAMethod: dAndAEstimate.method, capexMethod: capexEstimate.method };
}

function estimatePerpetualGrowth(industryText) {
  const text = industryText || '';
  if (/房地产|房屋|物业|建筑|水泥|钢铁|煤炭|石油|银行|保险|证券|公路|铁路|港口|机场|电力|燃气|水务|环保/.test(text)) return 1;
  if (/半导体|芯片|集成电路|人工智能|AI|软件|计算机|通信|电子|机器人|新能源|电池|光伏|军工|高端装备|创新药|生物医药/.test(text)) return 3.8;
  if (/医药|医疗|消费电子|汽车|机械|化工|新材料|传媒|互联网|游戏/.test(text)) return 3;
  if (/食品|饮料|白酒|家电|家居|农业|纺织|服装|零售|物流/.test(text)) return 2.5;
  return 2.5;
}

function parseEastmoneyKline(row) {
  const parts = String(row || '').split(',');
  return { date: parts[0], open: toNumber(parts[1]), close: toNumber(parts[2]), high: toNumber(parts[3]), low: toNumber(parts[4]), volume: toNumber(parts[5]), amount: toNumber(parts[6]), turnoverRate: toNumber(parts[10]) };
}

function parseTencentKline(row) {
  return { date: row?.[0], open: toNumber(row?.[1]), close: toNumber(row?.[2]), high: toNumber(row?.[3]), low: toNumber(row?.[4]), volume: toNumber(row?.[5]), amount: null, turnoverRate: null };
}

async function fetchEastmoneyTrendRows(code) {
  const response = await requestJson('https://push2his.eastmoney.com/api/qt/stock/kline/get', {
    secid: `${getStockMarketPrefix(code)}.${code}`,
    klt: '101',
    fqt: '1',
    lmt: '520',
    end: '20500101',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
  }, { timeout: 12000, retries: 1 });
  return (response?.data?.klines || []).map(parseEastmoneyKline).filter((item) => item.close !== null);
}

async function fetchTencentTrendRows(code) {
  const normalizedCode = String(code || '').replace(/\D/g, '');
  const marketCode = getStockMarketPrefix(normalizedCode) === '1' ? `sh${normalizedCode}` : `sz${normalizedCode}`;
  const response = await requestJson('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get', {
    param: `${marketCode},day,,,520,qfq`
  }, { timeout: 12000, retries: 1 });
  const data = response?.data?.[marketCode] || {};
  const rows = data.qfqday || data.day || [];
  return rows.map(parseTencentKline).filter((item) => item.close !== null);
}

function calculateMarketReturn(closes, days) {
  if (!Array.isArray(closes) || closes.length <= days) return null;
  return calculateGrowthRate(closes[closes.length - 1], closes[closes.length - 1 - days]);
}

async function fetchStockTrendContext(code, quote) {
  let rows = await fetchEastmoneyTrendRows(code).catch(() => []);
  if (rows.length < 120) rows = await fetchTencentTrendRows(code).catch(() => []);
  if (rows.length < 120) return null;
  const closes = rows.map((item) => item.close);
  const latestClose = quote?.price || closes[closes.length - 1];
  const ma60 = average(closes.slice(-60));
  const ma250 = average(closes.slice(-250));
  const return250 = calculateMarketReturn(closes, 250);
  const return500 = calculateMarketReturn(closes, Math.min(500, closes.length - 1));
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const drawdownFromHigh = high ? (latestClose / high - 1) * 100 : null;
  const priceToMa250 = ma250 ? (latestClose / ma250 - 1) * 100 : null;
  const recentTurnover = average(rows.slice(-60).map((item) => item.turnoverRate).filter((value) => value !== null));
  const medianPrice250 = median(closes.slice(-250));
  const medianPrice500 = median(closes.slice(-Math.min(500, closes.length)));
  const totalShares = quote?.totalShares;
  const trendScore = clamp(50 + (return250 ?? 0) * 0.18 + (return500 ?? 0) * 0.08 + (priceToMa250 ?? 0) * 0.45 + Math.max((drawdownFromHigh ?? -30) + 30, 0) * 0.25 + Math.min(recentTurnover ?? 0, 8) * 1.4, 20, 95) ?? 50;
  const trendLabel = trendScore >= 75 ? '长期强势' : trendScore >= 62 ? '中长期偏强' : trendScore >= 45 ? '中性震荡' : '中长期偏弱';
  return { tradingDays: rows.length, latestClose, ma60, ma250, return250, return500, drawdownFromHigh, priceToMa250, recentTurnover, medianMarketCap250: medianPrice250 && totalShares ? medianPrice250 * totalShares : null, medianMarketCap500: medianPrice500 && totalShares ? medianPrice500 * totalShares : null, high, low, trendScore, trendLabel };
}

async function fetchProfitTakingCoefficient(indexInfo) {
  const code = indexInfo.tencentCode;
  const response = await requestJson('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get', {
    param: `${code},day,,,260,qfq`
  }, { timeout: 10000, retries: 1 });
  const closes = (response?.data?.[code]?.day || []).map((item) => toNumber(item[2])).filter((value) => value !== null);
  if (closes.length < 250) return { coefficient: 1.382, ma60: null, ma250: null, indexName: indexInfo.name };
  const ma60 = average(closes.slice(-60));
  const ma250 = average(closes.slice(-250));
  return { coefficient: ma60 > ma250 ? 1.618 : 1.382, ma60, ma250, indexName: indexInfo.name };
}

function chooseIndexForProfitTaking(forecast, quote) {
  const text = `${forecast?.conceptText || ''},${quote.conceptText || ''}`;
  if (/HS300|沪深300|上证50|上证180/.test(text)) return { tencentCode: 'sh000300', name: '沪深300' };
  if (/中证500|ZZ500|500/.test(text)) return { tencentCode: 'sh000905', name: '中证500' };
  return (quote.marketCap || 0) >= 500 ? { tencentCode: 'sh000300', name: '沪深300' } : { tencentCode: 'sh000905', name: '中证500' };
}

function chooseThreeYearsAgoAnnualRow(annualRows) {
  if (!annualRows.length) return null;
  const latestAnnualYear = getYear(annualRows[0].REPORT_DATE);
  const targetYear = latestAnnualYear ? latestAnnualYear - 3 : null;
  return annualRows.find((row) => getYear(row.REPORT_DATE) === targetYear) || annualRows[Math.min(3, annualRows.length - 1)] || null;
}

function estimateMarketForecastAdjustment({ industryProfile, marketTrend, recentRevenueGrowth, revenueCagr, recentProfitGrowth, marginTrend, debtRatio, dAndA, capex, isLossMaking }) {
  const trendScore = marketTrend?.trendScore ?? 50;
  const revenueSignal = average([recentRevenueGrowth, revenueCagr].filter((value) => Number.isFinite(value))) ?? 0;
  const operationScore = clamp(50 + revenueSignal * 0.65 + (recentProfitGrowth ?? 0) * 0.18 + (marginTrend ?? 0) * 2 - Math.max((debtRatio ?? 0) - 55, 0) * 0.5 - (dAndA !== null && capex !== null && capex > dAndA * 1.8 ? 8 : 0), 20, 90) ?? 50;
  const combinedScore = clamp(trendScore * 0.32 + industryProfile.hotspotScore * 0.24 + operationScore * 0.34 + (isLossMaking ? -5 : 5), 20, 95) ?? 50;
  const growthLift = combinedScore >= 78 ? 10 : combinedScore >= 68 ? 7 : combinedScore >= 58 ? 3 : combinedScore < 42 ? -4 : 0;
  const marginMultiplier = combinedScore >= 78 ? 1.32 : combinedScore >= 68 ? 1.2 : combinedScore >= 58 ? 1.08 : combinedScore < 42 ? 0.9 : 1;
  const supportLabel = combinedScore >= 78 ? '市场与行业确认强' : combinedScore >= 68 ? '市场与行业确认较强' : combinedScore >= 58 ? '市场与行业确认中性偏强' : combinedScore < 42 ? '市场确认偏弱' : '市场确认中性';
  return { combinedScore, operationScore, growthLift, marginMultiplier, supportLabel };
}

function applyMarketImpliedForecastLift(forecastItems, marketTrend, industryProfile, marketAdjustment, latestProfit, quoteMarketCap) {
  if (!forecastItems.length) return forecastItems;
  const thirdYearProfit = forecastItems[2]?.netProfit;
  if (!thirdYearProfit || thirdYearProfit <= 0 || marketAdjustment.combinedScore < 58) return forecastItems;
  const historicalAnchor = marketTrend ? averagePositive([marketTrend.medianMarketCap250, marketTrend.medianMarketCap500, marketTrend.latestClose && marketTrend.latestClose > marketTrend.ma250 ? marketTrend.medianMarketCap250 * 1.08 : null]) : null;
  const marketAnchor = historicalAnchor || (quoteMarketCap ? quoteMarketCap * 0.85 : null);
  if (!marketAnchor) return forecastItems;
  const anchorMultiple = clamp(industryProfile.marketAnchorMultiple - Math.max(marketAdjustment.combinedScore - 68, 0) * 0.08 - Math.max((marketTrend?.priceToMa250 ?? 0), 0) * 0.03, 14, industryProfile.marketAnchorMultiple) ?? industryProfile.marketAnchorMultiple;
  const impliedProfit = marketAnchor / anchorMultiple;
  if (!impliedProfit || impliedProfit <= thirdYearProfit) return forecastItems;
  const liftWeight = clamp((marketAdjustment.combinedScore - 55) / 70, 0.08, 0.38) ?? 0.12;
  const targetThirdYearProfit = thirdYearProfit * (1 - liftWeight) + impliedProfit * liftWeight;
  const profitScale = clamp(targetThirdYearProfit / thirdYearProfit, 1, industryProfile.stage === 'traditional' ? 1.35 : latestProfit > 0 ? 2.2 : 3) ?? 1;
  return forecastItems.map((item, index) => ({ ...item, netProfit: item.netProfit * (1 + (profitScale - 1) * (0.55 + index * 0.22)), marketLift: profitScale }));
}

function estimateInvestmentBankProfitForecast({ annualIncomeRows, latestAnnualProfit, industryText, debtRatio, dAndA, capex, marketTrend, quote }) {
  const annualMetrics = annualIncomeRows.map(getAnnualFinancialMetrics).filter((item) => item.year && item.revenue);
  const latest = annualMetrics[0];
  if (!latest || !latest.revenue) return null;
  const previous = annualMetrics[1] || {};
  const threeYearsAgo = annualMetrics[Math.min(3, annualMetrics.length - 1)] || {};
  const recentRevenueGrowth = calculateGrowthRate(latest.revenue, previous.revenue);
  const revenueCagr = calculateCagr(latest.revenue, threeYearsAgo.revenue, annualMetrics.indexOf(threeYearsAgo));
  const recentProfitGrowth = calculateGrowthRate(latest.profit, previous.profit);
  const profitCagr = calculateCagr(latest.profit, threeYearsAgo.profit, annualMetrics.indexOf(threeYearsAgo));
  const industryProfile = getIndustryProfile(industryText);
  const isLossMaking = (latestAnnualProfit ?? latest.profit ?? 0) <= 0;
  const marginTrend = latest.netMargin !== null && previous.netMargin !== null ? latest.netMargin - previous.netMargin : null;
  const marketAdjustment = estimateMarketForecastAdjustment({ industryProfile, marketTrend, recentRevenueGrowth, revenueCagr, recentProfitGrowth, marginTrend, debtRatio, dAndA, capex, isLossMaking });
  const profitRecovered = Number.isFinite(recentProfitGrowth) && recentProfitGrowth > 20 && Number.isFinite(recentRevenueGrowth) && recentRevenueGrowth > 0;
  const businessUnderPressure = Number.isFinite(recentProfitGrowth) && recentProfitGrowth < -20 && Number.isFinite(recentRevenueGrowth) && recentRevenueGrowth < 0;
  const revenueGrowthBase = clamp(average([recentRevenueGrowth, revenueCagr, industryProfile.baseGrowth, industryProfile.baseGrowth + marketAdjustment.growthLift].filter((value) => Number.isFinite(value))), -8, industryProfile.growthCap) ?? industryProfile.baseGrowth;
  const positiveMargins = annualMetrics.slice(0, 5).map((item) => item.netMargin).filter((value) => Number.isFinite(value) && value > 0);
  const averageNetMargin = average(positiveMargins);
  const medianNetMargin = median(positiveMargins);
  const latestNetMargin = latest.netMargin ?? averageNetMargin ?? (isLossMaking ? -3 : 3);
  const normalizedTargetMargin = Math.max(industryProfile.targetMargin, averageNetMargin ?? 0, medianNetMargin ?? 0, isLossMaking ? 2 : latestNetMargin) * marketAdjustment.marginMultiplier;
  const targetMarginRaw = isLossMaking
    ? latestNetMargin * 0.25 + (averageNetMargin ?? normalizedTargetMargin) * 0.2 + (medianNetMargin ?? normalizedTargetMargin) * 0.15 + normalizedTargetMargin * 0.4
    : latestNetMargin * 0.5 + (averageNetMargin ?? normalizedTargetMargin) * 0.2 + (medianNetMargin ?? normalizedTargetMargin) * 0.15 + normalizedTargetMargin * 0.15;
  const targetNetMargin = clamp(targetMarginRaw, isLossMaking ? 1.2 : Math.max(latestNetMargin * 0.75, 0.5), Math.max(normalizedTargetMargin, latestNetMargin, averageNetMargin ?? latestNetMargin, medianNetMargin ?? latestNetMargin) * 1.25) ?? normalizedTargetMargin;
  const debtDrag = debtRatio !== null && debtRatio > 60 ? -3 : 0;
  const capexDrag = dAndA !== null && capex !== null && capex > dAndA * 1.6 ? -2 : 0;
  let profitGrowthBase;
  if (isLossMaking) profitGrowthBase = clamp(revenueGrowthBase * 0.9 + marketAdjustment.growthLift + debtDrag + capexDrag, 8, industryProfile.growthCap);
  else if (profitRecovered) profitGrowthBase = clamp(revenueGrowthBase * 0.75 + 8 + marketAdjustment.growthLift + debtDrag + capexDrag, 6, industryProfile.growthCap);
  else if (businessUnderPressure) profitGrowthBase = clamp((profitCagr ?? recentProfitGrowth ?? -5) * 0.2 + revenueGrowthBase * 0.4 + marketAdjustment.growthLift + debtDrag, -8, 12);
  else profitGrowthBase = clamp(revenueGrowthBase * 0.65 + (profitCagr ?? 0) * 0.15 + marketAdjustment.growthLift + debtDrag + capexDrag, -5, Math.min(industryProfile.growthCap, 32));
  const firstYearGrowth = profitGrowthBase;
  const secondYearGrowth = clamp(profitGrowthBase * 0.85, -6, Math.min(industryProfile.growthCap, 34));
  const thirdYearGrowth = clamp(profitGrowthBase * 0.7, -5, Math.min(industryProfile.growthCap, 28));
  const revenueGrowthPath = [revenueGrowthBase, clamp(revenueGrowthBase * 0.85, -6, Math.min(industryProfile.growthCap, 32)), clamp(revenueGrowthBase * 0.7, -5, Math.min(industryProfile.growthCap, 26))];
  const marginPath = isLossMaking ? [0.45, 0.75, 1].map((weight) => Math.max(targetNetMargin * weight, 0.3)) : [0.45, 0.7, 0.9].map((weight) => latestNetMargin + (targetNetMargin - latestNetMargin) * weight);
  let forecastItems = [];
  let revenueBase = latest.revenue;
  let profitBase = latestAnnualProfit ?? latest.profit ?? 0;
  for (let index = 0; index < 3; index += 1) {
    revenueBase *= 1 + revenueGrowthPath[index] / 100;
    const marginBasedProfit = revenueBase * (marginPath[index] / 100);
    const trendBasedProfit = isLossMaking && profitBase <= 0 ? marginBasedProfit : profitBase * (1 + [firstYearGrowth, secondYearGrowth, thirdYearGrowth][index] / 100);
    const netProfit = weightedAverage([{ value: marginBasedProfit, weight: 0.55 }, { value: trendBasedProfit, weight: 0.45 }]) ?? trendBasedProfit;
    forecastItems.push({ year: latest.year ? latest.year + index + 1 : index + 1, netProfit, revenue: revenueBase, netMargin: marginPath[index] });
    profitBase = netProfit;
  }
  forecastItems = applyMarketImpliedForecastLift(forecastItems, marketTrend, industryProfile, marketAdjustment, latestAnnualProfit ?? latest.profit ?? 0, quote?.marketCap);
  const selectedNetProfit = forecastItems[0]?.netProfit ?? latest.profit;
  const expectedGrowth = forecastItems.length >= 3 && selectedNetProfit > 0 ? (Math.pow(forecastItems[2].netProfit / selectedNetProfit, 1 / 2) - 1) * 100 : firstYearGrowth;
  const modelType = profitRecovered ? '修复型' : businessUnderPressure ? '承压型' : '稳健型';
  return { selectedNetProfit, expectedGrowth: clamp(expectedGrowth, -8, industryProfile.growthCap) ?? 0, forecastItems, modelType, revenueGrowthBase, targetNetMargin, industryLabel: industryProfile.label, marketSupportLabel: marketAdjustment.supportLabel };
}

function calculateValuationEnvironment({ stockName, stockCode, industryText, marketTrend, annualMetrics, expectedGrowth, currentGrossMargin, previousGrossMargin, debtRatio, dividendRate }) {
  const profile = getIndustryProfile(`${industryText || ''},${stockName || ''},${stockCode || ''}`);
  const latestAnnual = annualMetrics?.[0] || {};
  const previousAnnual = annualMetrics?.[1] || {};
  const recentRevenueGrowth = calculateGrowthRate(latestAnnual.revenue, previousAnnual.revenue);
  const recentProfitGrowth = calculateGrowthRate(latestAnnual.profit, previousAnnual.profit);
  const marginTrend = currentGrossMargin - previousGrossMargin;
  const marketScore = marketTrend?.trendScore ?? 50;
  const growthScore = clamp(50 + (expectedGrowth ?? profile.baseGrowth) * 1.1 + (recentRevenueGrowth ?? profile.baseGrowth) * 0.35 + (recentProfitGrowth ?? 0) * 0.12, 20, 92) ?? 50;
  const qualityScore = clamp(45 + currentGrossMargin * 0.28 + marginTrend * 1.2 - Math.max((debtRatio ?? 0) - 45, 0) * 0.55 + Math.min(dividendRate ?? 0, 6) * 2.2, 20, 94) ?? 50;
  const businessScore = weightedAverage([{ value: growthScore, weight: 0.46 }, { value: qualityScore, weight: 0.54 }]) ?? 50;
  const industryCycleScore = clamp(profile.cycleScore + ((recentRevenueGrowth ?? profile.baseGrowth) - profile.baseGrowth) * 0.28 + (recentProfitGrowth ?? 0) * 0.08, 20, 92) ?? profile.cycleScore;
  const demandScore = clamp(profile.demandScore + ((expectedGrowth ?? profile.baseGrowth) - profile.baseGrowth) * 0.32 + (recentRevenueGrowth ?? 0) * 0.12, 20, 92) ?? profile.demandScore;
  const supplyDemandScore = clamp(demandScore * 0.58 + profile.supplyScore * 0.42, 20, 92) ?? 50;
  const environmentScore = weightedAverage([{ value: industryCycleScore, weight: 0.24 }, { value: profile.hotspotScore, weight: 0.16 }, { value: supplyDemandScore, weight: 0.18 }, { value: marketScore, weight: 0.22 }, { value: businessScore, weight: 0.2 }]) ?? 50;
  let multiplier = profile.valuationBias * (0.78 + environmentScore * 0.0044);
  if (marketTrend?.priceToMa250 !== null && marketTrend?.priceToMa250 < -12) multiplier *= 0.94;
  if (marketTrend?.return250 !== null && marketTrend?.return250 < -18) multiplier *= 0.95;
  if (profile.stage === 'mature-consumption' && (expectedGrowth ?? 0) < 8) multiplier *= 0.93;
  if (profile.stage === 'growth' && environmentScore >= 68 && (expectedGrowth ?? 0) > 15) multiplier *= 1.05;
  const valuationMultiplier = clamp(multiplier, profile.stage === 'growth' ? 0.68 : 0.55, profile.stage === 'growth' ? 1.28 : 1.16) ?? 1;
  const peMultipleFactor = clamp(valuationMultiplier * (profile.stage === 'growth' ? 1.04 : profile.stage === 'mature-consumption' ? 0.92 : 0.98), 0.55, 1.24) ?? valuationMultiplier;
  const cashFlowMultiplier = clamp(valuationMultiplier * (1 + Math.min(dividendRate ?? 0, 6) * 0.008), 0.58, 1.2) ?? valuationMultiplier;
  const riskPremium = clamp((55 - environmentScore) / 100 * 0.035, 0, 0.028) ?? 0;
  const sellPremiumMultiplier = clamp(0.78 + environmentScore * 0.004, 0.86, 1.16) ?? 1;
  const environmentLabel = environmentScore >= 68 ? '环境偏积极' : environmentScore >= 55 ? '环境中性' : environmentScore >= 42 ? '环境偏谨慎' : '环境保守折扣';
  const summary = `${profile.label}，${profile.cycleLabel}；行业景气${getScoreLabel(industryCycleScore)}，需求供需${getScoreLabel(supplyDemandScore)}，市场趋势${marketTrend?.trendLabel || getScoreLabel(marketScore)}，估值环境系数${formatNumber(valuationMultiplier, 2)}。`;
  return { profile, environmentScore, environmentLabel, industryCycleScore, demandScore, supplyDemandScore, marketScore, businessScore, valuationMultiplier, peMultipleFactor, cashFlowMultiplier, riskPremium, sellPremiumMultiplier, summary };
}

function combineSellValuesWithEnvironment({ intrinsicSellValue, peSellValue, surplusSellValue, adaptiveSellValue, valuationEnvironment }) {
  const profile = valuationEnvironment.profile;
  const isWeakMature = ['mature-consumption', 'financial', 'traditional'].includes(profile.stage) && valuationEnvironment.valuationMultiplier < 0.92;
  const isStrongGrowth = profile.stage === 'growth' && valuationEnvironment.valuationMultiplier > 1.08;
  const weights = isWeakMature ? { intrinsic: 0.12, pe: 0.15, surplus: 0.18, adaptive: 0.55 } : isStrongGrowth ? { intrinsic: 0.24, pe: 0.26, surplus: 0.2, adaptive: 0.3 } : { intrinsic: 0.22, pe: 0.25, surplus: 0.23, adaptive: 0.3 };
  return weightedAverage([{ value: intrinsicSellValue, weight: weights.intrinsic }, { value: peSellValue, weight: weights.pe }, { value: surplusSellValue, weight: weights.surplus }, { value: adaptiveSellValue, weight: weights.adaptive }]);
}

function getForecastReliability(forecastMeta) {
  const source = forecastMeta?.source || '';
  const institutionCount = toNumber(forecastMeta?.institutionCount) ?? 0;
  if (source === 'broker') {
    if (institutionCount >= 10) return { level: 'high', score: 0.9, label: '券商高覆盖' };
    if (institutionCount >= 3) return { level: 'medium', score: 0.68, label: '券商中覆盖' };
    return { level: 'low', score: 0.45, label: '券商低覆盖' };
  }
  if (source?.includes('investment-bank')) return { level: 'model', score: 0.38, label: '模型预测' };
  return { level: 'weak', score: 0.3, label: '弱预测' };
}

function getForecastPathGrowth(forecastItems, fallbackGrowth, profile, reliability) {
  const items = (forecastItems || []).filter((item) => Number.isFinite(item.netProfit));
  const firstPositive = items.find((item) => item.netProfit > 0);
  const lastPositive = [...items].reverse().find((item) => item.netProfit > 0);
  let growth = fallbackGrowth;
  if (firstPositive && lastPositive && firstPositive !== lastPositive) {
    const firstIndex = items.indexOf(firstPositive);
    const lastIndex = items.indexOf(lastPositive);
    const span = Math.max(lastIndex - firstIndex, 1);
    growth = (Math.pow(lastPositive.netProfit / firstPositive.netProfit, 1 / span) - 1) * 100;
  }
  const cap = reliability.level === 'low'
    ? Math.min(profile.growthCap, 32)
    : reliability.level === 'model' || reliability.level === 'weak'
      ? Math.min(profile.growthCap, 24)
      : profile.growthCap;
  return clamp(growth, -35, cap) ?? 0;
}

function buildProfitPredictionSeries({ netProfit, expectedGrowth, forecastMeta, profile }) {
  const reliability = getForecastReliability(forecastMeta);
  const forecastItems = (forecastMeta?.forecastItems || [])
    .filter((item) => Number.isFinite(item.netProfit))
    .slice(0, 3);
  const pathGrowth = getForecastPathGrowth(forecastItems, expectedGrowth, profile, reliability);
  const predictions = [];

  for (let index = 0; index < 3; index += 1) {
    if (forecastItems[index] && Number.isFinite(forecastItems[index].netProfit)) {
      predictions.push(forecastItems[index].netProfit);
      continue;
    }
    if (index === 0) {
      predictions.push(netProfit);
    } else {
      predictions.push(predictions[index - 1] * (1 + pathGrowth / 100));
    }
  }

  const fadeCap = reliability.level === 'low'
    ? 0.12
    : reliability.level === 'model' || reliability.level === 'weak'
      ? 0.1
      : profile.stage === 'growth'
        ? 0.18
        : 0.1;
  const fadeGrowth = clamp(pathGrowth / 100 * 0.45, -0.06, fadeCap) ?? 0;
  for (let index = 3; index < 10; index += 1) {
    predictions.push(predictions[index - 1] * (1 + fadeGrowth));
  }

  return { predictions, pathGrowth, reliability };
}

function getMarketCapAnchor(totalMarketCap, totalShares, marketTrend) {
  const highMarketCap = marketTrend?.high && totalShares ? marketTrend.high * totalShares : null;
  const lowMarketCap = marketTrend?.low && totalShares ? marketTrend.low * totalShares : null;
  const medianAnchor = averagePositive([
    marketTrend?.medianMarketCap250,
    marketTrend?.medianMarketCap500,
    totalMarketCap ? totalMarketCap * 0.85 : null
  ]);
  const trendScore = marketTrend?.trendScore ?? 50;
  const trendAdjustedAnchor = medianAnchor
    ? medianAnchor * (trendScore >= 75 ? 1.06 : trendScore < 45 ? 0.9 : 1)
    : null;
  return { medianAnchor, trendAdjustedAnchor, highMarketCap, lowMarketCap, trendScore };
}

function stabilizeValuationOutputs({ rawComprehensiveSellValue, intrinsicValue, totalSurplusValue, investmentBankValuation, adaptiveValuation, totalMarketCap, totalShares, marketTrend, valuationEnvironment, forecastMeta, profitPredictions }) {
  const reliability = getForecastReliability(forecastMeta);
  const profile = valuationEnvironment.profile;
  const marketAnchor = getMarketCapAnchor(totalMarketCap, totalShares, marketTrend);
  const forwardProfit = profitPredictions.find((profit) => Number.isFinite(profit) && profit > 0);
  const profitYield = totalMarketCap && forwardProfit ? forwardProfit / totalMarketCap : null;
  const isLowConfidence = ['low', 'model', 'weak'].includes(reliability.level);
  const isMicroProfit = profitYield !== null && profitYield < 0.012;
  const trendScore = marketAnchor.trendScore;
  const upperCurrentMultiple = reliability.level === 'high'
    ? (profile.stage === 'growth' ? 4.2 : 3.2)
    : reliability.level === 'medium'
      ? (profile.stage === 'growth' ? 3.2 : 2.6)
      : reliability.level === 'low'
        ? (profile.stage === 'growth' ? 2.4 : 2)
        : (profile.stage === 'growth' ? 2.1 : 1.75);
  let upperBound = averagePositive([
    totalMarketCap ? totalMarketCap * upperCurrentMultiple : null,
    marketAnchor.trendAdjustedAnchor ? marketAnchor.trendAdjustedAnchor * (profile.stage === 'growth' ? 2.2 : 1.75) : null
  ]);
  if (marketAnchor.highMarketCap && upperBound) upperBound = Math.min(upperBound, marketAnchor.highMarketCap * 1.35);
  const lowerCurrentMultiple = isLowConfidence || isMicroProfit
    ? trendScore >= 75 ? 0.55 : trendScore >= 62 ? 0.45 : trendScore >= 45 ? 0.34 : 0.24
    : trendScore >= 75 ? 0.32 : 0.22;
  const lowerBound = averagePositive([
    totalMarketCap ? totalMarketCap * lowerCurrentMultiple : null,
    isLowConfidence && marketAnchor.trendAdjustedAnchor ? marketAnchor.trendAdjustedAnchor * 0.42 : null
  ]);
  let comprehensiveSellValue = rawComprehensiveSellValue;
  if (upperBound && comprehensiveSellValue > upperBound) comprehensiveSellValue = upperBound;
  if (lowerBound && comprehensiveSellValue < lowerBound) comprehensiveSellValue = lowerBound;

  const fairBase = weightedAverage([
    { value: intrinsicValue > 0 ? intrinsicValue : null, weight: reliability.level === 'high' ? 0.25 : 0.12 },
    { value: totalSurplusValue, weight: 0.18 },
    { value: investmentBankValuation?.fairValue, weight: 0.24 },
    { value: adaptiveValuation?.fairValue, weight: 0.26 },
    { value: marketAnchor.trendAdjustedAnchor, weight: isLowConfidence || isMicroProfit ? 0.34 : 0.12 }
  ]) ?? comprehensiveSellValue * 0.7;
  let buyBaseValue = weightedAverage([
    { value: fairBase, weight: 0.7 },
    { value: comprehensiveSellValue * 0.72, weight: 0.3 }
  ]);
  if (buyBaseValue && comprehensiveSellValue) {
    buyBaseValue = clamp(buyBaseValue, comprehensiveSellValue * 0.36, comprehensiveSellValue * 0.86);
  }
  const note = (upperBound && rawComprehensiveSellValue > upperBound) || (lowerBound && rawComprehensiveSellValue < lowerBound)
    ? `${reliability.label}，已用长期市值区间和市场趋势对极端估值做稳定化约束`
    : '';

  return {
    comprehensiveSellValue,
    buyBaseValue: buyBaseValue ?? (comprehensiveSellValue ? comprehensiveSellValue * 0.72 : intrinsicValue),
    rawComprehensiveSellValue,
    upperBound,
    lowerBound,
    marketAnchor: marketAnchor.trendAdjustedAnchor,
    reliability,
    note
  };
}

function getMarketStatus(targetValue, currentMarketCap) {
  const target = toNumber(targetValue);
  const current = toNumber(currentMarketCap);
  if (target === null || target <= 0 || current === null || current <= 0) return { text: '当前市值对比 --', className: 'muted', upside: null };
  const upside = (target / current - 1) * 100;
  if (upside < 0) return { text: `当前市值高于卖点 ${formatNumber(current / target * 100 - 100)}%，模型提示高估`, className: 'danger', upside };
  return { text: `距卖点空间 ${formatNumber(upside)}%，未触发卖点`, className: 'success', upside };
}

function estimateRevenuePredictions(context, profile, expectedGrowth) {
  const latestRevenue = context?.annualMetrics?.[0]?.revenue;
  if (!latestRevenue || latestRevenue <= 0) return [];
  const previousRevenue = context?.annualMetrics?.[1]?.revenue;
  const recentRevenueGrowth = calculateGrowthRate(latestRevenue, previousRevenue);
  const revenueGrowth = clamp(average([recentRevenueGrowth, profile.baseGrowth, (expectedGrowth ?? profile.baseGrowth) * 0.55].filter((value) => Number.isFinite(value))), -8, profile.growthCap) ?? profile.baseGrowth;
  return [1, 2, 3].map((index) => latestRevenue * Math.pow(1 + revenueGrowth / 100, index));
}

function estimateBookValuePredictions(context, profitPredictions, payoutRatio) {
  const baseBookValue = context?.bookValue;
  if (!baseBookValue || baseBookValue <= 0) return [];
  let bookValue = baseBookValue;
  return profitPredictions.slice(0, 3).map((profit) => {
    if (Number.isFinite(profit)) bookValue += profit * (1 - payoutRatio);
    return bookValue;
  });
}

function createMethodSeries(name, reason, values, assumption) {
  const validValues = values.filter((item) => item && Number.isFinite(item.marketValue) && item.marketValue > 0);
  if (!validValues.length) return null;
  return { name, reason, assumption, values: validValues };
}

function getForecastLabels(forecastMeta) {
  const items = forecastMeta?.forecastItems || [];
  return [0, 1, 2].map((index) => {
    const year = items[index]?.year;
    return year ? `${year}E` : (index === 0 ? 'N' : `N+${index}`);
  });
}

function calculateIndustryAdaptiveValuation({ profitPredictions, forecastMeta, totalShares, totalMarketCap, discountRate, perpetualGrowth, expectedGrowth, dividendRate, dAndA, capex, valuationEnvironment, context }) {
  const profile = valuationEnvironment.profile;
  const labels = getForecastLabels(forecastMeta);
  const firstThreeProfits = profitPredictions.slice(0, 3);
  const revenuePredictions = estimateRevenuePredictions(context, profile, expectedGrowth);
  const payoutRatio = clamp(totalMarketCap && dividendRate && firstThreeProfits[0] > 0 ? (totalMarketCap * dividendRate / 100) / firstThreeProfits[0] : profile.stage === 'mature-consumption' ? 0.72 : 0.45, profile.stage === 'mature-consumption' ? 0.45 : 0.2, profile.stage === 'mature-consumption' ? 0.85 : 0.75) ?? 0.45;
  const bookPredictions = estimateBookValuePredictions(context, firstThreeProfits, payoutRatio);
  const netDebt = context?.netDebt ?? 0;
  const terminalGrowth = clamp(perpetualGrowth / 100, 0.005, Math.min(getTerminalGrowthCap(profile), Math.max(0.005, discountRate - 0.018))) ?? 0.015;
  const requiredReturn = clamp(discountRate + 0.035 + valuationEnvironment.riskPremium, 0.07, 0.14) ?? 0.09;
  const requiredFcfYieldFloor = profile.stage === 'mature-consumption' ? 0.07 : profile.stage === 'financial' || profile.stage === 'traditional' ? 0.065 : 0.05;
  const requiredFcfYield = clamp(discountRate + valuationEnvironment.riskPremium - terminalGrowth + 0.018, requiredFcfYieldFloor, 0.14) ?? 0.08;
  const basePe = clamp((profile.peBase ?? 18) * valuationEnvironment.peMultipleFactor, profile.peMin ?? 8, profile.peMax ?? 38) ?? (profile.peBase ?? 18);
  const methods = [];
  if (firstThreeProfits.some((profit) => profit > 0)) {
    methods.push(createMethodSeries('前瞻PE法', `${profile.label}按行业景气和市场热度调整目标PE`, firstThreeProfits.map((profit, index) => ({ label: labels[index], marketValue: profit > 0 ? profit * basePe : null, price: profit > 0 && totalShares ? profit * basePe / totalShares : null, assumption: `${formatNumber(basePe, 1)}x` })), `目标PE ${formatNumber(basePe, 1)}x`));
  }
  if (firstThreeProfits.some((profit) => profit > 0) && (profile.stage === 'growth' || (expectedGrowth ?? 0) >= 10)) {
    const pegPe = clamp(Math.max(expectedGrowth ?? profile.baseGrowth, profile.baseGrowth) * (profile.stage === 'growth' ? 1.25 : 1) * valuationEnvironment.peMultipleFactor, profile.peMin ?? 10, profile.peMax ?? 45) ?? basePe;
    methods.push(createMethodSeries('PEG法', '成长型公司按盈利增速约束估值倍数', firstThreeProfits.map((profit, index) => ({ label: labels[index], marketValue: profit > 0 ? profit * pegPe : null, price: profit > 0 && totalShares ? profit * pegPe / totalShares : null, assumption: `${formatNumber(pegPe, 1)}x` })), `PEG约束PE ${formatNumber(pegPe, 1)}x`));
  }
  if ((profile.preferredMethods || []).includes('DDM') && firstThreeProfits.some((profit) => profit > 0)) {
    const dividendGrowth = clamp((expectedGrowth ?? profile.baseGrowth) * 0.28 / 100, 0.005, 0.045) ?? 0.015;
    methods.push(createMethodSeries('DDM股利折现', '适用于高分红或成熟稳定行业', firstThreeProfits.map((profit, index) => {
      const dividend = profit > 0 ? profit * payoutRatio : null;
      const denominator = requiredReturn - dividendGrowth;
      const marketValue = dividend && denominator > 0.015 ? dividend * (1 + dividendGrowth) / denominator : null;
      return { label: labels[index], marketValue, price: marketValue && totalShares ? marketValue / totalShares : null, assumption: `${formatNumber(payoutRatio * 100, 0)}%` };
    }), `分红率${formatNumber(payoutRatio * 100, 0)}%，股权回报率${formatNumber(requiredReturn * 100, 1)}%`));
  }
  if (firstThreeProfits.some((profit) => profit + dAndA - capex > 0)) {
    methods.push(createMethodSeries('FCFE/FCFF现金流法', '按归母利润加折旧摊销并扣除资本开支估值', firstThreeProfits.map((profit, index) => {
      const fcf = profit + dAndA - capex;
      const marketValue = fcf > 0 ? fcf / requiredFcfYield * valuationEnvironment.cashFlowMultiplier : null;
      return { label: labels[index], marketValue, price: marketValue && totalShares ? marketValue / totalShares : null, assumption: `${formatNumber(requiredFcfYield * 100, 1)}%` };
    }), `FCF收益率${formatNumber(requiredFcfYield * 100, 1)}%`));
  }
  if ((profile.preferredMethods || []).includes('EVEBITDA') && firstThreeProfits.some((profit) => profit > 0)) {
    const evEbitdaMultiple = clamp(basePe * 0.62, 5, profile.stage === 'mature-consumption' ? 14 : 18) ?? 10;
    methods.push(createMethodSeries('EV/EBITDA法', '适用于利润稳定且折旧摊销可观的经营性公司', firstThreeProfits.map((profit, index) => {
      const ebitda = profit > 0 ? profit * 1.18 + dAndA : null;
      const marketValue = ebitda ? ebitda * evEbitdaMultiple - netDebt : null;
      return { label: labels[index], marketValue, price: marketValue && totalShares ? marketValue / totalShares : null, assumption: `${formatNumber(evEbitdaMultiple, 1)}x` };
    }), `EV/EBITDA ${formatNumber(evEbitdaMultiple, 1)}x`));
  }
  if ((profile.preferredMethods || []).some((method) => ['PB', 'NAV'].includes(method)) && bookPredictions.length) {
    const pbMultiple = clamp((profile.pbBase ?? 1) * valuationEnvironment.cashFlowMultiplier, 0.35, profile.stage === 'financial' ? 1.5 : 2.2) ?? 1;
    methods.push(createMethodSeries(profile.preferredMethods.includes('NAV') ? 'NAV/PB资产法' : 'PB市净率法', '适用于金融、地产、资源或资产约束较强行业', bookPredictions.map((bookValue, index) => ({ label: labels[index], marketValue: bookValue * pbMultiple, price: totalShares ? bookValue * pbMultiple / totalShares : null, assumption: `${formatNumber(pbMultiple, 2)}x` })), `PB ${formatNumber(pbMultiple, 2)}x`));
  }
  if ((profile.preferredMethods || []).some((method) => ['EVSales', 'Capacity'].includes(method)) && revenuePredictions.length) {
    const netMargin = context?.annualMetrics?.[0]?.netMargin ?? (firstThreeProfits[0] && revenuePredictions[0] ? firstThreeProfits[0] / revenuePredictions[0] * 100 : profile.targetMargin);
    const salesMultiple = clamp((basePe * Math.max(netMargin, 2) / 100) * valuationEnvironment.cashFlowMultiplier, 0.8, profile.stage === 'growth' ? 9 : 5) ?? 2;
    const methodName = profile.preferredMethods.includes('Capacity') ? '产能/收入估值' : 'EV/Sales法';
    methods.push(createMethodSeries(methodName, profile.preferredMethods.includes('Capacity') ? '半导体等重资产成长行业用收入和产能强度近似校验' : '亏损期或成长扩张期用收入规模校验估值', revenuePredictions.map((revenue, index) => ({ label: labels[index], marketValue: revenue * salesMultiple - netDebt, price: totalShares ? (revenue * salesMultiple - netDebt) / totalShares : null, assumption: `${formatNumber(salesMultiple, 1)}x` })), `收入倍数 ${formatNumber(salesMultiple, 1)}x`));
  }
  const selectedMethods = methods.filter(Boolean).slice(0, 4);
  const latestValues = selectedMethods.map((method) => method.values[0]?.marketValue).filter((value) => Number.isFinite(value) && value > 0);
  const fairValue = averagePositive(latestValues);
  return { methods: selectedMethods, fairValue, fairPrice: fairValue && totalShares ? fairValue / totalShares : null, summary: `${profile.label}适配${selectedMethods.map((method) => method.name).join('、') || '基础估值'}；${valuationEnvironment.environmentLabel}，按${valuationEnvironment.summary}` };
}

function calculateInvestmentBankValuation({ profitPredictions, discountRate, perpetualGrowth, expectedGrowth, currentGrossMargin, previousGrossMargin, debtRatio, dividendRate, dAndA, capex, reasonablePE, totalMarketCap, valuationEnvironment }) {
  const forwardNetProfit = profitPredictions[2];
  const debtRatioValue = debtRatio / 100;
  const dividendYield = dividendRate / 100;
  const growthRate = expectedGrowth / 100;
  const marginLevel = currentGrossMargin / 100;
  const marginTrend = (currentGrossMargin - previousGrossMargin) / 100;
  const profile = valuationEnvironment?.profile || getIndustryProfile('');
  const rawTerminalGrowth = Math.max(perpetualGrowth / 100, 0.005);
  const terminalGrowth = Math.min(rawTerminalGrowth, getTerminalGrowthCap(profile), Math.max(0.005, discountRate - 0.015));
  const forecastFcf = profitPredictions.slice(0, 5).map((profit) => profit + dAndA - capex);
  const pvFcf = forecastFcf.reduce((total, fcf, index) => total + fcf / Math.pow(1 + discountRate, index + 1), 0);
  const terminalFcf = forecastFcf[4] * (1 + terminalGrowth);
  const dcfValue = terminalFcf > 0 && discountRate > terminalGrowth ? (pvFcf + (terminalFcf / (discountRate - terminalGrowth)) / Math.pow(1 + discountRate, 5)) * (valuationEnvironment?.cashFlowMultiplier ?? 1) : null;
  const qualityAdjustment = clamp(1 + marginTrend * 0.6 + (marginLevel - 0.3) * 0.2 - Math.max(debtRatioValue - 0.45, 0) * 0.35 + dividendYield * 0.35, 0.75, 1.3) ?? 1;
  const growthMultiple = 12 + (clamp(expectedGrowth, -20, 60) ?? 0) * 0.45;
  const targetPE = clamp((reasonablePE * 0.45 + growthMultiple * 0.55) * qualityAdjustment * (valuationEnvironment?.peMultipleFactor ?? 1), profile.peMin ?? 8, profile.peMax ?? 45);
  const forwardPeValue = targetPE * forwardNetProfit;
  const forwardFcf = forwardNetProfit + dAndA - capex;
  const requiredFcfYieldFloor = profile.stage === 'mature-consumption' ? 0.07 : profile.stage === 'financial' || profile.stage === 'traditional' ? 0.065 : 0.045;
  const requiredFcfYield = clamp(discountRate + (valuationEnvironment?.riskPremium ?? 0) - terminalGrowth + 0.015, requiredFcfYieldFloor, 0.14);
  const fcfYieldValue = forwardFcf > 0 && requiredFcfYield ? forwardFcf / requiredFcfYield : null;
  const fairValue = weightedAverage([{ value: dcfValue, weight: 0.45 }, { value: forwardPeValue, weight: 0.35 }, { value: fcfYieldValue, weight: 0.2 }]);
  const debtPenalty = Math.max(debtRatioValue - 0.45, 0);
  const growthSupport = clamp(growthRate, 0, 0.35) ?? 0;
  const marginSupport = Math.max(marginTrend, 0);
  const safetyMargin = clamp(0.22 + debtPenalty * 0.35 - growthSupport * 0.25 - marginSupport * 0.2 - dividendYield * 0.3, 0.15, 0.35);
  const sellPremium = clamp((0.18 + growthSupport * 0.4 + marginSupport * 0.25 - debtPenalty * 0.2) * (valuationEnvironment?.sellPremiumMultiplier ?? 1), 0.12, 0.32);
  const buyValue = fairValue === null || safetyMargin === null ? null : fairValue * (1 - safetyMargin);
  const sellValue = fairValue === null || sellPremium === null ? null : fairValue * (1 + sellPremium);
  return { dcfValue, forwardPeValue, fcfYieldValue, fairValue, buyValue, sellValue, targetPE, safetyMargin, sellPremium, upside: sellValue && totalMarketCap > 0 ? (sellValue / totalMarketCap - 1) * 100 : null };
}

function calculateValuation({ quote, annualIncomeRows, latestBalance, forecastMeta, marketTrend, inputs, context }) {
  const { stockPrice, dividendRate, totalShares, currentGrossMargin, previousGrossMargin, debtRatio, dAndA, capex, perpetualGrowth, expectedGrowth, netProfit, profitTaking } = inputs;
  const valuationEnvironment = calculateValuationEnvironment({ stockName: quote.name, stockCode: quote.code, industryText: context.industryText, marketTrend, annualMetrics: context.annualMetrics, expectedGrowth, currentGrossMargin, previousGrossMargin, debtRatio, dividendRate });
  const discountRate = 0.035 + (debtRatio / 100) * 0.09;
  const totalMarketCap = stockPrice * totalShares;
  const predictionSeries = buildProfitPredictionSeries({ netProfit, expectedGrowth, forecastMeta, profile: valuationEnvironment.profile });
  const profitPredictions = predictionSeries.predictions;
  const tenYearTotalProfit = profitPredictions.reduce((total, profit) => total + profit, 0);
  const grossMarginDiff = (currentGrossMargin - previousGrossMargin) / 100;
  const debtAdjustment = clamp(1 + (0.5 - debtRatio / 100), 0.6, 1.4);
  const buyingCoefficient = debtAdjustment * (1 + dividendRate / 100) * (1 + grossMarginDiff);
  const intrinsicValue = tenYearTotalProfit * buyingCoefficient * valuationEnvironment.valuationMultiplier;
  const intrinsicSellValue = intrinsicValue * profitTaking;
  const rawReasonablePE = (1 / (discountRate / 2)) * 0.8;
  const reasonablePE = clamp(rawReasonablePE * valuationEnvironment.peMultipleFactor, valuationEnvironment.profile.peMin ?? 8, valuationEnvironment.profile.peMax ?? 45) ?? rawReasonablePE;
  const peSellValue = reasonablePE * profitPredictions[2];
  const normalizedFcf = profitPredictions[2] + dAndA - capex;
  const fcfBasedValuationUsable = normalizedFcf > 0;
  const environmentAdjustedDiscountRate = discountRate + valuationEnvironment.riskPremium;
  const totalSurplusValue = fcfBasedValuationUsable ? normalizedFcf / environmentAdjustedDiscountRate * valuationEnvironment.cashFlowMultiplier : null;
  const terminalGrowthForValuation = Math.min(perpetualGrowth / 100, getTerminalGrowthCap(valuationEnvironment.profile));
  const surplusDenominator = discountRate - terminalGrowthForValuation;
  const surplusSellValue = fcfBasedValuationUsable && surplusDenominator > 0.001 ? normalizedFcf / Math.max(surplusDenominator + valuationEnvironment.riskPremium, 0.001) * valuationEnvironment.cashFlowMultiplier : null;
  const adaptiveValuation = calculateIndustryAdaptiveValuation({ profitPredictions, forecastMeta, totalShares, totalMarketCap, discountRate, perpetualGrowth, expectedGrowth, dividendRate, dAndA, capex, valuationEnvironment, context });
  const adaptiveSellPremium = clamp(0.1 + valuationEnvironment.environmentScore * 0.002, 0.12, 0.28) ?? 0.16;
  const adaptiveSellValue = adaptiveValuation.fairValue ? adaptiveValuation.fairValue * (1 + adaptiveSellPremium) : null;
  const investmentBankValuation = calculateInvestmentBankValuation({ profitPredictions, discountRate, perpetualGrowth, expectedGrowth, currentGrossMargin, previousGrossMargin, debtRatio, dividendRate, dAndA, capex, reasonablePE, totalMarketCap, valuationEnvironment });
  const rawComprehensiveSellValue = combineSellValuesWithEnvironment({ intrinsicSellValue, peSellValue, surplusSellValue, adaptiveSellValue, valuationEnvironment });
  const stability = stabilizeValuationOutputs({ rawComprehensiveSellValue, intrinsicValue, totalSurplusValue, investmentBankValuation, adaptiveValuation, totalMarketCap, totalShares, marketTrend, valuationEnvironment, forecastMeta, profitPredictions });
  const comprehensiveSellValue = stability.comprehensiveSellValue;
  const buyBaseValue = stability.buyBaseValue;
  const buyPoints = Array.from({ length: 5 }, (_, index) => buyBaseValue * Math.pow(0.9, index + 1));
  const finalBuyPoint = buyBaseValue * Math.pow(0.9, 9);
  return { discountRate, buyingCoefficient, intrinsicValue, totalSurplusValue, reasonablePE, totalMarketCap, intrinsicSellValue, peSellValue, surplusSellValue, rawComprehensiveSellValue, comprehensiveSellValue, comprehensiveMarketStatus: getMarketStatus(comprehensiveSellValue, totalMarketCap), investmentBankValuation, adaptiveValuation, valuationEnvironment, predictionSeries, stability, profitPredictions, buyPoints, finalBuyPoint };
}

function buildForecastDisplay(forecastMeta, profitPredictions) {
  const values = forecastMeta.forecastItems?.length >= 3 ? forecastMeta.forecastItems.slice(0, 3) : profitPredictions.slice(0, 3).map((value, index) => ({ label: index === 0 ? 'N' : `N+${index}`, netProfit: value }));
  const maxValue = Math.max(...values.map((item) => Math.abs(item.netProfit || 0)), 1);
  return values.map((item, index) => ({
    label: item.year ? `${item.year}E` : item.label || (index === 0 ? 'N' : `N+${index}`),
    value: `${formatNumber(item.netProfit)}亿`,
    height: Math.max(8, Math.min(100, Math.abs(item.netProfit || 0) / maxValue * 100))
  }));
}

function displayMethod(method) {
  return {
    name: method.name,
    reason: method.reason,
    assumption: method.assumption,
    rows: method.values.map((item) => ({
      label: item.label,
      marketValue: `${formatNumber(item.marketValue)}亿`,
      price: `${formatNumber(item.price)}元`,
      assumption: item.assumption || '--'
    }))
  };
}

function buildDisplayResult({ quote, inputs, valuation, forecastMeta, notes }) {
  const totalShares = inputs.totalShares;
  const summary = {
    comprehensiveSellValue: formatNumber(valuation.comprehensiveSellValue),
    comprehensiveSellPrice: formatPointPrice(valuation.comprehensiveSellValue, totalShares),
    totalMarketCap: formatNumber(valuation.totalMarketCap),
    intrinsicValue: formatNumber(valuation.intrinsicValue),
    marketStatus: valuation.comprehensiveMarketStatus.text,
    marketStatusClass: valuation.comprehensiveMarketStatus.className
  };
  return {
    stockName: quote.name,
    stockCode: quote.code,
    inputs: {
      stockPrice: formatNumber(inputs.stockPrice),
      dividendRate: formatNumber(inputs.dividendRate),
      totalShares: formatNumber(inputs.totalShares),
      expectedGrowth: formatNumber(inputs.expectedGrowth),
      netProfit: formatNumber(inputs.netProfit)
    },
    summary,
    environment: {
      label: valuation.valuationEnvironment.environmentLabel,
      multiplier: formatNumber(valuation.valuationEnvironment.valuationMultiplier, 2),
      industryScore: formatNumber(valuation.valuationEnvironment.industryCycleScore, 0),
      marketScore: formatNumber(valuation.valuationEnvironment.marketScore, 0),
      demandScore: formatNumber(valuation.valuationEnvironment.supplyDemandScore, 0),
      summary: valuation.valuationEnvironment.summary
    },
    forecast: {
      label: forecastMeta.label,
      detail: forecastMeta.detail,
      items: buildForecastDisplay(forecastMeta, valuation.profitPredictions)
    },
    sell: {
      intrinsicSellValue: formatNumber(valuation.intrinsicSellValue),
      intrinsicSellPrice: formatPointPrice(valuation.intrinsicSellValue, totalShares),
      peSellValue: formatNumber(valuation.peSellValue),
      peSellPrice: formatPointPrice(valuation.peSellValue, totalShares),
      surplusSellValue: formatNumber(valuation.surplusSellValue),
      surplusSellPrice: valuation.surplusSellValue ? formatPointPrice(valuation.surplusSellValue, totalShares) : 'N+2自由现金流为负，暂不纳入综合'
    },
    ib: {
      fairValue: formatNumber(valuation.investmentBankValuation.fairValue),
      fairPrice: formatPointPrice(valuation.investmentBankValuation.fairValue, totalShares),
      buyValue: formatNumber(valuation.investmentBankValuation.buyValue),
      buyPrice: formatPointPrice(valuation.investmentBankValuation.buyValue, totalShares),
      sellValue: formatNumber(valuation.investmentBankValuation.sellValue),
      sellPrice: formatPointPrice(valuation.investmentBankValuation.sellValue, totalShares),
      targetPE: `${formatNumber(valuation.investmentBankValuation.targetPE)}x`
    },
    adaptive: {
      badge: `${valuation.adaptiveValuation.methods.length}种方法`,
      summary: valuation.adaptiveValuation.summary,
      methods: valuation.adaptiveValuation.methods.map(displayMethod)
    },
    buyPoints: [
      ...valuation.buyPoints.map((value, index) => ({ label: `加仓点${index + 1}`, value: formatNumber(value), price: formatPointPrice(value, totalShares) })),
      { label: '最后加仓点', value: formatNumber(valuation.finalBuyPoint), price: formatPointPrice(valuation.finalBuyPoint, totalShares) }
    ],
    notes
  };
}

async function evaluateStock(keyword) {
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
  if (!latestIncomeRows.length) throw new Error('未取到利润表数据');
  const latestIncome = latestIncomeRows[0];
  const annualIncome = annualIncomeRows[0] || latestIncome;
  const threeYearsAgoAnnualIncome = chooseThreeYearsAgoAnnualRow(annualIncomeRows);
  const latestBalance = latestBalanceRows[0] || {};
  const latestGrossMargin = quote.latestGrossMargin ?? calcGrossMargin(latestIncome);
  const previousGrossMargin = calcGrossMargin(threeYearsAgoAnnualIncome);
  const debtRatio = quote.latestDebtRatio ?? toNumber(latestBalance.DEBT_ASSET_RATIO) ?? (toNumber(latestBalance.TOTAL_ASSETS) ? ((toNumber(latestBalance.TOTAL_LIABILITIES) || 0) / toNumber(latestBalance.TOTAL_ASSETS)) * 100 : null);
  const latestAnnualProfit = toYi(annualIncome.PARENT_NETPROFIT);
  const historicalGrowth = calcHistoricalProfitGrowth(annualIncomeRows);
  const fallbackCapex = average(annualCashFlowRows.map((row) => toYi(row.CONSTRUCT_LONG_ASSET)).filter((value) => value !== null));
  const [cashAverages, forecast, marketTrend] = await Promise.all([
    fetchTonghuashunCashAverages(code).catch(() => null),
    fetchProfitForecast(code, quote.totalShares, latestAnnualProfit).catch(() => null),
    fetchStockTrendContext(code, quote).catch(() => null)
  ]);
  const industryText = `${forecast?.industry || ''},${forecast?.conceptText || ''},${quote.industry || ''},${quote.conceptText || ''}`;
  const annualMetrics = annualIncomeRows.map(getAnnualFinancialMetrics).filter((item) => item.year && (item.revenue || item.profit !== null));
  const indexInfo = chooseIndexForProfitTaking(forecast, quote);
  const profitTakingInfo = await fetchProfitTakingCoefficient(indexInfo).catch(() => ({ coefficient: 1.382, ma60: null, ma250: null, indexName: indexInfo.name }));
  const dividendRate = quote.dividendRateTtm ?? dividendRateFallback ?? 0;
  const dAndA = cashAverages?.dAndA ?? 0;
  const capex = cashAverages?.capex ?? fallbackCapex ?? 0;
  const perpetualGrowth = estimatePerpetualGrowth(industryText);
  const brokerForecastUsable = forecast && forecast.selectedNetProfit > 0;
  const bankerForecast = brokerForecastUsable ? null : estimateInvestmentBankProfitForecast({ annualIncomeRows, latestAnnualProfit, industryText, debtRatio, dAndA, capex, marketTrend, quote });
  const brokerForecastDetail = forecast?.detail || (forecast ? `券商预测机构数${forecast.institutionCount}家` : '');
  const forecastMeta = brokerForecastUsable
    ? { source: 'broker', label: '券商盈利预测', detail: brokerForecastDetail, forecastItems: forecast.forecastItems, institutionCount: forecast.institutionCount, industry: forecast.industry, conceptText: forecast.conceptText }
    : forecast
      ? { source: bankerForecast ? 'broker-loss-investment-bank' : 'broker-loss', label: bankerForecast ? '券商预测未转正，投行方式非PE估值' : '券商盈利预测（亏损期）', detail: bankerForecast ? `${brokerForecastDetail}，三年预测仍未转正，${bankerForecast.industryLabel}，${bankerForecast.marketSupportLabel}` : `${brokerForecastDetail}，三年预测仍未转正`, forecastItems: bankerForecast?.forecastItems || forecast.forecastItems, institutionCount: forecast.institutionCount }
      : { source: bankerForecast ? 'investment-bank' : 'historical', label: bankerForecast ? '投行方式简易盈利预测' : '历史数据兜底预测', detail: bankerForecast ? `${bankerForecast.modelType}，${bankerForecast.industryLabel}，${bankerForecast.marketSupportLabel}` : '退回历史年报增速', forecastItems: bankerForecast?.forecastItems || [], institutionCount: 0 };
  const expectedGrowth = brokerForecastUsable ? forecast.expectedGrowth : bankerForecast?.expectedGrowth ?? historicalGrowth ?? 0;
  const netProfit = brokerForecastUsable ? forecast.forecastItems?.[0]?.netProfit ?? forecast.selectedNetProfit : bankerForecast?.selectedNetProfit ?? latestAnnualProfit ?? 0;
  const inputs = { stockPrice: quote.price ?? 0, dividendRate, totalShares: quote.totalShares ?? 0, currentGrossMargin: latestGrossMargin ?? 0, previousGrossMargin: previousGrossMargin ?? 0, debtRatio: debtRatio ?? 0, dAndA, capex, perpetualGrowth, expectedGrowth, netProfit, profitTaking: profitTakingInfo.coefficient };
  const context = { industryText, annualMetrics, marketTrend, bookValue: toYi(latestBalance.TOTAL_EQUITY), totalAssets: toYi(latestBalance.TOTAL_ASSETS), cash: toYi(latestBalance.MONETARYFUNDS), liabilities: toYi(latestBalance.TOTAL_LIABILITIES), netDebt: (toYi(latestBalance.TOTAL_LIABILITIES) ?? 0) - (toYi(latestBalance.MONETARYFUNDS) ?? 0) };
  const valuation = calculateValuation({ quote, annualIncomeRows, latestBalance, forecastMeta, marketTrend, inputs, context });
  const notes = [];
  if (!forecast) notes.push(`券商盈利预测未取到，启用${forecastMeta.label}`);
  else notes.push(`${brokerForecastDetail}，按券商三年预测路径估值，${forecast.institutionCount > 10 ? '高覆盖预测置信度较高' : '低覆盖预测已加稳定约束'}`);
  if (marketTrend) notes.push(`近${marketTrend.tradingDays}个交易日走势为${marketTrend.trendLabel}，较250日均线${formatNumber(marketTrend.priceToMa250)}%`);
  if (profitTakingInfo.ma60 === null || profitTakingInfo.ma250 === null) notes.push(`${profitTakingInfo.indexName}均线数据不足，止盈系数按1.382`);
  else notes.push(`${profitTakingInfo.indexName} MA60${profitTakingInfo.ma60 > profitTakingInfo.ma250 ? '高于' : '低于'}MA250，止盈系数${profitTakingInfo.coefficient}`);
  if (valuation.stability?.note) notes.push(valuation.stability.note);
  const display = buildDisplayResult({ quote, inputs, valuation, forecastMeta, notes });
  display.asOfTime = `最新取数：${new Date().toLocaleString('zh-CN', { hour12: false })}`;
  display.statusText = `已填充 ${quote.name}（${code}）。${notes.join('；')}`;
  return display;
}

module.exports = {
  evaluateStock,
  _test: {
    formatNumber,
    getIndustryProfile,
    calculateValuationEnvironment,
    buildProfitPredictionSeries,
    stabilizeValuationOutputs,
    getForecastReliability,
    getMarketCapAnchor
  }
};
