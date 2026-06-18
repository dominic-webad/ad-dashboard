(function (global) {
  var OPTIMIZER_NAMES = ['Alina', 'Barry', 'Dom', 'Creative', 'Angie'];

  var OPTIMIZER_RULES = [
    { key: 'Creative', match: 'creative' },
    { key: 'Barry', match: 'barry' },
    { key: 'Angie', match: 'angie' },
    { key: 'Dom', match: 'dom' },
    { key: 'Alina', match: 'alina' },
  ];

  function formatNumber(n, decimals) {
    decimals = decimals === undefined ? 2 : decimals;
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString('zh-CN', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals > 0 ? Math.min(decimals, 2) : 0,
    });
  }

  function formatPercent(n) {
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(2) + '%';
  }

  function formatCurrency(n) {
    if (!Number.isFinite(n)) return '—';
    return '$' + formatNumber(n, 2);
  }

  function formatCurrencyExact(n) {
    if (!Number.isFinite(n)) return '—';
    return '$' + n.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatCurrencyInteger(n) {
    if (!Number.isFinite(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  var MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatDateDisplay(iso) {
    if (!iso) return '—';
    var d = parseDate(iso);
    if (!d) return String(iso);
    return MONTH_LABELS[d.getMonth()] + ' ' + d.getDate() + ',' + d.getFullYear();
  }

  function toIsoDate(iso) {
    if (!iso) return '';
    return String(iso).slice(0, 10);
  }

  function parseDate(str) {
    if (!str) return null;
    var d = new Date(toIsoDate(str) + 'T00:00:00');
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatLocalIsoDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function daysBetween(a, b) {
    var da = parseDate(a);
    var db = parseDate(b);
    if (!da || !db) return 0;
    return Math.round((db - da) / 86400000);
  }

  function getWeekKey(dateStr) {
    var d = parseDate(dateStr);
    if (!d) return '';
    var day = d.getDay() || 7;
    var monday = new Date(d);
    monday.setDate(d.getDate() - day + 1);
    return monday.toISOString().slice(0, 10);
  }

  function getMonthKey(dateStr) {
    if (!dateStr) return '';
    return toIsoDate(dateStr).slice(0, 7);
  }

  function parseOptimizerFromAccount(accountName) {
    var lower = (accountName || '').toLowerCase();
    for (var i = 0; i < OPTIMIZER_RULES.length; i++) {
      if (lower.indexOf(OPTIMIZER_RULES[i].match) >= 0) return OPTIMIZER_RULES[i].key;
    }
    return '其他';
  }

  function parseLaunchFromCreative(creative) {
    if (!creative) return null;
    var parts = creative.split('_');
    if (/^\d{8}$/.test(parts[0])) {
      return parts[0].slice(0, 4) + '-' + parts[0].slice(4, 6) + '-' + parts[0].slice(6, 8);
    }
    return null;
  }

  function emptyFunnel() {
    return {
      clicks: 0,
      landingPageViews: 0,
      addsToCart: 0,
      checkoutsInitiated: 0,
      addsPaymentInfo: 0,
      purchases: 0,
    };
  }

  function addFunnelFields(target, r) {
    target.clicks += r.clicks || 0;
    target.landingPageViews += r.landingPageViews || 0;
    target.addsToCart += r.addsToCart || 0;
    target.checkoutsInitiated += r.checkoutsInitiated || 0;
    target.addsPaymentInfo += r.addsPaymentInfo || 0;
    target.purchases += r.purchases || 0;
    if (r.country === 'US') {
      target.usClicks = (target.usClicks || 0) + (r.clicks || 0);
      target.usPurchases = (target.usPurchases || 0) + (r.purchases || 0);
      target.usSpend = (target.usSpend || 0) + (r.spend || 0);
      target.usImpressions = (target.usImpressions || 0) + (r.impressions || 0);
    }
  }

  function funnelRate(current, previous) {
    if (!previous || previous <= 0) return 0;
    return (current / previous) * 100;
  }

  function buildFunnelRates(funnel) {
    return {
      clickToLpv: funnelRate(funnel.landingPageViews, funnel.clicks),
      lpvToCart: funnelRate(funnel.addsToCart, funnel.landingPageViews),
      cartToCheckout: funnelRate(funnel.checkoutsInitiated, funnel.addsToCart),
      checkoutToPay: funnelRate(funnel.addsPaymentInfo, funnel.checkoutsInitiated),
      payToPurchase: funnelRate(funnel.purchases, funnel.addsPaymentInfo),
      clickToPurchase: funnelRate(funnel.purchases, funnel.clicks),
      payRate: funnelRate(funnel.purchases, funnel.clicks),
      usPayRate: funnelRate(funnel.usPurchases || 0, funnel.usClicks || 0),
    };
  }

  function buildApplovinFunnelRates(funnel) {
    return {
      impressionToView: funnelRate(funnel.landingPageViews, funnel.impressions),
      viewToCart: funnelRate(funnel.addsToCart, funnel.landingPageViews),
      cartToCheckout: funnelRate(funnel.checkoutsInitiated, funnel.addsToCart),
      checkoutToPurchase: funnelRate(funnel.purchases, funnel.checkoutsInitiated),
      viewToPurchase: funnelRate(funnel.purchases, funnel.landingPageViews),
      impressionToPurchase: funnelRate(funnel.purchases, funnel.impressions),
      payRate: funnelRate(funnel.purchases, funnel.landingPageViews),
      usPayRate: funnelRate(funnel.usPurchases || 0, funnel.usImpressions || 0),
    };
  }

  function buildLastNDays(endDay, n) {
    var end = parseDate(endDay);
    if (!end) return [];
    var days = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(end);
      d.setDate(end.getDate() - i);
      days.push(formatLocalIsoDate(d));
    }
    return days;
  }

  function fillLastNDaysSeries(series, endDay, n) {
    var dayList = buildLastNDays(endDay, n);
    if (!dayList.length) return series || [];
    var map = new Map();
    (series || []).forEach(function (d) {
      map.set(toIsoDate(d.day), d);
    });
    return dayList.map(function (day) {
      if (map.has(day)) return map.get(day);
      return { day: day, spend: 0, conversionValue: 0, purchases: 0, roas: 0, d7Roas: 0 };
    });
  }

  function findRisingCreatives(records, latestDay, windowDays) {
    windowDays = windowDays || 7;
    if (!latestDay) return [];
    var dayList = buildLastNDays(latestDay, windowDays);
    var byCreative = new Map();

    records.forEach(function (r) {
      var day = toIsoDate(r.day);
      if (dayList.indexOf(day) < 0) return;
      if (!byCreative.has(r.creative)) {
        byCreative.set(r.creative, {
          creative: r.creative,
          daySpend: {},
          spend: 0,
          conversionValue: 0,
          purchases: 0,
          clicks: 0,
        });
      }
      var item = byCreative.get(r.creative);
      item.daySpend[day] = (item.daySpend[day] || 0) + r.spend;
      item.spend += r.spend;
      item.conversionValue += r.conversionValue;
      item.purchases += r.purchases;
      item.clicks += (r.clicks || 0);
    });

    var results = [];
    byCreative.forEach(function (item) {
      var spends = dayList.map(function (d) { return item.daySpend[d] || 0; });
      var totalSpend = spends.reduce(function (s, v) { return s + v; }, 0);
      var roas = item.spend > 0 ? item.conversionValue / item.spend : 0;
      if (totalSpend <= 1000 || roas <= 0.3) return;

      results.push({
        creative: item.creative,
        dayList: dayList,
        dailySpends: spends,
        windowDays: windowDays,
        yesterdaySpend: spends[spends.length - 1],
        totalSpend: totalSpend,
        totalSpend7d: totalSpend,
        roas: roas,
        purchases: item.purchases,
        cpa: item.purchases > 0 ? item.spend / item.purchases : 0,
        payRate: item.clicks > 0 ? item.purchases / item.clicks : 0,
      });
    });

    return results.sort(function (a, b) { return b.totalSpend - a.totalSpend; });
  }

  function aggregateByTime(records, granularity, dateField) {
    dateField = dateField || 'day';
    var map = new Map();

    records.forEach(function (r) {
      var raw = toIsoDate(r[dateField]);
      var key;
      if (granularity === 'day') key = raw;
      else if (granularity === 'week') key = getWeekKey(raw);
      else key = getMonthKey(raw);
      if (!key) return;

      if (!map.has(key)) {
        map.set(key, {
          date: key,
          spend: 0,
          purchases: 0,
          conversionValue: 0,
          clicks: 0,
          impressions: 0,
        });
      }
      var agg = map.get(key);
      agg.spend += r.spend;
      agg.purchases += r.purchases;
      agg.conversionValue += r.conversionValue;
      agg.clicks += r.clicks;
      agg.impressions += r.impressions;
    });

    return Array.from(map.values())
      .sort(function (a, b) { return a.date.localeCompare(b.date); })
      .map(function (row) {
        return Object.assign({}, row, {
          roas: row.spend > 0 ? row.conversionValue / row.spend : 0,
          cpa: row.purchases > 0 ? row.spend / row.purchases : 0,
          ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
          cpc: row.clicks > 0 ? row.spend / row.clicks : 0,
        });
      });
  }

  function summarizeRecords(records) {
    var spend = 0;
    var purchases = 0;
    var conversionValue = 0;
    var clicks = 0;
    var impressions = 0;
    var funnel = emptyFunnel();

    records.forEach(function (r) {
      spend += r.spend;
      purchases += r.purchases;
      conversionValue += r.conversionValue;
      clicks += r.clicks;
      impressions += r.impressions;
      addFunnelFields(funnel, r);
    });

    return Object.assign({
      spend: spend,
      purchases: purchases,
      conversionValue: conversionValue,
      roas: spend > 0 ? conversionValue / spend : 0,
      cpa: purchases > 0 ? spend / purchases : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      clicks: clicks,
      impressions: impressions,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    }, funnel, {
      funnelRates: buildFunnelRates(funnel),
      usCpm: funnel.usImpressions > 0 ? (funnel.usSpend / funnel.usImpressions) * 1000 : 0,
    });
  }

  function groupByCreative(records, latestDay) {
    var map = new Map();
    records.forEach(function (r) {
      var key = r.creative;
      if (!map.has(key)) {
        map.set(key, {
          creative: key,
          launchDate: r.launchDate,
          spend: 0,
          purchases: 0,
          conversionValue: 0,
          clicks: 0,
          impressions: 0,
          ctrSum: 0,
          ctrCount: 0,
        });
      }
      var g = map.get(key);
      g.spend += r.spend;
      g.purchases += r.purchases;
      g.conversionValue += r.conversionValue;
      g.clicks += r.clicks;
      g.impressions += r.impressions;
      if (r.ctr > 0) {
        g.ctrSum += r.ctr;
        g.ctrCount += 1;
      }
    });

    return Array.from(map.values()).map(function (g) {
      return Object.assign({}, g, {
        roas: g.spend > 0 ? g.conversionValue / g.spend : 0,
        cpa: g.purchases > 0 ? g.spend / g.purchases : 0,
        ctr: g.impressions > 0 ? (g.clicks / g.impressions) * 100 : g.ctrCount > 0 ? g.ctrSum / g.ctrCount : 0,
        cpc: g.clicks > 0 ? g.spend / g.clicks : 0,
        cpm: g.impressions > 0 ? (g.spend / g.impressions) * 1000 : 0,
        daysLive: daysBetween(g.launchDate, latestDay || g.launchDate),
      });
    });
  }

  function groupByCountry(records) {
    var map = new Map();
    records.forEach(function (r) {
      var country = r.country;
      if (!map.has(country)) {
        map.set(country, { country: country, spend: 0, conversionValue: 0, purchases: 0 });
      }
      var g = map.get(country);
      g.spend += r.spend;
      g.conversionValue += r.conversionValue;
      g.purchases += r.purchases;
    });
    return Array.from(map.values()).map(function (g) {
      var roas = g.spend > 0 ? g.conversionValue / g.spend : 0;
      return Object.assign({}, g, { roas: roas, roi: roas * 100 });
    });
  }

  function aggregateFunnelByDay(records, accountName) {
    var map = new Map();
    records.forEach(function (r) {
      if (accountName && r.accountName !== accountName) return;
      var day = toIsoDate(r.day);
      if (!map.has(day)) {
        map.set(day, {
          day: day,
          spend: 0,
          conversionValue: 0,
          clicks: 0,
          landingPageViews: 0,
          addsToCart: 0,
          checkoutsInitiated: 0,
          addsPaymentInfo: 0,
          purchases: 0,
          usClicks: 0,
          usPurchases: 0,
        });
      }
      var d = map.get(day);
      d.spend += r.spend;
      d.conversionValue += r.conversionValue;
      d.clicks += r.clicks;
      d.landingPageViews += r.landingPageViews || 0;
      d.addsToCart += r.addsToCart || 0;
      d.checkoutsInitiated += r.checkoutsInitiated || 0;
      d.addsPaymentInfo += r.addsPaymentInfo || 0;
      d.purchases += r.purchases;
      if (r.country === 'US') {
        d.usClicks += r.clicks || 0;
        d.usPurchases += r.purchases || 0;
      }
    });
    return Array.from(map.values()).sort(function (a, b) {
      return a.day.localeCompare(b.day);
    }).map(function (d) {
      var funnel = {
        clicks: d.clicks,
        landingPageViews: d.landingPageViews,
        addsToCart: d.addsToCart,
        checkoutsInitiated: d.checkoutsInitiated,
        addsPaymentInfo: d.addsPaymentInfo,
        purchases: d.purchases,
        usClicks: d.usClicks,
        usPurchases: d.usPurchases,
      };
      return Object.assign({}, d, {
        revenue: d.conversionValue,
        funnelRates: buildFunnelRates(funnel),
        roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
      });
    });
  }

  function groupFunnelByAccount(records) {
    var map = new Map();
    records.forEach(function (r) {
      if (!map.has(r.accountName)) {
        map.set(r.accountName, Object.assign(emptyFunnel(), {
          accountName: r.accountName,
          optimizer: r.optimizer,
          spend: 0,
        }));
      }
      var item = map.get(r.accountName);
      item.spend += r.spend;
      item.conversionValue = (item.conversionValue || 0) + (r.conversionValue || 0);
      addFunnelFields(item, r);
    });

    return Array.from(map.values())
      .map(function (item) {
        return Object.assign({}, item, {
          revenue: item.conversionValue || 0,
          roas: item.spend > 0 ? (item.conversionValue || 0) / item.spend : 0,
          funnelRates: buildFunnelRates(item),
          usCpm: item.usImpressions > 0 ? (item.usSpend / item.usImpressions) * 1000 : 0,
        });
      })
      .sort(function (a, b) { return b.spend - a.spend; });
  }

  function getCreativeDailySeries(records, creative) {
    var map = new Map();
    records.forEach(function (r) {
      if (r.creative !== creative) return;
      var day = toIsoDate(r.day);
      if (!map.has(day)) {
        map.set(day, { day: day, spend: 0, conversionValue: 0, purchases: 0 });
      }
      var d = map.get(day);
      d.spend += r.spend;
      d.conversionValue += r.conversionValue;
      d.purchases += r.purchases;
    });

    return Array.from(map.values())
      .sort(function (a, b) { return a.day.localeCompare(b.day); })
      .map(function (d) {
        return Object.assign({}, d, {
          roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
        });
      });
  }

  var PHASE_LABELS = {
    test: '测试期',
    growth: '增长期',
    scale: '起量期',
    decline: '衰退期',
  };

  function hasLastNDaysLowRoas(records, creative, referenceDay, n, threshold) {
    threshold = threshold === undefined ? 0.25 : threshold;
    if (!referenceDay) return false;
    var dayList = buildLastNDays(referenceDay, n);
    if (dayList.length < n) return false;
    var seriesMap = new Map();
    getCreativeDailySeries(records, creative).forEach(function (d) {
      seriesMap.set(d.day, d);
    });
    for (var i = 0; i < dayList.length; i++) {
      var d = seriesMap.get(dayList[i]);
      if (!d || d.spend <= 0) return false;
      if (d.roas >= threshold) return false;
    }
    return true;
  }

  function hasConsecutiveLowRoas(records, creative, threshold) {
    threshold = threshold === undefined ? 0.25 : threshold;
    var series = getCreativeDailySeries(records, creative).filter(function (d) {
      return d.spend > 0;
    });
    if (series.length < 3) return false;

    for (var i = 0; i <= series.length - 3; i++) {
      if (daysBetween(series[i].day, series[i + 1].day) !== 1) continue;
      if (daysBetween(series[i + 1].day, series[i + 2].day) !== 1) continue;
      if (series[i].roas < threshold && series[i + 1].roas < threshold && series[i + 2].roas < threshold) {
        return true;
      }
    }
    return false;
  }

  function classifyLifecycle(creatives, records, referenceDay) {
    if (!referenceDay) {
      records.forEach(function (r) {
        var day = toIsoDate(r.day);
        if (!referenceDay || day > referenceDay) referenceDay = day;
      });
    }
    return creatives.map(function (c) {
      var phase = 'growth';
      if (c.spend < 100) {
        phase = 'test';
      } else if (c.spend > 500 && c.roas < 0.3 && hasLastNDaysLowRoas(records, c.creative, referenceDay, 3, 0.25)) {
        phase = 'decline';
      } else if (c.spend > 500) {
        phase = 'scale';
      } else {
        phase = 'growth';
      }

      return Object.assign({}, c, {
        phase: phase,
        phaseLabel: PHASE_LABELS[phase],
        isDecline: phase === 'decline',
      });
    });
  }

  function expandCompactData(data) {
    if (!data || !data.meta || !data.meta.compact) return data;

    var days = data.days || [];
    var accounts = data.accounts || [];
    var creatives = data.creatives || [];
    var launchCache = {};

    function launchDate(cr) {
      if (!launchCache[cr]) launchCache[cr] = parseLaunchFromCreative(cr);
      return launchCache[cr];
    }

    var records = (data.rows || []).map(function (row) {
      var accountName = accounts[row[1]];
      var creative = creatives[row[3]];
      var spend = row[4];
      var conversionValue = row[6];
      return {
        day: days[row[0]],
        accountName: accountName,
        country: row[2],
        creative: creative,
        launchDate: launchDate(creative),
        optimizer: parseOptimizerFromAccount(accountName),
        spend: spend,
        purchases: row[5],
        conversionValue: conversionValue,
        roas: spend > 0 ? conversionValue / spend : 0,
        clicks: row[7],
        ctr: row[8],
        cpc: row[9],
        impressions: row[10],
        landingPageViews: row[11] || 0,
        addsToCart: row[12] || 0,
        checkoutsInitiated: row[13] || 0,
        addsPaymentInfo: row[14] || 0,
      };
    });

    return { meta: data.meta, records: records };
  }

  function formatCompareMetric(item, metric) {
    if (metric === 'spend' || metric === 'cpc' || metric === 'cpa') return formatCurrency(item[metric]);
    if (metric === 'ctr') return formatPercent(item[metric]);
    if (metric === 'purchases') return formatNumber(item[metric], 0);
    return formatNumber(item[metric], metric === 'roas' ? 2 : 2);
  }

  global.AdUtils = {
    expandCompactData: expandCompactData,
    formatNumber: formatNumber,
    formatPercent: formatPercent,
    formatCurrency: formatCurrency,
    formatCurrencyExact: formatCurrencyExact,
    formatCurrencyInteger: formatCurrencyInteger,
    formatDateDisplay: formatDateDisplay,
    formatCompareMetric: formatCompareMetric,
    toIsoDate: toIsoDate,
    daysBetween: daysBetween,
    getWeekKey: getWeekKey,
    getMonthKey: getMonthKey,
    buildLastNDays: buildLastNDays,
    fillLastNDaysSeries: fillLastNDaysSeries,
    buildApplovinFunnelRates: buildApplovinFunnelRates,
    formatLocalIsoDate: formatLocalIsoDate,
    parseLaunchFromCreative: parseLaunchFromCreative,
    PHASE_LABELS: PHASE_LABELS,
    aggregateByTime: aggregateByTime,
    summarizeRecords: summarizeRecords,
    groupByCreative: groupByCreative,
    groupByCountry: groupByCountry,
    aggregateFunnelByDay: aggregateFunnelByDay,
    groupFunnelByAccount: groupFunnelByAccount,
    classifyLifecycle: classifyLifecycle,
    getCreativeDailySeries: getCreativeDailySeries,
    buildFunnelRates: buildFunnelRates,
    findRisingCreatives: findRisingCreatives,
    parseOptimizerFromAccount: parseOptimizerFromAccount,
    OPTIMIZER_NAMES: OPTIMIZER_NAMES,
  };
})(window);
