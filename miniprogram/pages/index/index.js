const valuationService = require('../../services/valuation');

Page({
  data: {
    keyword: '',
    loading: false,
    statusText: '输入后可自动取公开行情、财务报表、现金流、盈利预测和市场趋势。',
    statusType: '',
    asOfTime: '',
    result: null,
    manualPanelOpen: false,
    manualInputs: {},
    manualDirty: false
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
        manualInputs: valuationService.getEditableInputs(cached),
        manualPanelOpen: false,
        manualDirty: false,
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
        statusText: '请输入公司名称或代码。',
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
        manualInputs: valuationService.getEditableInputs(result),
        manualPanelOpen: false,
        manualDirty: false,
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

  toggleManualPanel() {
    if (!this.data.result) {
      this.setData({
        statusText: '请先联网取数后再调整参数。',
        statusType: 'error'
      });
      return;
    }

    const manualPanelOpen = !this.data.manualPanelOpen;
    this.setData({
      manualPanelOpen,
      manualInputs: manualPanelOpen ? valuationService.getEditableInputs(this.data.result) : this.data.manualInputs,
      manualDirty: false
    });
  },

  onManualInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({
      [`manualInputs.${field}`]: event.detail.value,
      manualDirty: true
    });
  },

  applyManualInputs() {
    if (!this.data.result) {
      this.setData({
        statusText: '请先联网取数后再调整参数。',
        statusType: 'error'
      });
      return;
    }

    try {
      const result = valuationService.recalculateWithInputs(this.data.result, this.data.manualInputs);
      getApp().globalData.lastResult = result;
      wx.setStorageSync('lastValuationResult', result);
      this.setData({
        result,
        manualInputs: valuationService.getEditableInputs(result),
        manualDirty: false,
        asOfTime: result.asOfTime,
        statusText: result.statusText,
        statusType: 'warning'
      });
      wx.showToast({
        title: '已重新计算',
        icon: 'success'
      });
    } catch (error) {
      this.setData({
        statusText: `调整失败：${error.message || error}`,
        statusType: 'error'
      });
      wx.showToast({
        title: '调整失败',
        icon: 'none'
      });
    }
  },

  restoreOnlineInputs() {
    if (!this.data.result) return;
    this.setData({
      manualInputs: valuationService.getOnlineEditableInputs(this.data.result),
      manualDirty: true,
      statusText: '已恢复联网参数，点击“应用修改”后按联网参数重新计算；直接点击“联网取数”可恢复完整公开预测口径。',
      statusType: 'loading'
    });
  },

  onShareAppMessage() {
    const result = this.data.result;
    const stock = result?.stockCode || this.data.keyword || '';
    return {
      title: result ? `${result.stockName} 估值计算` : '估值计算器小助手',
      path: `/pages/index/index?stock=${encodeURIComponent(stock)}`
    };
  },

  onShareTimeline() {
    const result = this.data.result;
    const stock = result?.stockCode || this.data.keyword || '';
    return {
      title: result ? `${result.stockName} 估值计算` : '估值计算器小助手',
      query: stock ? `stock=${encodeURIComponent(stock)}` : ''
    };
  }
});
