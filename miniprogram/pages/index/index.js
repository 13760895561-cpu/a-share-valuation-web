const valuationService = require('../../services/valuation');

Page({
  data: {
    keyword: '',
    loading: false,
    statusText: '输入后可自动取公开行情、财务报表、现金流、盈利预测和市场趋势。',
    statusType: '',
    asOfTime: '',
    result: null
  },

  onLoad(options) {
    const stock = options?.stock ? decodeURIComponent(options.stock) : '';
    if (stock) {
      this.setData({ keyword: stock });
      this.runValuation();
      return;
    }

    const cached = wx.getStorageSync('lastValuationResult');
    if (cached) {
      this.setData({
        keyword: `${cached.stockName || ''} ${cached.stockCode || ''}`.trim(),
        result: cached,
        asOfTime: cached.asOfTime || '',
        statusText: cached.statusText || '已恢复上次估值结果。',
        statusType: 'success'
      });
    }
  },

  onReady() {
    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      });
    }
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  useQuickStock(event) {
    const stock = event.currentTarget.dataset.stock;
    this.setData({ keyword: stock });
    this.runValuation();
  },

  async runValuation() {
    const keyword = String(this.data.keyword || '').trim();
    if (!keyword) {
      this.setData({
        statusText: '请输入股票代码或公司名称。',
        statusType: 'error'
      });
      return;
    }

    this.setData({
      loading: true,
      statusText: '正在联网获取行情、财务、现金流、盈利预测和市场环境...',
      statusType: 'loading'
    });

    try {
      const result = await valuationService.evaluateStock(keyword);
      getApp().globalData.lastResult = result;
      wx.setStorageSync('lastValuationResult', result);
      this.setData({
        keyword: `${result.stockName} ${result.stockCode}`,
        result,
        asOfTime: result.asOfTime,
        statusText: result.statusText,
        statusType: 'warning'
      });
      wx.showToast({
        title: '估值已更新',
        icon: 'success'
      });
    } catch (error) {
      this.setData({
        statusText: `取数失败：${error.message || error}`,
        statusType: 'error'
      });
      wx.showToast({
        title: '取数失败',
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  onShareAppMessage() {
    const result = this.data.result;
    const stock = result?.stockCode || this.data.keyword || '';
    return {
      title: result ? `${result.stockName} 估值：${result.summary.comprehensiveSellPrice}` : 'A股联网估值模型',
      path: `/pages/index/index?stock=${encodeURIComponent(stock)}`
    };
  },

  onShareTimeline() {
    const result = this.data.result;
    const stock = result?.stockCode || this.data.keyword || '';
    return {
      title: result ? `${result.stockName} A股联网估值` : 'A股联网估值模型',
      query: stock ? `stock=${encodeURIComponent(stock)}` : ''
    };
  }
});
