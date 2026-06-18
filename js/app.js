(function () {
  function showFatalError(title, message) {
    var app = document.getElementById('app');
    if (!app) return;
    app.innerHTML =
      '<div class="page"><div class="error-panel">' +
      '<div class="error-icon">⚠️</div>' +
      '<h2>' + title + '</h2>' +
      '<p>' + message + '</p>' +
      '</div></div>';
  }

  if (typeof Vue === 'undefined') {
    showFatalError('页面加载失败', 'Vue 库加载失败，请检查网络连接后刷新页面');
    return;
  }
  if (typeof window.AdUtils === 'undefined') {
    showFatalError('页面加载失败', 'utils.js 加载失败，请刷新页面');
    return;
  }

  var U = window.AdUtils;
  var createApp = Vue.createApp;
  var ref = Vue.ref;
  var computed = Vue.computed;
  var watch = Vue.watch;
  var onMounted = Vue.onMounted;
  var nextTick = Vue.nextTick;

  var app = createApp({
    setup: function () {
      var loading = ref(true);
      var error = ref('');
      var store = ref(null);
      var granularity = ref('day');
      var compareMetric = ref('spend');
      var topN = ref(15);
      var lifecycleSearch = ref('');
      var lifecyclePhase = ref('');
      var lifecycleSortKey = ref('spend');
      var lifecycleSortDir = ref('desc');
      var headCreativeWindow = ref(7);
      var countryExpanded = ref(false);
      var copyToast = ref({ show: false, x: 0, y: 0, message: '复制成功' });
      var copyToastTimer = null;
      var selectedColumnText = ref('');
      var funnelAccount = ref('');
      var funnelSortKey = ref('spend');
      var funnelSortDir = ref('desc');
      var accountSearch = ref('');
      var countrySearch = ref('');
      var accountDropdownOpen = ref(false);
      var countryDropdownOpen = ref(false);
      var detailModal = ref({ show: false, creative: '' });
      var kpiTrendModal = ref({ show: false, label: '', metricKey: '', kind: 'kpi', accent: '#60a5fa' });
      var authUser = ref(null);
      var showLoginModal = ref(false);
      var loginForm = ref({ username: '', password: '' });
      var loginError = ref('');
      var deferredReady = ref(false);
      var echartsPromise = null;

      var filters = ref({
        dateStart: '',
        dateEnd: '',
        optimizer: '',
        accounts: [],
        countries: [],
      });

      var compareFilters = ref({
        dateStart: '',
        dateEnd: '',
      });

      var lifecycleFilters = ref({
        dateStart: '',
        dateEnd: '',
      });

      var datePresetMain = ref('last7');
      var datePresetCompare = ref('last7');
      var datePresetLifecycle = ref('last7');

      var meta = computed(function () {
        return store.value && store.value.meta ? store.value.meta : {};
      });

      function scheduleIdle(fn) {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(fn, { timeout: 900 });
        } else {
          setTimeout(fn, 0);
        }
      }

      function scheduleDeferredSections() {
        scheduleIdle(function () {
          deferredReady.value = true;
        });
      }

      function loadEcharts() {
        if (window.echarts) return Promise.resolve(window.echarts);
        if (!echartsPromise) {
          echartsPromise = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js';
            script.async = true;
            script.onload = function () {
              if (window.echarts) resolve(window.echarts);
              else reject(new Error('ECharts 加载失败'));
            };
            script.onerror = function () {
              reject(new Error('ECharts 加载失败'));
            };
            document.head.appendChild(script);
          });
        }
        return echartsPromise;
      }

      function getDataUrl() {
        try {
          var version = localStorage.getItem('ad_dashboard_data_version');
          if (version) return './public/data.json?v=' + encodeURIComponent(version);
        } catch (e) { /* ignore */ }
        return './public/data.json';
      }

      function rememberDataVersion(data) {
        try {
          if (data && data.meta && data.meta.generatedAt) {
            localStorage.setItem('ad_dashboard_data_version', data.meta.generatedAt);
          }
        } catch (e) { /* ignore */ }
      }

      function dimFilter() {
        return {
          optimizer: filters.value.optimizer,
          accounts: filters.value.accounts,
          countries: filters.value.countries,
        };
      }

      function globalFilter() {
        return Object.assign({}, dimFilter(), {
          dateStart: filters.value.dateStart,
          dateEnd: filters.value.dateEnd,
        });
      }

      function compareFilter() {
        return Object.assign({}, dimFilter(), {
          dateStart: compareFilters.value.dateStart,
          dateEnd: compareFilters.value.dateEnd,
        });
      }

      function lifecycleFilter() {
        return Object.assign({}, dimFilter(), {
          dateStart: lifecycleFilters.value.dateStart || filters.value.dateStart,
          dateEnd: lifecycleFilters.value.dateEnd || filters.value.dateEnd,
        });
      }

      function dailyTrendFilter() {
        var range = resolveDatePreset('last14');
        return Object.assign({}, dimFilter(), {
          dateStart: range.start,
          dateEnd: range.end,
        });
      }

      function protectedFilter() {
        var base = Object.assign({}, dimFilter(), {
          dateStart: filters.value.dateStart,
          dateEnd: filters.value.dateEnd,
        });
        if (!authUser.value) return base;
        if (authUser.value.role === 'admin') return base;
        return Object.assign({}, base, {
          optimizer: '',
          optimizers: [authUser.value.optimizer, 'Creative'],
        });
      }

      function formatLocalIsoDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
      }

      function getTodayIso() {
        return formatLocalIsoDate(new Date());
      }

      var globalBundle = computed(function () {
        if (!store.value || !store.value.queryBundle) return null;
        return store.value.queryBundle(globalFilter());
      });

      var protectedBundle = computed(function () {
        if (!store.value || !store.value.queryBundle || !authUser.value) return null;
        return store.value.queryBundle(protectedFilter());
      });

      var isLoggedIn = computed(function () {
        return !!authUser.value;
      });

      var protectedScopeHint = computed(function () {
        if (!authUser.value) return '';
        if (authUser.value.role === 'admin') return '全部数据';
        return authUser.value.displayName + ' + Creative';
      });

      var latestDay = computed(function () {
        return globalBundle.value ? globalBundle.value.latestDay : '';
      });

      var summary = computed(function () {
        return protectedBundle.value ? protectedBundle.value.summary : {};
      });

      var kpiCards = computed(function () {
        var s = summary.value;
        return [
          { label: 'ROAS', metricKey: 'roas', value: U.formatNumber(s.roas, 2), sub: '广告支出回报率', accent: '#60a5fa', icon: '📈' },
          { label: '消耗', metricKey: 'spend', value: U.formatCurrencyExact(s.spend), sub: U.formatNumber(s.impressions, 0) + ' 展示', accent: '#f472b6', icon: '💰' },
          { label: '转化量', metricKey: 'purchases', value: U.formatNumber(s.purchases, 0), sub: '购买次数', accent: '#34d399', icon: '🎯' },
          { label: '转化成本', metricKey: 'cpa', value: U.formatCurrency(s.cpa), sub: 'CPA', accent: '#fbbf24', icon: '💵' },
          { label: 'CTR', metricKey: 'ctr', value: U.formatPercent(s.ctr), sub: '点击率', accent: '#a78bfa', icon: '👆' },
          { label: 'CPC', metricKey: 'cpc', value: U.formatCurrency(s.cpc), sub: '单次点击成本', accent: '#38bdf8', icon: '🔗' },
          { label: 'CPM', metricKey: 'cpm', value: U.formatCurrency(s.cpm), sub: '千次展示成本', accent: '#fb923c', icon: '📊' },
        ];
      });

      var kpiTrendData = computed(function () {
        return protectedBundle.value ? protectedBundle.value.trendByDay : [];
      });

      var funnelKpiCards = computed(function () {
        var s = summary.value;
        var rates = s.funnelRates || {};
        return [
          { label: 'Click → LPV', metricKey: 'clickToLpv', value: U.formatPercent(rates.clickToLpv), sub: '落地页访问率', accent: '#38bdf8' },
          { label: 'LPV → 加购', metricKey: 'lpvToCart', value: U.formatPercent(rates.lpvToCart), sub: '加购转化率', accent: '#34d399' },
          { label: '加购 → 结账', metricKey: 'cartToCheckout', value: U.formatPercent(rates.cartToCheckout), sub: '结账发起率', accent: '#a78bfa' },
          { label: '结账 → 支付', metricKey: 'checkoutToPay', value: U.formatPercent(rates.checkoutToPay), sub: '支付信息添加率', accent: '#f472b6' },
          { label: '支付 → 购买', metricKey: 'payToPurchase', value: U.formatPercent(rates.payToPurchase), sub: '购买转化率', accent: '#fbbf24' },
          { label: 'Click → 购买', metricKey: 'clickToPurchase', value: U.formatPercent(rates.clickToPurchase), sub: '全链路转化率', accent: '#60a5fa' },
        ];
      });

      var funnelDailyTrend = computed(function () {
        return protectedBundle.value ? protectedBundle.value.funnelByDay : [];
      });

      var trendData = computed(function () {
        if (!store.value || !protectedBundle.value) return [];
        return store.value.rollupTimeSeries(protectedBundle.value.trendByDay, granularity.value);
      });

      var lifecycleBundle = computed(function () {
        if (!deferredReady.value || !store.value || !store.value.queryBundle) return null;
        return store.value.queryBundle(lifecycleFilter());
      });

      var lifecycleAllTimeBundle = computed(function () {
        if (!store.value) return null;
        return store.value.allTimeBundle || null;
      });

      var lifecycleLatestDay = computed(function () {
        return lifecycleBundle.value ? lifecycleBundle.value.latestDay : '';
      });

      var lifecycleClassifiedAll = computed(function () {
        if (!store.value || !lifecycleBundle.value || !lifecycleAllTimeBundle.value) return [];
        return store.value.buildLifecycleDisplay(
          lifecycleBundle.value,
          lifecycleAllTimeBundle.value,
          getTodayIso()
        );
      });

      var lifecycleItems = computed(function () {
        var items = lifecycleClassifiedAll.value.slice();
        if (lifecyclePhase.value) {
          items = items.filter(function (i) { return i.phase === lifecyclePhase.value; });
        }
        if (lifecycleSearch.value.trim()) {
          var q = lifecycleSearch.value.trim().toLowerCase();
          items = items.filter(function (i) {
            return i.creative.toLowerCase().indexOf(q) >= 0;
          });
        }
        var key = lifecycleSortKey.value;
        var dir = lifecycleSortDir.value === 'asc' ? 1 : -1;
        var phaseOrder = { test: 1, growth: 2, scale: 3, decline: 4 };
        items.sort(function (a, b) {
          var av;
          var bv;
          if (key === 'creative') {
            av = a.creative || '';
            bv = b.creative || '';
            return dir * String(av).localeCompare(String(bv));
          }
          if (key === 'phase') {
            av = phaseOrder[a.phase] || 0;
            bv = phaseOrder[b.phase] || 0;
            return dir * (av - bv);
          }
          av = a[key] || 0;
          bv = b[key] || 0;
          return dir * (av - bv);
        });
        return items;
      });

      var lifecycleStats = computed(function () {
        var stats = { test: 0, growth: 0, scale: 0, decline: 0, total: 0, activeInPeriod: 0 };
        lifecycleClassifiedAll.value.forEach(function (i) {
          stats[i.phase] += 1;
          stats.total += 1;
          if (i.spend > 0) stats.activeInPeriod += 1;
        });
        return stats;
      });

      var compareBundle = computed(function () {
        if (!deferredReady.value || !store.value || !store.value.queryBundle) return null;
        return store.value.queryBundle(compareFilter());
      });

      var compareData = computed(function () {
        if (!compareBundle.value) return [];
        var grouped = compareBundle.value.creatives;
        var metric = compareMetric.value;
        var sorted = grouped
          .slice()
          .sort(function (a, b) { return b[metric] - a[metric]; })
          .slice(0, topN.value);
        if (!store.value || !lifecycleAllTimeBundle.value) return sorted;
        return store.value.attachRampDays(sorted, lifecycleAllTimeBundle.value, getTodayIso());
      });

      var potentialResult = computed(function () {
        if (!deferredReady.value || !store.value || !globalBundle.value) {
          return { windowDays: headCreativeWindow.value, items: [] };
        }
        return store.value.findRisingFromBundle(
          globalBundle.value.creativeDayMap,
          latestDay.value,
          headCreativeWindow.value
        );
      });

      var potentialCreatives = computed(function () {
        var items = potentialResult.value.items;
        if (!store.value || !lifecycleAllTimeBundle.value || !items.length) return items;
        return store.value.attachRampDays(items, lifecycleAllTimeBundle.value, getTodayIso());
      });

      var potentialWindowDays = computed(function () {
        return potentialResult.value.windowDays;
      });

      var compareMaxValue = computed(function () {
        var metric = compareMetric.value;
        var max = 0;
        compareData.value.forEach(function (item) {
          if (item[metric] > max) max = item[metric];
        });
        return max || 1;
      });

      var funnelAccounts = computed(function () {
        return protectedBundle.value ? protectedBundle.value.funnelAccounts : [];
      });

      var countryTiers = computed(function () {
        if (!globalBundle.value) return { t1: [], t2: [], t3: [] };
        var countries = globalBundle.value.countries.filter(function (c) {
          return c.spend > 0;
        });
        var t1 = [];
        var t2 = [];
        var t3 = [];
        countries.forEach(function (c) {
          if (c.roas >= 0.3) t1.push(c);
          else if (c.roas >= 0.25) t2.push(c);
          else t3.push(c);
        });
        function bySpend(a, b) { return b.spend - a.spend; }
        return {
          t1: t1.sort(bySpend),
          t2: t2.sort(bySpend),
          t3: t3.sort(bySpend),
        };
      });

      var funnelSummaryRow = computed(function () {
        var s = summary.value;
        return {
          accountName: '全部账号（汇总）',
          optimizer: '—',
          spend: s.spend,
          revenue: s.conversionValue,
          roas: s.roas,
          clicks: s.clicks,
          landingPageViews: s.landingPageViews,
          addsToCart: s.addsToCart,
          checkoutsInitiated: s.checkoutsInitiated,
          addsPaymentInfo: s.addsPaymentInfo,
          purchases: s.purchases,
          funnelRates: s.funnelRates,
          usCpm: s.usCpm || 0,
          isSummary: true,
        };
      });

      var activeFunnel = computed(function () {
        if (!funnelAccount.value) return funnelSummaryRow.value;
        return funnelAccounts.value.find(function (a) {
          return a.accountName === funnelAccount.value;
        }) || funnelSummaryRow.value;
      });

      var sortedFunnelTable = computed(function () {
        var list = funnelAccounts.value.slice();
        var key = funnelSortKey.value;
        var dir = funnelSortDir.value === 'asc' ? 1 : -1;

        list.sort(function (a, b) {
          var av;
          var bv;
          if (key === 'accountName' || key === 'optimizer') {
            av = a[key] || '';
            bv = b[key] || '';
            return dir * String(av).localeCompare(String(bv));
          }
          if (key.indexOf('To') > 0 || key === 'payRate' || key === 'usPayRate') {
            av = (a.funnelRates && a.funnelRates[key]) || 0;
            bv = (b.funnelRates && b.funnelRates[key]) || 0;
          } else {
            av = a[key] || 0;
            bv = b[key] || 0;
          }
          return dir * (av - bv);
        });
        return list;
      });

      var filteredAccountOptions = computed(function () {
        var q = accountSearch.value.trim().toLowerCase();
        var list = meta.value.accounts || [];
        if (!q) return list;
        return list.filter(function (a) { return a.toLowerCase().indexOf(q) >= 0; });
      });

      var filteredCountryOptions = computed(function () {
        var q = countrySearch.value.trim().toLowerCase();
        var list = meta.value.countries || [];
        if (!q) return list;
        return list.filter(function (c) { return c.toLowerCase().indexOf(q) >= 0; });
      });

      var detailSeries = computed(function () {
        if (!store.value || !detailModal.value.creative) return [];
        return store.value.getCreativeDailySeries(detailModal.value.creative, dailyTrendFilter());
      });

      var trendChart = null;
      var funnelChart = null;
      var detailChart = null;
      var kpiTrendChart = null;

      function initCharts() {
        if (isLoggedIn.value) ensureProtectedCharts();
        syncFunnelColumnWidths();
      }

      function ensureProtectedCharts() {
        if (!isLoggedIn.value) return;
        loadEcharts().then(function () {
          try {
            var trendEl = document.getElementById('trend-chart');
            var funnelEl = document.getElementById('funnel-chart');
            if (trendEl && window.echarts && !trendChart) trendChart = echarts.init(trendEl);
            if (funnelEl && window.echarts && !funnelChart) funnelChart = echarts.init(funnelEl);
            renderCharts();
            syncFunnelColumnWidths();
          } catch (err) {
            console.error('图表初始化失败', err);
          }
        }).catch(function (err) {
          console.error(err);
        });
      }

      function disposeProtectedCharts() {
        if (trendChart) {
          trendChart.dispose();
          trendChart = null;
        }
        if (funnelChart) {
          funnelChart.dispose();
          funnelChart = null;
        }
      }

      function openLoginModal() {
        loginError.value = '';
        showLoginModal.value = true;
      }

      function closeLoginModal() {
        showLoginModal.value = false;
        loginError.value = '';
      }

      function handleLogin() {
        if (!window.AdAuth) {
          loginError.value = '登录模块加载失败';
          return;
        }
        var result = window.AdAuth.login(loginForm.value.username, loginForm.value.password);
        if (!result.ok) {
          loginError.value = result.error;
          return;
        }
        authUser.value = result.user;
        loginForm.value.password = '';
        loginError.value = '';
        showLoginModal.value = false;
        nextTick().then(ensureProtectedCharts);
      }

      function handleLogout() {
        if (window.AdAuth) window.AdAuth.logout();
        authUser.value = null;
        closeKpiTrendModal();
        closeLoginModal();
        disposeProtectedCharts();
      }

      function renderTrendChart() {
        if (!trendChart) return;
        var data = trendData.value;

        trendChart.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'axis',
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            textStyle: { color: '#f1f5f9' },
          },
          legend: {
            data: ['消耗', 'ROAS'],
            textStyle: { color: '#94a3b8' },
            top: 0,
          },
          grid: { left: 56, right: 56, top: 40, bottom: data.length > 8 ? 64 : 48 },
          xAxis: {
            type: 'category',
            data: data.map(function (d) { return U.formatDateDisplay(d.date); }),
            axisLine: { lineStyle: { color: '#334155' } },
            axisLabel: { color: '#94a3b8', rotate: data.length > 8 ? 35 : 0, fontSize: 11 },
          },
          yAxis: [
            {
              type: 'value',
              name: '消耗 ($)',
              nameTextStyle: { color: '#94a3b8' },
              axisLabel: { color: '#94a3b8' },
              splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } },
            },
            {
              type: 'value',
              name: 'ROAS',
              nameTextStyle: { color: '#34d399' },
              axisLabel: { color: '#34d399' },
              splitLine: { show: false },
            },
          ],
          series: [
            {
              name: '消耗',
              type: 'bar',
              data: data.map(function (d) { return +d.spend.toFixed(2); }),
              itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] },
              barMaxWidth: 36,
            },
            {
              name: 'ROAS',
              type: 'line',
              yAxisIndex: 1,
              data: data.map(function (d) { return +d.roas.toFixed(4); }),
              smooth: true,
              symbol: 'circle',
              symbolSize: 7,
              lineStyle: { width: 3, color: '#34d399' },
              itemStyle: { color: '#34d399' },
            },
          ],
        }, true);
      }

      function renderFunnelChart() {
        if (!funnelChart) return;
        var funnel = activeFunnel.value;
        if (!funnel) return;
        var rates = funnel.funnelRates || summary.value.funnelRates || {};

        var steps = [
          { name: 'Click → LPV', value: funnel.clicks, rateLabel: U.formatPercent(rates.clickToLpv) },
          { name: 'LPV → 加购', value: funnel.landingPageViews, rateLabel: U.formatPercent(rates.lpvToCart) },
          { name: '加购 → 结账', value: funnel.addsToCart, rateLabel: U.formatPercent(rates.cartToCheckout) },
          { name: '结账 → 支付', value: funnel.checkoutsInitiated, rateLabel: U.formatPercent(rates.checkoutToPay) },
          { name: '支付 → 购买', value: funnel.addsPaymentInfo, rateLabel: U.formatPercent(rates.payToPurchase) },
          { name: '付费率', value: funnel.purchases, rateLabel: U.formatPercent(rates.payRate) },
        ];

        funnelChart.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'item',
            formatter: function (p) {
              var step = steps[p.dataIndex];
              return step.name + '<br/>转化率: ' + step.rateLabel;
            },
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            textStyle: { color: '#f1f5f9' },
          },
          series: [{
            type: 'funnel',
            left: '8%',
            right: '8%',
            top: 8,
            bottom: 8,
            width: '84%',
            min: 0,
            max: Math.max(funnel.clicks, 1),
            minSize: '8%',
            maxSize: '100%',
            sort: 'descending',
            gap: 2,
            label: {
              show: true,
              position: 'inside',
              formatter: function (p) {
                var step = steps[p.dataIndex];
                return step.name + '\n' + step.rateLabel;
              },
              color: '#f1f5f9',
              fontSize: 11,
              lineHeight: 15,
            },
            labelLine: { show: false },
            itemStyle: {
              borderColor: '#0b1120',
              borderWidth: 1,
            },
            data: steps,
          }],
        }, true);
      }

      function sortFunnelColumn(key, evt) {
        if (evt && evt.detail > 1) return;
        if (funnelSortKey.value === key) {
          funnelSortDir.value = funnelSortDir.value === 'asc' ? 'desc' : 'asc';
        } else {
          funnelSortKey.value = key;
          funnelSortDir.value = 'desc';
        }
      }

      function funnelSortIcon(key) {
        if (funnelSortKey.value !== key) return '↕';
        return funnelSortDir.value === 'asc' ? '↑' : '↓';
      }

      function sortLifecycleColumn(key, evt) {
        if (evt && evt.detail > 1) return;
        if (lifecycleSortKey.value === key) {
          lifecycleSortDir.value = lifecycleSortDir.value === 'asc' ? 'desc' : 'asc';
        } else {
          lifecycleSortKey.value = key;
          lifecycleSortDir.value = 'desc';
        }
      }

      function lifecycleSortIcon(key) {
        if (lifecycleSortKey.value !== key) return '↕';
        return lifecycleSortDir.value === 'asc' ? '↑' : '↓';
      }

      function renderDetailChart() {
        var el = document.getElementById('detail-chart');
        if (!el) return;
        loadEcharts().then(function () {
          if (detailChart) detailChart.dispose();
          detailChart = echarts.init(el);

          var series = detailSeries.value;
          detailChart.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'axis',
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            textStyle: { color: '#f1f5f9' },
          },
          legend: {
            data: ['消耗', 'ROAS'],
            textStyle: { color: '#94a3b8' },
            top: 0,
          },
          grid: { left: 56, right: 56, top: 48, bottom: 48 },
          xAxis: {
            type: 'category',
            data: series.map(function (d) { return U.formatDateDisplay(d.day); }),
            axisLabel: { color: '#94a3b8' },
            axisLine: { lineStyle: { color: '#334155' } },
          },
          yAxis: [
            {
              type: 'value',
              name: '消耗 ($)',
              nameTextStyle: { color: '#94a3b8' },
              axisLabel: { color: '#94a3b8' },
              splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } },
            },
            {
              type: 'value',
              name: 'ROAS',
              nameTextStyle: { color: '#94a3b8' },
              axisLabel: { color: '#94a3b8' },
              splitLine: { show: false },
            },
          ],
          series: [
            {
              name: '消耗',
              type: 'bar',
              data: series.map(function (d) { return +d.spend.toFixed(2); }),
              itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] },
            },
            {
              name: 'ROAS',
              type: 'line',
              yAxisIndex: 1,
              data: series.map(function (d) { return +d.roas.toFixed(4); }),
              smooth: true,
              lineStyle: { width: 3, color: '#34d399' },
              itemStyle: { color: '#34d399' },
            },
          ],
        }, true);
        }).catch(function (err) {
          console.error(err);
        });
      }

      function renderCharts() {
        renderTrendChart();
        renderFunnelChart();
      }

      function compareBarWidth(item) {
        var metric = compareMetric.value;
        var val = item[metric] || 0;
        var max = compareMaxValue.value;
        return Math.max(2, (val / max) * 100).toFixed(2) + '%';
      }

      function formatCompareValue(item) {
        return U.formatCompareMetric(item, compareMetric.value);
      }

      function potentialTotalSpend(item) {
        return item.totalSpend7d != null ? item.totalSpend7d : item.totalSpend;
      }

      function isAccountSelected(name) {
        return filters.value.accounts.indexOf(name) >= 0;
      }

      function isCountrySelected(code) {
        return filters.value.countries.indexOf(code) >= 0;
      }

      function toggleAccount(name) {
        var list = filters.value.accounts.slice();
        var idx = list.indexOf(name);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(name);
        filters.value.accounts = list;
      }

      function toggleCountry(code) {
        var list = filters.value.countries.slice();
        var idx = list.indexOf(code);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(code);
        filters.value.countries = list;
      }

      function selectVisibleAccounts() {
        var set = new Set(filters.value.accounts);
        filteredAccountOptions.value.forEach(function (a) { set.add(a); });
        filters.value.accounts = Array.from(set);
      }

      function selectVisibleCountries() {
        var set = new Set(filters.value.countries);
        filteredCountryOptions.value.forEach(function (c) { set.add(c); });
        filters.value.countries = Array.from(set);
      }

      function clearAccounts() {
        filters.value.accounts = [];
      }

      function clearCountries() {
        filters.value.countries = [];
      }

      function shiftIsoDate(iso, days) {
        if (!iso) return '';
        var d = new Date(iso + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return formatLocalIsoDate(d);
      }

      function normalizeDateRange(start, end) {
        var min = meta.value.dateRange && meta.value.dateRange.min;
        var max = meta.value.dateRange && meta.value.dateRange.max;
        if (min && start < min) start = min;
        if (max && end > max) end = max;
        if (min && end < min) end = min;
        if (max && start > max) start = max;
        if (start > end) start = end;
        return { start: start, end: end };
      }

      function resolveDatePresetRaw(preset) {
        var today = getTodayIso();
        var start = today;
        var end = today;
        if (preset === 'yesterday') {
          start = shiftIsoDate(today, -1);
          end = shiftIsoDate(today, -1);
        } else if (preset === 'last3') {
          end = shiftIsoDate(today, -1);
          start = shiftIsoDate(today, -3);
        } else if (preset === 'last7') {
          end = shiftIsoDate(today, -1);
          start = shiftIsoDate(today, -7);
        } else if (preset === 'last14') {
          end = shiftIsoDate(today, -1);
          start = shiftIsoDate(today, -14);
        }
        return { start: start, end: end };
      }

      function resolveDatePreset(preset) {
        var raw = resolveDatePresetRaw(preset);
        return normalizeDateRange(raw.start, raw.end);
      }

      function getDatePresetRef(target) {
        if (target === 'compare') return datePresetCompare;
        if (target === 'lifecycle') return datePresetLifecycle;
        return datePresetMain;
      }

      function applyDatePreset(preset, target) {
        var range = resolveDatePreset(preset);
        getDatePresetRef(target).value = preset;
        if (target === 'compare') {
          compareFilters.value = { dateStart: range.start, dateEnd: range.end };
        } else if (target === 'lifecycle') {
          lifecycleFilters.value = { dateStart: range.start, dateEnd: range.end };
        } else {
          filters.value = Object.assign({}, filters.value, {
            dateStart: range.start,
            dateEnd: range.end,
          });
        }
      }

      function clearDatePreset(target) {
        getDatePresetRef(target).value = '';
      }

      function isDatePresetActive(preset, target) {
        return getDatePresetRef(target).value === preset;
      }

      function getKpiTrendValue(row, metricKey) {
        if (metricKey === 'cpm') {
          return row.impressions > 0 ? (row.spend / row.impressions) * 1000 : 0;
        }
        return row[metricKey] || 0;
      }

      function roasClass(roas) {
        if (!Number.isFinite(roas)) return '';
        return roas >= 0.25 ? 'roas-good' : 'roas-bad';
      }

      function openDatePicker(evt) {
        var el = evt && evt.target;
        if (!el || el.type !== 'date') return;
        if (typeof el.showPicker === 'function') {
          try {
            el.showPicker();
          } catch (err) {
            el.focus();
          }
        }
      }

      var funnelScrollSyncBound = false;

      function syncFunnelFooterOffset() {
        var bodyScroll = document.querySelector('.funnel-table-body-scroll');
        var footerInner = document.querySelector('.funnel-table-footer-inner');
        if (!bodyScroll || !footerInner) return;
        footerInner.style.transform = 'translateX(-' + bodyScroll.scrollLeft + 'px)';
      }

      function bindFunnelScrollSync() {
        if (funnelScrollSyncBound) return;
        var bodyScroll = document.querySelector('.funnel-table-body-scroll');
        if (!bodyScroll) return;
        funnelScrollSyncBound = true;
        bodyScroll.addEventListener('scroll', syncFunnelFooterOffset);
        syncFunnelFooterOffset();
      }

      function syncFunnelColumnWidths() {
        nextTick().then(function () {
          bindFunnelScrollSync();
          var main = document.querySelector('.funnel-table-main');
          var summary = document.querySelector('.funnel-table-summary');
          if (!main || !summary) return;

          var colCount = main.querySelectorAll('thead th').length;
          if (!colCount) return;

          main.style.tableLayout = 'auto';
          summary.style.tableLayout = 'auto';
          main.style.width = 'max-content';
          summary.style.width = 'max-content';

          var widths = [];
          for (var c = 0; c < colCount; c++) widths[c] = 0;

          function measureCells(root) {
            root.querySelectorAll('th, td').forEach(function (cell) {
              var idx = cell.cellIndex;
              if (idx < 0) return;
              widths[idx] = Math.max(widths[idx], Math.ceil(cell.getBoundingClientRect().width));
            });
          }

          measureCells(main);
          measureCells(summary);

          var colWidthDelta = { 1: -5, 5: -5 };
          var adjustedWidths = widths.map(function (w, i) {
            return Math.max(40, w + (colWidthDelta[i] || 0));
          });
          var total = adjustedWidths.reduce(function (sum, w) { return sum + w; }, 0);
          main.style.tableLayout = 'fixed';
          summary.style.tableLayout = 'fixed';
          main.style.width = total + 'px';
          summary.style.width = total + 'px';

          var mainCols = main.querySelectorAll('colgroup col');
          var summaryCols = summary.querySelectorAll('colgroup col');
          adjustedWidths.forEach(function (w, i) {
            var px = w + 'px';
            if (mainCols[i]) mainCols[i].style.width = px;
            if (summaryCols[i]) summaryCols[i].style.width = px;
          });
          syncFunnelFooterOffset();
        });
      }

      function resetFilters() {
        var defaultRange = resolveDatePreset('last7');
        datePresetMain.value = 'last7';
        datePresetCompare.value = 'last7';
        datePresetLifecycle.value = 'last7';
        filters.value = {
          dateStart: defaultRange.start,
          dateEnd: defaultRange.end,
          optimizer: '',
          accounts: [],
          countries: [],
        };
        compareFilters.value = { dateStart: defaultRange.start, dateEnd: defaultRange.end };
        lifecycleFilters.value = { dateStart: defaultRange.start, dateEnd: defaultRange.end };
        funnelAccount.value = '';
        funnelSortKey.value = 'spend';
        funnelSortDir.value = 'desc';
        accountSearch.value = '';
        countrySearch.value = '';
        lifecycleSearch.value = '';
        lifecyclePhase.value = '';
      }

      function showCopyToast(evt, message) {
        var x = evt && evt.clientX != null ? evt.clientX : window.innerWidth / 2;
        var y = evt && evt.clientY != null ? evt.clientY : window.innerHeight / 2;
        copyToast.value = { show: true, x: x, y: y, message: message || '复制成功' };
        if (copyToastTimer) clearTimeout(copyToastTimer);
        copyToastTimer = setTimeout(function () {
          copyToast.value = { show: false, x: x, y: y, message: message || '复制成功' };
        }, 1400);
      }

      function normalizeColumnLabel(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
      }

      function isSelectableColumnLabel(label) {
        return label === '素材' || label === '素材名称' || label === '国家';
      }

      function clearColumnSelection() {
        document.querySelectorAll('.col-selected').forEach(function (el) {
          el.classList.remove('col-selected');
        });
        selectedColumnText.value = '';
      }

      function collectTableColumnCells(group, colIndex) {
        var lines = [];
        var selectors = {
          lifecycle: ['.lifecycle-table tbody tr'],
          potential: ['.potential-table-wrap tbody tr'],
        };
        (selectors[group] || []).forEach(function (selector) {
          document.querySelectorAll(selector).forEach(function (row) {
            if (row.querySelector('.empty-cell')) return;
            var cell = row.cells[colIndex];
            if (!cell || cell.colSpan > 1) return;
            cell.classList.add('col-selected');
            lines.push(cell.innerText.trim());
          });
        });
        return lines;
      }

      function onTableHeadClick(evt, group) {
        var th = evt.target.closest('th');
        if (!th || !th.closest('thead')) return;
        var label = normalizeColumnLabel(th.textContent);
        if (!isSelectableColumnLabel(label)) return;
        evt.stopPropagation();
        clearColumnSelection();
        columnSelectAt = Date.now();
        var lines = collectTableColumnCells(group, th.cellIndex);
        selectedColumnText.value = lines.join('\n');
        th.classList.add('col-selected');
        showCopyToast(evt, '已选中该列，Ctrl+C 复制');
      }

      function onCountryColumnClick(evt) {
        var head = evt.target.closest('.country-tier-table-head span');
        if (!head || normalizeColumnLabel(head.textContent) !== '国家') return;
        evt.stopPropagation();
        clearColumnSelection();
        columnSelectAt = Date.now();
        var colIndex = Array.prototype.indexOf.call(head.parentElement.children, head);
        var list = head.closest('.country-tier-list');
        if (!list || colIndex < 0) return;
        var lines = [];
        list.querySelectorAll('.country-tier-table-head, .country-tier-item').forEach(function (row) {
          var cell = row.children[colIndex];
          if (!cell) return;
          cell.classList.add('col-selected');
          lines.push(cell.innerText.trim());
        });
        selectedColumnText.value = lines.join('\n');
        head.classList.add('col-selected');
        showCopyToast(evt, '已选中该列，Ctrl+C 复制');
      }

      function onCompareColumnClick(evt) {
        var head = evt.target.closest('.compare-table-head .compare-col-name');
        if (!head) return;
        evt.stopPropagation();
        clearColumnSelection();
        columnSelectAt = Date.now();
        var lines = [];
        document.querySelectorAll('.compare-table-row .compare-col-name').forEach(function (cell) {
          cell.classList.add('col-selected');
          var nameEl = cell.querySelector('.compare-full-name');
          lines.push((nameEl ? nameEl.innerText : cell.innerText).trim());
        });
        selectedColumnText.value = lines.join('\n');
        head.classList.add('col-selected');
        showCopyToast(evt, '已选中该列，Ctrl+C 复制');
      }

      var columnSelectAt = 0;

      function setupColumnSelection() {
        document.addEventListener('click', function (evt) {
          if (Date.now() - columnSelectAt < 400) return;
          if (evt.target.closest('thead') || evt.target.closest('.country-tier-table-head') || evt.target.closest('.compare-table-head')) return;
          if (evt.target.closest('.col-selected')) return;
          clearColumnSelection();
        });
        document.addEventListener('copy', function (evt) {
          if (!selectedColumnText.value) return;
          evt.clipboardData.setData('text/plain', selectedColumnText.value);
          evt.preventDefault();
          showCopyToast(evt, '已复制列数据');
          clearColumnSelection();
        });
        document.querySelectorAll('.col-selectable').forEach(function (el) {
          el.title = '双击选中整列';
        });
      }

      function copyText(text, evt) {
        if (!text) return;
        var done = function () {
          showCopyToast(evt);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () {
            fallbackCopy(text);
            done();
          });
        } else {
          fallbackCopy(text);
          done();
        }
      }

      function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      function openCreativeDetail(item) {
        detailModal.value = {
          show: true,
          creative: item.creative,
        };
        nextTick().then(function () {
          renderDetailChart();
        });
      }

      function closeCreativeDetail() {
        detailModal.value.show = false;
        if (detailChart) {
          detailChart.dispose();
          detailChart = null;
        }
      }

      function openKpiTrend(card, kind) {
        if (!card || !card.metricKey) return;
        kpiTrendModal.value = {
          show: true,
          label: card.label,
          metricKey: card.metricKey,
          kind: kind || 'kpi',
          accent: card.accent || '#60a5fa',
        };
        nextTick().then(renderKpiTrendChart);
      }

      function closeKpiTrendModal() {
        kpiTrendModal.value.show = false;
        if (kpiTrendChart) {
          kpiTrendChart.dispose();
          kpiTrendChart = null;
        }
      }

      function formatKpiTrendTooltip(value, metricKey) {
        if (metricKey === 'spend' || metricKey === 'cpa' || metricKey === 'cpc' || metricKey === 'cpm') {
          return U.formatCurrency(value);
        }
        if (metricKey === 'ctr') return U.formatPercent(value);
        if (metricKey === 'purchases') return U.formatNumber(value, 0);
        return U.formatNumber(value, 2);
      }

      function renderKpiTrendChart() {
        var el = document.getElementById('kpi-trend-chart');
        if (!el || !kpiTrendModal.value.show) return;
        loadEcharts().then(function () {
          if (kpiTrendChart) kpiTrendChart.dispose();
          kpiTrendChart = echarts.init(el);

          var modal = kpiTrendModal.value;
          var dates = [];
          var values = [];
          var isPercent = modal.kind === 'funnel';

          if (modal.kind === 'funnel') {
            var funnelData = funnelDailyTrend.value;
            dates = funnelData.map(function (d) { return U.formatDateDisplay(d.day); });
            values = funnelData.map(function (d) {
              var rates = d.funnelRates || {};
              return +((rates[modal.metricKey] || 0).toFixed(2));
            });
          } else {
            var kpiData = kpiTrendData.value;
            dates = kpiData.map(function (d) { return U.formatDateDisplay(d.date); });
            values = kpiData.map(function (d) {
              return +getKpiTrendValue(d, modal.metricKey).toFixed(4);
            });
          }

          kpiTrendChart.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'axis',
            backgroundColor: '#1e293b',
            borderColor: '#334155',
            textStyle: { color: '#f1f5f9' },
            formatter: function (params) {
              var p = params[0];
              if (!p) return '';
              var val = p.value;
              var text = isPercent ? U.formatPercent(val) : formatKpiTrendTooltip(val, modal.metricKey);
              return p.axisValue + '<br/>' + modal.label + ': ' + text;
            },
          },
          grid: { left: 56, right: 24, top: 32, bottom: dates.length > 8 ? 64 : 48 },
          xAxis: {
            type: 'category',
            data: dates,
            axisLine: { lineStyle: { color: '#334155' } },
            axisLabel: { color: '#94a3b8', rotate: dates.length > 8 ? 35 : 0, fontSize: 11 },
          },
          yAxis: {
            type: 'value',
            axisLabel: {
              color: '#94a3b8',
              formatter: isPercent ? '{value}%' : undefined,
            },
            splitLine: { lineStyle: { color: '#1e293b', type: 'dashed' } },
          },
          series: [
            {
              name: modal.label,
              type: 'line',
              data: values,
              smooth: true,
              symbol: 'circle',
              symbolSize: 7,
              lineStyle: { width: 3, color: modal.accent },
              itemStyle: { color: modal.accent },
              areaStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: modal.accent + '33' },
                    { offset: 1, color: modal.accent + '05' },
                  ],
                },
              },
            },
          ],
        }, true);
        }).catch(function (err) {
          console.error(err);
        });
      }

      function loadData() {
        if (window.location.protocol === 'file:') {
          return Promise.reject(new Error('请运行 node serve.js 后访问 http://localhost:8080，不要直接打开 HTML 文件'));
        }

        function applyData(data) {
          store.value = window.createDataStore(data);
          if (!store.value) {
            throw new Error('数据格式无效');
          }
          rememberDataVersion(data);
          deferredReady.value = false;
          resetFilters();
          loading.value = false;
          return Promise.resolve();
        }

        return fetch(getDataUrl())
          .then(function (res) {
            if (!res.ok) throw new Error('无法加载数据');
            return res.json();
          })
          .then(applyData);
      }

      onMounted(function () {
        if (typeof Vue === 'undefined') {
          error.value = 'Vue 库加载失败，请检查网络连接后刷新页面';
          loading.value = false;
          return;
        }
        if (typeof echarts === 'undefined') {
          error.value = 'ECharts 库加载失败，请检查网络连接后刷新页面';
          loading.value = false;
          return;
        }
        if (typeof window.createDataStore !== 'function') {
          error.value = 'data-store.js 加载失败，请刷新页面';
          loading.value = false;
          return;
        }
        if (window.AdAuth) {
          authUser.value = window.AdAuth.getSessionUser();
        }

        loadData()
          .then(function () { return nextTick(); })
          .then(function () {
            scheduleDeferredSections();
            initCharts();
            window.addEventListener('resize', function () {
              if (trendChart) trendChart.resize();
              if (funnelChart) funnelChart.resize();
              if (detailChart) detailChart.resize();
              if (kpiTrendChart) kpiTrendChart.resize();
              syncFunnelColumnWidths();
            });
            document.addEventListener('click', function () {
              accountDropdownOpen.value = false;
              countryDropdownOpen.value = false;
            });
            setupColumnSelection();
          })
          .catch(function (e) {
            error.value = (e && e.message) || '数据加载失败，请先运行 node scripts/convert-xlsx.js 生成数据';
            loading.value = false;
          });
      });

      watch([filters, granularity, authUser], function () {
        if (isLoggedIn.value) nextTick().then(renderTrendChart);
      }, { deep: true });

      watch([activeFunnel, funnelAccount, summary], function () {
        if (isLoggedIn.value) nextTick().then(renderFunnelChart);
      });

      watch([funnelAccounts, funnelSortKey, funnelSortDir], function () {
        if (funnelAccount.value && !funnelAccounts.value.some(function (a) {
          return a.accountName === funnelAccount.value;
        })) {
          funnelAccount.value = '';
        }
        syncFunnelColumnWidths();
      });

      watch(sortedFunnelTable, function () {
        syncFunnelColumnWidths();
      });

      watch(detailSeries, function () {
        if (detailModal.value.show) {
          nextTick().then(renderDetailChart);
        }
      });

      watch(filters, function () {
        if (kpiTrendModal.value.show) {
          nextTick().then(renderKpiTrendChart);
        }
      }, { deep: true });

      return {
        loading: loading,
        error: error,
        meta: meta,
        filters: filters,
        compareFilters: compareFilters,
        lifecycleFilters: lifecycleFilters,
        granularity: granularity,
        compareMetric: compareMetric,
        topN: topN,
        lifecycleSearch: lifecycleSearch,
        lifecyclePhase: lifecyclePhase,
        lifecycleSortKey: lifecycleSortKey,
        lifecycleSortDir: lifecycleSortDir,
        headCreativeWindow: headCreativeWindow,
        sortLifecycleColumn: sortLifecycleColumn,
        lifecycleSortIcon: lifecycleSortIcon,
        copyToast: copyToast,
        funnelAccount: funnelAccount,
        funnelSortKey: funnelSortKey,
        funnelSortDir: funnelSortDir,
        funnelSummaryRow: funnelSummaryRow,
        sortedFunnelTable: sortedFunnelTable,
        sortFunnelColumn: sortFunnelColumn,
        funnelSortIcon: funnelSortIcon,
        accountSearch: accountSearch,
        countrySearch: countrySearch,
        accountDropdownOpen: accountDropdownOpen,
        countryDropdownOpen: countryDropdownOpen,
        detailModal: detailModal,
        kpiTrendModal: kpiTrendModal,
        authUser: authUser,
        isLoggedIn: isLoggedIn,
        showLoginModal: showLoginModal,
        loginForm: loginForm,
        loginError: loginError,
        protectedScopeHint: protectedScopeHint,
        deferredReady: deferredReady,
        openLoginModal: openLoginModal,
        closeLoginModal: closeLoginModal,
        handleLogin: handleLogin,
        handleLogout: handleLogout,
        kpiCards: kpiCards,
        funnelKpiCards: funnelKpiCards,
        lifecycleItems: lifecycleItems,
        lifecycleStats: lifecycleStats,
        compareData: compareData,
        potentialCreatives: potentialCreatives,
        potentialWindowDays: potentialWindowDays,
        funnelAccounts: funnelAccounts,
        countryTiers: countryTiers,
        countryExpanded: countryExpanded,
        activeFunnel: activeFunnel,
        filteredAccountOptions: filteredAccountOptions,
        filteredCountryOptions: filteredCountryOptions,
        formatCurrency: U.formatCurrency,
        formatCurrencyExact: U.formatCurrencyExact,
        formatCurrencyInteger: U.formatCurrencyInteger,
        formatNumber: U.formatNumber,
        formatPercent: U.formatPercent,
        formatDateDisplay: U.formatDateDisplay,
        resetFilters: resetFilters,
        applyDatePreset: applyDatePreset,
        clearDatePreset: clearDatePreset,
        isDatePresetActive: isDatePresetActive,
        openKpiTrend: openKpiTrend,
        closeKpiTrendModal: closeKpiTrendModal,
        roasClass: roasClass,
        openDatePicker: openDatePicker,
        copyText: copyText,
        onTableHeadClick: onTableHeadClick,
        onCountryColumnClick: onCountryColumnClick,
        onCompareColumnClick: onCompareColumnClick,
        openCreativeDetail: openCreativeDetail,
        closeCreativeDetail: closeCreativeDetail,
        compareBarWidth: compareBarWidth,
        formatCompareValue: formatCompareValue,
        potentialTotalSpend: potentialTotalSpend,
        compareFilter: compareFilter,
        globalFilter: globalFilter,
        lifecycleFilter: lifecycleFilter,
        isAccountSelected: isAccountSelected,
        isCountrySelected: isCountrySelected,
        toggleAccount: toggleAccount,
        toggleCountry: toggleCountry,
        selectVisibleAccounts: selectVisibleAccounts,
        selectVisibleCountries: selectVisibleCountries,
        clearAccounts: clearAccounts,
        clearCountries: clearCountries,
      };
    },
    template: '#app-template',
  });

  app.config.errorHandler = function (err, instance, info) {
    console.error('[Dashboard Error]', info, err);
  };

  app.mount('#app');
})();
