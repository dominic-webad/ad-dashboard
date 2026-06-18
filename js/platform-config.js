(function (global) {
  var PLATFORMS = {
    fb: {
      id: 'fb',
      label: 'Meta',
      logo: 'AD',
      subtitle: '面向广告优化师 · 素材全生命周期洞察',
      dataDir: './public/fb/',
      authGate: { kpi: 'loggedIn', trend: 'loggedIn', funnel: 'loggedIn' },
      filters: { showOptimizer: true, accountLabel: '账号', accountPlaceholder: '全部账号' },
      funnelDim: 'account',
      funnelKpiCount: 6,
      headCreative: { minSpend: 1000, minRoas: 0.3 },
      detailModal: { supportsCountry: false, trendDaysFixed: false },
      convertHint: 'node scripts/convert-xlsx.js',
    },
    applovin: {
      id: 'applovin',
      label: 'AppLovin',
      logo: 'AL',
      subtitle: '面向广告优化师 · Creative Set 全生命周期洞察',
      dataDir: './public/applovin/',
      authGate: { kpi: 'admin', trend: 'admin', funnel: false },
      filters: { showOptimizer: false, accountLabel: 'Creative Set', accountPlaceholder: '全部 Creative Set' },
      funnelDim: 'country',
      funnelKpiCount: 4,
      headCreative: { minSpend: 1000, minRoas: 0 },
      detailModal: { supportsCountry: true, trendDaysFixed: true },
      convertHint: 'node scripts/convert-applovin-csv.js',
    },
  };

  function getPlatform(id) {
    return PLATFORMS[id] || PLATFORMS.fb;
  }

  function listPlatforms() {
    return [PLATFORMS.fb, PLATFORMS.applovin];
  }

  global.AdPlatformConfig = {
    PLATFORMS: PLATFORMS,
    getPlatform: getPlatform,
    listPlatforms: listPlatforms,
  };
})(window);
