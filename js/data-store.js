(function (global) {
  var U = global.AdUtils;

  function isApplovinStore(store) {
    return store.platform === 'applovin';
  }

  function lowerBoundDay(days, target) {
    var lo = 0;
    var hi = days.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (days[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function upperBoundDay(days, target) {
    var lo = 0;
    var hi = days.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (days[mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  function resolveDayRange(store, f) {
    if (!store.days.length) return null;
    var startIdx = 0;
    var endIdx = store.days.length - 1;
    if (f.dateStart) {
      startIdx = lowerBoundDay(store.days, f.dateStart);
      if (startIdx >= store.days.length) return null;
    }
    if (f.dateEnd) {
      endIdx = upperBoundDay(store.days, f.dateEnd);
      if (endIdx < 0) return null;
    }
    if (startIdx > endIdx) return null;
    return { startIdx: startIdx, endIdx: endIdx };
  }

  function filterKey(f) {
    var accounts = f.accounts && f.accounts.length ? f.accounts.slice().sort() : [];
    var countries = f.countries && f.countries.length ? f.countries.slice().sort() : [];
    var optimizers = f.optimizers && f.optimizers.length ? f.optimizers.slice().sort() : [];
    return [
      f.dateStart || '',
      f.dateEnd || '',
      f.optimizer || '',
      optimizers.join('\u0001'),
      accounts.join('\u0001'),
      countries.join('\u0001'),
    ].join('\u0002');
  }

  function createBundleCache(limit) {
    var map = new Map();
    var order = [];
    return {
      get: function (key, compute) {
        if (map.has(key)) return map.get(key);
        var value = compute();
        map.set(key, value);
        order.push(key);
        if (order.length > limit) map.delete(order.shift());
        return value;
      },
      seed: function (key, value) {
        if (map.has(key)) return;
        map.set(key, value);
        order.push(key);
        if (order.length > limit) map.delete(order.shift());
      },
      clear: function () {
        map.clear();
        order.length = 0;
      },
    };
  }

  function buildRowIndexes(data) {
    var rowsByDay = [];
    var creativeDayMap = new Map();
    var rows = data.rows;
    var days = data.days;
    var creatives = data.creatives;

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var dayIdx = row[0];
      if (!rowsByDay[dayIdx]) rowsByDay[dayIdx] = [];
      rowsByDay[dayIdx].push(i);

      var day = days[dayIdx];
      var creative = creatives[row[3]];
      if (!creativeDayMap.has(creative)) creativeDayMap.set(creative, new Map());
      var cDay = creativeDayMap.get(creative);
      if (!cDay.has(day)) {
        cDay.set(day, { spend: 0, conversionValue: 0, purchases: 0, clicks: 0 });
      }
      var cd = cDay.get(day);
      cd.spend += row[4];
      cd.conversionValue += row[6];
      cd.purchases += row[5];
      cd.clicks += row[7];
    }

    return { rowsByDay: rowsByDay, creativeDayMap: creativeDayMap };
  }

  function summarizeCreativeDayMap(dayMap) {
    if (!dayMap) return { spend: 0, conversionValue: 0, purchases: 0, roas: 0 };
    var spend = 0;
    var conversionValue = 0;
    var purchases = 0;
    dayMap.forEach(function (d) {
      spend += d.spend;
      conversionValue += d.conversionValue;
      purchases += d.purchases;
    });
    return {
      spend: spend,
      conversionValue: conversionValue,
      purchases: purchases,
      roas: spend > 0 ? conversionValue / spend : 0,
    };
  }

  function rowImpressions(row) {
    var clicks = row[7] || 0;
    var ctr = row[8] || 0;
    var imp = row[10] || 0;
    if (ctr > 0 && clicks > 0) {
      var derived = Math.round((clicks / ctr) * 100);
      if (imp <= 0 || imp < clicks) return derived;
    }
    if (imp > 0) return imp;
    var cpm = row[16] || row[15] || 0;
    var spend = row[4] || 0;
    if (cpm > 0 && spend > 0) return Math.round((spend / cpm) * 1000);
    return 0;
  }

  function accumulateCpmStats(target, row) {
    var cpm = row[16] || row[15] || 0;
    if (cpm > 0) {
      target.cpmSum += cpm;
      target.cpmCount += 1;
    }
  }

  function filterDayMapEntries(dayMap, f) {
    if (!dayMap) return [];
    var entries = Array.from(dayMap.entries());
    if (!f || (!f.dateStart && !f.dateEnd)) return entries;
    return entries.filter(function (entry) {
      var day = entry[0];
      if (f.dateStart && day < f.dateStart) return false;
      if (f.dateEnd && day > f.dateEnd) return false;
      return true;
    });
  }

  function optimizerMatches(store, row, f) {
    var optimizer = store.getOptimizer(row[1]);
    if (f.optimizers && f.optimizers.length) {
      return f.optimizers.indexOf(optimizer) >= 0;
    }
    if (f.optimizer) return optimizer === f.optimizer;
    return true;
  }

  function rowMatchesDims(store, row, f, accountSet, countrySet) {
    if (!optimizerMatches(store, row, f)) return false;
    if (accountSet && !accountSet.has(store.accounts[row[1]])) return false;
    if (countrySet && !countrySet.has(row[2])) return false;
    return true;
  }

  function rowMatches(store, row, f) {
    var day = store.days[row[0]];
    if (f.dateStart && day < f.dateStart) return false;
    if (f.dateEnd && day > f.dateEnd) return false;
    return rowMatchesDims(store, row, f, null, null)
      && (!f.accounts || !f.accounts.length || f.accounts.indexOf(store.accounts[row[1]]) >= 0)
      && (!f.countries || !f.countries.length || f.countries.indexOf(row[2]) >= 0);
  }

  function eachRow(store, f, cb) {
    if (!store.rowsByDay) {
      for (var i = 0; i < store.rows.length; i++) {
        var row = store.rows[i];
        if (rowMatches(store, row, f)) cb(row, i);
      }
      return;
    }
    var range = resolveDayRange(store, f);
    if (!range) return;
    var accountSet = f.accounts && f.accounts.length ? new Set(f.accounts) : null;
    var countrySet = f.countries && f.countries.length ? new Set(f.countries) : null;
    var rows = store.rows;
    for (var di = range.startIdx; di <= range.endIdx; di++) {
      var bucket = store.rowsByDay[di];
      if (!bucket) continue;
      for (var j = 0; j < bucket.length; j++) {
        var ri = bucket[j];
        var r = rows[ri];
        if (!rowMatchesDims(store, r, f, accountSet, countrySet)) continue;
        cb(r, ri);
      }
    }
  }

  function getLatestDay(store, f) {
    if (!store.rowsByDay) {
      var latest = '';
      eachRow(store, f, function (row) {
        var day = store.days[row[0]];
        if (!latest || day > latest) latest = day;
      });
      return latest;
    }
    var range = resolveDayRange(store, f);
    if (!range) return '';
    var accountSet = f.accounts && f.accounts.length ? new Set(f.accounts) : null;
    var countrySet = f.countries && f.countries.length ? new Set(f.countries) : null;
    var rows = store.rows;
    for (var di = range.endIdx; di >= range.startIdx; di--) {
      var bucket = store.rowsByDay[di];
      if (!bucket) continue;
      for (var j = 0; j < bucket.length; j++) {
        var r = rows[bucket[j]];
        if (rowMatchesDims(store, r, f, accountSet, countrySet)) return store.days[di];
      }
    }
    return '';
  }

  function finalizeSummaryState(s, isApplovin) {
    var base = {
      spend: s.spend,
      purchases: s.purchases,
      conversionValue: s.conversionValue,
      roas: s.spend > 0 ? s.conversionValue / s.spend : 0,
      cpa: s.purchases > 0 ? s.spend / s.purchases : 0,
      ctr: s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0,
      cpc: s.clicks > 0 ? s.spend / s.clicks : 0,
      clicks: s.clicks,
      impressions: s.impressions,
      cpm: s.impressions > 0 ? (s.spend / s.impressions) * 1000 : 0,
      landingPageViews: s.landingPageViews,
      addsToCart: s.addsToCart,
      checkoutsInitiated: s.checkoutsInitiated,
      addsPaymentInfo: s.addsPaymentInfo,
    };
    if (isApplovin) {
      base.d7ConversionValue = s.d7ConversionValue || 0;
      base.d7Roas = s.spend > 0 ? (s.d7ConversionValue || 0) / s.spend : 0;
    }
    return Object.assign(base, s.funnel, {
      funnelRates: isApplovin
        ? U.buildApplovinFunnelRates(Object.assign({}, s.funnel, { impressions: s.impressions }))
        : U.buildFunnelRates(s.funnel),
      usCpm: s.funnel.usImpressions > 0 ? (s.funnel.usSpend / s.funnel.usImpressions) * 1000 : 0,
    });
  }

  function finalizeCreativeList(creativeMap, latestDay, store) {
    return Array.from(creativeMap.values()).map(function (g) {
      return Object.assign({}, g, {
        roas: g.spend > 0 ? g.conversionValue / g.spend : 0,
        cpa: g.purchases > 0 ? g.spend / g.purchases : 0,
        ctr: g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0,
        cpc: g.clicks > 0 ? g.spend / g.clicks : 0,
        cpm: g.impressions > 0 ? (g.spend / g.impressions) * 1000 : g.cpmCount > 0 ? g.cpmSum / g.cpmCount : 0,
        daysLive: U.daysBetween(g.launchDate, latestDay || g.launchDate),
      });
    });
  }

  function rollupTimeSeries(daySeries, granularity) {
    if (!daySeries.length || granularity === 'day') return daySeries;
    var map = new Map();
    daySeries.forEach(function (row) {
      var key = granularity === 'week' ? U.getWeekKey(row.date) : U.getMonthKey(row.date);
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, { date: key, spend: 0, purchases: 0, conversionValue: 0, clicks: 0, impressions: 0 });
      }
      var agg = map.get(key);
      agg.spend += row.spend;
      agg.purchases += row.purchases;
      agg.conversionValue += row.conversionValue;
      agg.clicks += row.clicks;
      agg.impressions += row.impressions;
    });
    return Array.from(map.values()).sort(function (a, b) {
      return a.date.localeCompare(b.date);
    }).map(function (row) {
      return Object.assign({}, row, {
        roas: row.spend > 0 ? row.conversionValue / row.spend : 0,
        cpa: row.purchases > 0 ? row.spend / row.purchases : 0,
        ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
        cpc: row.clicks > 0 ? row.spend / row.clicks : 0,
      });
    });
  }

  function queryBundleApplovin(store, f) {
    var summaryState = {
      spend: 0,
      purchases: 0,
      conversionValue: 0,
      d7ConversionValue: 0,
      clicks: 0,
      impressions: 0,
      landingPageViews: 0,
      addsToCart: 0,
      checkoutsInitiated: 0,
      addsPaymentInfo: 0,
      funnel: {
        impressions: 0,
        landingPageViews: 0, addsToCart: 0, checkoutsInitiated: 0, addsPaymentInfo: 0, purchases: 0,
        usPurchases: 0, usSpend: 0, usImpressions: 0,
      },
    };
    var timeMap = new Map();
    var creativeMap = new Map();
    var creativeDayMap = new Map();
    var countryMap = new Map();
    var funnelCountryMap = new Map();
    var funnelDayMap = new Map();
    var latestDay = '';

    eachRow(store, f, function (row) {
      var day = store.days[row[0]];
      var creative = store.creatives[row[3]];
      var country = row[2];
      if (!latestDay || day > latestDay) latestDay = day;

      summaryState.spend += row[4];
      summaryState.purchases += row[5];
      summaryState.conversionValue += row[6];
      summaryState.d7ConversionValue += row[15] || 0;
      summaryState.clicks += row[7];
      summaryState.impressions += rowImpressions(row);
      summaryState.landingPageViews += row[11] || 0;
      summaryState.addsToCart += row[12] || 0;
      summaryState.checkoutsInitiated += row[13] || 0;
      summaryState.addsPaymentInfo += row[14] || 0;
      summaryState.funnel.impressions += rowImpressions(row);
      summaryState.funnel.landingPageViews += row[11] || 0;
      summaryState.funnel.addsToCart += row[12] || 0;
      summaryState.funnel.checkoutsInitiated += row[13] || 0;
      summaryState.funnel.addsPaymentInfo += row[14] || 0;
      summaryState.funnel.purchases += row[5];
      if (country === 'US') {
        summaryState.funnel.usPurchases += row[5];
        summaryState.funnel.usSpend += row[4];
        summaryState.funnel.usImpressions += rowImpressions(row);
      }

      if (!timeMap.has(day)) {
        timeMap.set(day, { date: day, spend: 0, purchases: 0, conversionValue: 0, clicks: 0, impressions: 0 });
      }
      var t = timeMap.get(day);
      t.spend += row[4];
      t.purchases += row[5];
      t.conversionValue += row[6];
      t.clicks += row[7];
      t.impressions += rowImpressions(row);

      if (!creativeMap.has(creative)) {
        creativeMap.set(creative, {
          creative: creative,
          launchDate: store.getLaunchDate(creative),
          spend: 0, purchases: 0, conversionValue: 0, clicks: 0, impressions: 0, cpmSum: 0, cpmCount: 0,
        });
      }
      var cg = creativeMap.get(creative);
      cg.spend += row[4];
      cg.purchases += row[5];
      cg.conversionValue += row[6];
      cg.clicks += row[7];
      cg.impressions += rowImpressions(row);
      accumulateCpmStats(cg, row);

      if (!creativeDayMap.has(creative)) creativeDayMap.set(creative, new Map());
      var cDay = creativeDayMap.get(creative);
      if (!cDay.has(day)) {
        cDay.set(day, { spend: 0, conversionValue: 0, purchases: 0, clicks: 0 });
      }
      var cd = cDay.get(day);
      cd.spend += row[4];
      cd.conversionValue += row[6];
      cd.purchases += row[5];
      cd.clicks += row[7];

      if (!countryMap.has(country)) {
        countryMap.set(country, { country: country, spend: 0, conversionValue: 0, purchases: 0 });
      }
      var co = countryMap.get(country);
      co.spend += row[4];
      co.conversionValue += row[6];
      co.purchases += row[5];

      if (!funnelCountryMap.has(country)) {
        funnelCountryMap.set(country, {
          country: country,
          spend: 0, conversionValue: 0, clicks: 0, impressions: 0,
          landingPageViews: 0, addsToCart: 0,
          checkoutsInitiated: 0, addsPaymentInfo: 0, purchases: 0,
        });
      }
      var fc = funnelCountryMap.get(country);
      fc.spend += row[4];
      fc.conversionValue += row[6];
      fc.clicks += row[7];
      fc.impressions += rowImpressions(row);
      fc.landingPageViews += row[11] || 0;
      fc.addsToCart += row[12] || 0;
      fc.checkoutsInitiated += row[13] || 0;
      fc.addsPaymentInfo += row[14] || 0;
      fc.purchases += row[5];

      if (!funnelDayMap.has(day)) {
        funnelDayMap.set(day, {
          day: day,
          spend: 0,
          conversionValue: 0,
          impressions: 0,
          landingPageViews: 0,
          addsToCart: 0,
          checkoutsInitiated: 0,
          addsPaymentInfo: 0,
          purchases: 0,
          usPurchases: 0,
        });
      }
      var fd = funnelDayMap.get(day);
      fd.spend += row[4];
      fd.conversionValue += row[6];
      fd.impressions += rowImpressions(row);
      fd.landingPageViews += row[11] || 0;
      fd.addsToCart += row[12] || 0;
      fd.checkoutsInitiated += row[13] || 0;
      fd.addsPaymentInfo += row[14] || 0;
      fd.purchases += row[5];
      if (country === 'US') {
        fd.usPurchases += row[5];
      }
    });

    var trendByDay = Array.from(timeMap.values()).sort(function (a, b) {
      return a.date.localeCompare(b.date);
    }).map(function (row) {
      return Object.assign({}, row, {
        roas: row.spend > 0 ? row.conversionValue / row.spend : 0,
        cpa: row.purchases > 0 ? row.spend / row.purchases : 0,
        ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
        cpc: row.clicks > 0 ? row.spend / row.clicks : 0,
      });
    });

    var funnelByDay = Array.from(funnelDayMap.values()).sort(function (a, b) {
      return a.day.localeCompare(b.day);
    }).map(function (d) {
      var funnel = {
        impressions: d.impressions,
        landingPageViews: d.landingPageViews,
        addsToCart: d.addsToCart,
        checkoutsInitiated: d.checkoutsInitiated,
        addsPaymentInfo: d.addsPaymentInfo,
        purchases: d.purchases,
        usPurchases: d.usPurchases,
      };
      return Object.assign({}, d, {
        revenue: d.conversionValue,
        funnelRates: U.buildApplovinFunnelRates(funnel),
        roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
      });
    });

    var funnelCountries = Array.from(funnelCountryMap.values()).map(function (item) {
      var funnelData = {
        impressions: item.impressions,
        landingPageViews: item.landingPageViews,
        addsToCart: item.addsToCart,
        checkoutsInitiated: item.checkoutsInitiated,
        addsPaymentInfo: item.addsPaymentInfo,
        purchases: item.purchases,
        usPurchases: item.country === 'US' ? item.purchases : 0,
        usImpressions: item.country === 'US' ? item.impressions : 0,
      };
      return Object.assign({}, item, {
        revenue: item.conversionValue,
        roas: item.spend > 0 ? item.conversionValue / item.spend : 0,
        funnelRates: U.buildApplovinFunnelRates(funnelData),
        usCpm: item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0,
      });
    }).sort(function (a, b) { return b.spend - a.spend; });

    var countries = Array.from(countryMap.values()).map(function (g) {
      var roas = g.spend > 0 ? g.conversionValue / g.spend : 0;
      return Object.assign({}, g, { roas: roas, roi: roas * 100 });
    });

    return {
      latestDay: latestDay,
      summary: finalizeSummaryState(summaryState, true),
      trendByDay: trendByDay,
      funnelByDay: funnelByDay,
      funnelCountries: funnelCountries,
      countries: countries,
      creatives: finalizeCreativeList(creativeMap, latestDay, store),
      creativeDayMap: creativeDayMap,
    };
  }

  function queryBundleFb(store, f) {
    var summaryState = {
      spend: 0,
      purchases: 0,
      conversionValue: 0,
      clicks: 0,
      impressions: 0,
      landingPageViews: 0,
      addsToCart: 0,
      checkoutsInitiated: 0,
      addsPaymentInfo: 0,
      funnel: {
        clicks: 0, landingPageViews: 0, addsToCart: 0, checkoutsInitiated: 0, addsPaymentInfo: 0, purchases: 0,
        usClicks: 0, usPurchases: 0, usSpend: 0, usImpressions: 0,
      },
    };
    var timeMap = new Map();
    var creativeMap = new Map();
    var creativeDayMap = new Map();
    var countryMap = new Map();
    var accountMap = new Map();
    var funnelDayMap = new Map();
    var latestDay = '';

    eachRow(store, f, function (row) {
      var day = store.days[row[0]];
      var creative = store.creatives[row[3]];
      var accountName = store.accounts[row[1]];
      var country = row[2];
      if (!latestDay || day > latestDay) latestDay = day;

      summaryState.spend += row[4];
      summaryState.purchases += row[5];
      summaryState.conversionValue += row[6];
      summaryState.clicks += row[7];
      summaryState.impressions += rowImpressions(row);
      summaryState.landingPageViews += row[11] || 0;
      summaryState.addsToCart += row[12] || 0;
      summaryState.checkoutsInitiated += row[13] || 0;
      summaryState.addsPaymentInfo += row[14] || 0;
      summaryState.funnel.clicks += row[7];
      summaryState.funnel.landingPageViews += row[11] || 0;
      summaryState.funnel.addsToCart += row[12] || 0;
      summaryState.funnel.checkoutsInitiated += row[13] || 0;
      summaryState.funnel.addsPaymentInfo += row[14] || 0;
      summaryState.funnel.purchases += row[5];
      if (country === 'US') {
        summaryState.funnel.usClicks += row[7];
        summaryState.funnel.usPurchases += row[5];
        summaryState.funnel.usSpend += row[4];
        summaryState.funnel.usImpressions += rowImpressions(row);
      }

      if (!timeMap.has(day)) {
        timeMap.set(day, { date: day, spend: 0, purchases: 0, conversionValue: 0, clicks: 0, impressions: 0 });
      }
      var t = timeMap.get(day);
      t.spend += row[4];
      t.purchases += row[5];
      t.conversionValue += row[6];
      t.clicks += row[7];
      t.impressions += rowImpressions(row);

      if (!creativeMap.has(creative)) {
        creativeMap.set(creative, {
          creative: creative,
          launchDate: store.getLaunchDate(creative),
          spend: 0, purchases: 0, conversionValue: 0, clicks: 0, impressions: 0, cpmSum: 0, cpmCount: 0,
        });
      }
      var cg = creativeMap.get(creative);
      cg.spend += row[4];
      cg.purchases += row[5];
      cg.conversionValue += row[6];
      cg.clicks += row[7];
      cg.impressions += rowImpressions(row);
      accumulateCpmStats(cg, row);

      if (!creativeDayMap.has(creative)) creativeDayMap.set(creative, new Map());
      var cDay = creativeDayMap.get(creative);
      if (!cDay.has(day)) {
        cDay.set(day, { spend: 0, conversionValue: 0, purchases: 0, clicks: 0 });
      }
      var cd = cDay.get(day);
      cd.spend += row[4];
      cd.conversionValue += row[6];
      cd.purchases += row[5];
      cd.clicks += row[7];

      if (!countryMap.has(country)) {
        countryMap.set(country, { country: country, spend: 0, conversionValue: 0, purchases: 0 });
      }
      var co = countryMap.get(country);
      co.spend += row[4];
      co.conversionValue += row[6];
      co.purchases += row[5];

      if (!accountMap.has(accountName)) {
        accountMap.set(accountName, {
          accountName: accountName,
          optimizer: store.getOptimizer(row[1]),
          spend: 0, conversionValue: 0, clicks: 0, landingPageViews: 0, addsToCart: 0,
          checkoutsInitiated: 0, addsPaymentInfo: 0, purchases: 0,
          usClicks: 0, usPurchases: 0, usSpend: 0, usImpressions: 0,
        });
      }
      var acc = accountMap.get(accountName);
      acc.spend += row[4];
      acc.conversionValue += row[6];
      acc.clicks += row[7];
      acc.landingPageViews += row[11] || 0;
      acc.addsToCart += row[12] || 0;
      acc.checkoutsInitiated += row[13] || 0;
      acc.addsPaymentInfo += row[14] || 0;
      acc.purchases += row[5];
      if (country === 'US') {
        acc.usClicks += row[7];
        acc.usPurchases += row[5];
        acc.usSpend += row[4];
        acc.usImpressions += rowImpressions(row);
      }

      if (!funnelDayMap.has(day)) {
        funnelDayMap.set(day, {
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
      var fd = funnelDayMap.get(day);
      fd.spend += row[4];
      fd.conversionValue += row[6];
      fd.clicks += row[7];
      fd.landingPageViews += row[11] || 0;
      fd.addsToCart += row[12] || 0;
      fd.checkoutsInitiated += row[13] || 0;
      fd.addsPaymentInfo += row[14] || 0;
      fd.purchases += row[5];
      if (country === 'US') {
        fd.usClicks += row[7];
        fd.usPurchases += row[5];
      }
    });

    var trendByDay = Array.from(timeMap.values()).sort(function (a, b) {
      return a.date.localeCompare(b.date);
    }).map(function (row) {
      return Object.assign({}, row, {
        roas: row.spend > 0 ? row.conversionValue / row.spend : 0,
        cpa: row.purchases > 0 ? row.spend / row.purchases : 0,
        ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
        cpc: row.clicks > 0 ? row.spend / row.clicks : 0,
      });
    });

    var funnelByDay = Array.from(funnelDayMap.values()).sort(function (a, b) {
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
        funnelRates: U.buildFunnelRates(funnel),
        roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
      });
    });

    var funnelAccounts = Array.from(accountMap.values()).map(function (item) {
      return Object.assign({}, item, {
        revenue: item.conversionValue,
        roas: item.spend > 0 ? item.conversionValue / item.spend : 0,
        funnelRates: U.buildFunnelRates(item),
        usCpm: item.usImpressions > 0 ? (item.usSpend / item.usImpressions) * 1000 : 0,
      });
    }).sort(function (a, b) { return b.spend - a.spend; });

    var countries = Array.from(countryMap.values()).map(function (g) {
      var roas = g.spend > 0 ? g.conversionValue / g.spend : 0;
      return Object.assign({}, g, { roas: roas, roi: roas * 100 });
    });

    return {
      latestDay: latestDay,
      summary: finalizeSummaryState(summaryState, false),
      trendByDay: trendByDay,
      funnelByDay: funnelByDay,
      funnelAccounts: funnelAccounts,
      countries: countries,
      creatives: finalizeCreativeList(creativeMap, latestDay, store),
      creativeDayMap: creativeDayMap,
    };
  }

  function queryBundle(store, f) {
    if (isApplovinStore(store)) return queryBundleApplovin(store, f);
    return queryBundleFb(store, f);
  }

  function summarize(store, f) {
    var spend = 0;
    var purchases = 0;
    var conversionValue = 0;
    var clicks = 0;
    var impressions = 0;
    var funnel = {
      clicks: 0, landingPageViews: 0, addsToCart: 0, checkoutsInitiated: 0, addsPaymentInfo: 0, purchases: 0,
      usClicks: 0, usPurchases: 0, usSpend: 0, usImpressions: 0,
    };

    eachRow(store, f, function (row) {
      spend += row[4];
      purchases += row[5];
      conversionValue += row[6];
      clicks += row[7];
      impressions += rowImpressions(row);
      funnel.clicks += row[7];
      funnel.landingPageViews += row[11] || 0;
      funnel.addsToCart += row[12] || 0;
      funnel.checkoutsInitiated += row[13] || 0;
      funnel.addsPaymentInfo += row[14] || 0;
      funnel.purchases += row[5];
      if (row[2] === 'US') {
        funnel.usClicks += row[7];
        funnel.usPurchases += row[5];
        funnel.usSpend += row[4];
        funnel.usImpressions += rowImpressions(row);
      }
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
      landingPageViews: funnel.landingPageViews,
      addsToCart: funnel.addsToCart,
      checkoutsInitiated: funnel.checkoutsInitiated,
      addsPaymentInfo: funnel.addsPaymentInfo,
    }, funnel, {
      funnelRates: U.buildFunnelRates(funnel),
      usCpm: funnel.usImpressions > 0 ? (funnel.usSpend / funnel.usImpressions) * 1000 : 0,
    });
  }

  function aggregateByTime(store, f, granularity) {
    var map = new Map();
    eachRow(store, f, function (row) {
      var raw = store.days[row[0]];
      var key = granularity === 'week' ? U.getWeekKey(raw) : granularity === 'month' ? U.getMonthKey(raw) : raw;
      if (!key) return;
      if (!map.has(key)) map.set(key, { date: key, spend: 0, purchases: 0, conversionValue: 0, clicks: 0, impressions: 0 });
      var agg = map.get(key);
      agg.spend += row[4];
      agg.purchases += row[5];
      agg.conversionValue += row[6];
      agg.clicks += row[7];
      agg.impressions += rowImpressions(row);
    });
    return Array.from(map.values()).sort(function (a, b) { return a.date.localeCompare(b.date); }).map(function (row) {
      return Object.assign({}, row, {
        roas: row.spend > 0 ? row.conversionValue / row.spend : 0,
        cpa: row.purchases > 0 ? row.spend / row.purchases : 0,
        ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
        cpc: row.clicks > 0 ? row.spend / row.clicks : 0,
      });
    });
  }

  function groupByCreative(store, f, latestDay) {
    var map = new Map();
    eachRow(store, f, function (row) {
      var creative = store.creatives[row[3]];
      if (!map.has(creative)) {
        map.set(creative, {
          creative: creative,
          launchDate: store.getLaunchDate(creative),
          spend: 0, purchases: 0, conversionValue: 0, clicks: 0, impressions: 0, cpmSum: 0, cpmCount: 0,
        });
      }
      var g = map.get(creative);
      g.spend += row[4];
      g.purchases += row[5];
      g.conversionValue += row[6];
      g.clicks += row[7];
      g.impressions += rowImpressions(row);
      accumulateCpmStats(g, row);
    });
    return Array.from(map.values()).map(function (g) {
      return Object.assign({}, g, {
        roas: g.spend > 0 ? g.conversionValue / g.spend : 0,
        cpa: g.purchases > 0 ? g.spend / g.purchases : 0,
        ctr: g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0,
        cpc: g.clicks > 0 ? g.spend / g.clicks : 0,
        cpm: g.impressions > 0 ? (g.spend / g.impressions) * 1000 : g.cpmCount > 0 ? g.cpmSum / g.cpmCount : 0,
        daysLive: U.daysBetween(g.launchDate, latestDay || g.launchDate),
      });
    });
  }

  function groupByCountry(store, f) {
    var map = new Map();
    eachRow(store, f, function (row) {
      var country = row[2];
      if (!map.has(country)) {
        map.set(country, { country: country, spend: 0, conversionValue: 0, purchases: 0 });
      }
      var g = map.get(country);
      g.spend += row[4];
      g.conversionValue += row[6];
      g.purchases += row[5];
    });
    return Array.from(map.values()).map(function (g) {
      var roas = g.spend > 0 ? g.conversionValue / g.spend : 0;
      return Object.assign({}, g, { roas: roas, roi: roas * 100 });
    });
  }

  function aggregateFunnelByDay(store, f, accountName) {
    var map = new Map();
    eachRow(store, f, function (row) {
      if (accountName && store.accounts[row[1]] !== accountName) return;
      var day = store.days[row[0]];
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
      d.spend += row[4];
      d.conversionValue += row[6];
      d.clicks += row[7];
      d.landingPageViews += row[11] || 0;
      d.addsToCart += row[12] || 0;
      d.checkoutsInitiated += row[13] || 0;
      d.addsPaymentInfo += row[14] || 0;
      d.purchases += row[5];
      if (row[2] === 'US') {
        d.usClicks += row[7];
        d.usPurchases += row[5];
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
        funnelRates: U.buildFunnelRates(funnel),
        roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
      });
    });
  }

  function groupFunnelByAccount(store, f) {
    var map = new Map();
    eachRow(store, f, function (row) {
      var accountName = store.accounts[row[1]];
      if (!map.has(accountName)) {
        map.set(accountName, {
          accountName: accountName,
          optimizer: store.getOptimizer(row[1]),
          spend: 0, conversionValue: 0, clicks: 0, landingPageViews: 0, addsToCart: 0, checkoutsInitiated: 0, addsPaymentInfo: 0, purchases: 0,
          usClicks: 0, usPurchases: 0, usSpend: 0, usImpressions: 0,
        });
      }
      var item = map.get(accountName);
      item.spend += row[4];
      item.conversionValue += row[6];
      item.clicks += row[7];
      item.landingPageViews += row[11] || 0;
      item.addsToCart += row[12] || 0;
      item.checkoutsInitiated += row[13] || 0;
      item.addsPaymentInfo += row[14] || 0;
      item.purchases += row[5];
      if (row[2] === 'US') {
        item.usClicks += row[7];
        item.usPurchases += row[5];
        item.usSpend += row[4];
        item.usImpressions += rowImpressions(row);
      }
    });
    return Array.from(map.values()).map(function (item) {
      return Object.assign({}, item, {
        revenue: item.conversionValue,
        roas: item.spend > 0 ? item.conversionValue / item.spend : 0,
        funnelRates: U.buildFunnelRates(item),
        usCpm: item.usImpressions > 0 ? (item.usSpend / item.usImpressions) * 1000 : 0,
      });
    }).sort(function (a, b) { return b.spend - a.spend; });
  }

  function getCountryDailySeries(store, country, f) {
    var map = new Map();
    eachRow(store, f, function (row) {
      if (row[2] !== country) return;
      var day = store.days[row[0]];
      if (!map.has(day)) map.set(day, { day: day, spend: 0, conversionValue: 0, d7ConversionValue: 0, purchases: 0 });
      var d = map.get(day);
      d.spend += row[4];
      d.conversionValue += row[6];
      d.d7ConversionValue += row[15] || 0;
      d.purchases += row[5];
    });
    return Array.from(map.values()).sort(function (a, b) { return a.day.localeCompare(b.day); }).map(function (d) {
      return Object.assign({}, d, {
        roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
        d7Roas: d.spend > 0 ? (d.d7ConversionValue || 0) / d.spend : 0,
      });
    });
  }

  function getCreativeDailySeries(store, creative, f) {
    var dayMap = store.creativeDayMap && store.creativeDayMap.get(creative);
    if (dayMap) {
      return filterDayMapEntries(dayMap, f).sort(function (a, b) {
        return a[0].localeCompare(b[0]);
      }).map(function (entry) {
        var d = entry[1];
        return {
          day: entry[0],
          spend: d.spend,
          conversionValue: d.conversionValue,
          purchases: d.purchases,
          roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
        };
      });
    }
    var map = new Map();
    eachRow(store, f, function (row) {
      if (store.creatives[row[3]] !== creative) return;
      var day = store.days[row[0]];
      if (!map.has(day)) map.set(day, { day: day, spend: 0, conversionValue: 0, purchases: 0 });
      var d = map.get(day);
      d.spend += row[4];
      d.conversionValue += row[6];
      d.purchases += row[5];
    });
    return Array.from(map.values()).sort(function (a, b) { return a.day.localeCompare(b.day); }).map(function (d) {
      return Object.assign({}, d, { roas: d.spend > 0 ? d.conversionValue / d.spend : 0 });
    });
  }

  function seriesFromDayMap(dayMap) {
    if (!dayMap) return [];
    return Array.from(dayMap.entries()).sort(function (a, b) {
      return a[0].localeCompare(b[0]);
    }).map(function (entry) {
      var d = entry[1];
      return {
        day: entry[0],
        spend: d.spend,
        conversionValue: d.conversionValue,
        purchases: d.purchases,
        roas: d.spend > 0 ? d.conversionValue / d.spend : 0,
      };
    });
  }

  function hasLastNDaysLowRoas(dayMap, referenceDay, n, threshold) {
    threshold = threshold === undefined ? 0.25 : threshold;
    if (!dayMap || !referenceDay) return false;
    var dayList = U.buildLastNDays(referenceDay, n);
    if (dayList.length < n) return false;
    for (var i = 0; i < dayList.length; i++) {
      var rec = dayMap.get(dayList[i]);
      if (!rec || rec.spend <= 0) return false;
      var roas = rec.spend > 0 ? rec.conversionValue / rec.spend : 0;
      if (roas >= threshold) return false;
    }
    return true;
  }

  function isDeclineCreative(creativeStats, dayMap, referenceDay) {
    if (!creativeStats || creativeStats.spend <= 500) return false;
    if (creativeStats.roas >= 0.3) return false;
    return hasLastNDaysLowRoas(dayMap, referenceDay, 3, 0.25);
  }

  function hasConsecutiveLowRoasSeries(series, threshold) {
    var withSpend = series.filter(function (d) { return d.spend > 0; });
    if (withSpend.length < 3) return false;
    for (var i = 0; i <= withSpend.length - 3; i++) {
      if (U.daysBetween(withSpend[i].day, withSpend[i + 1].day) !== 1) continue;
      if (U.daysBetween(withSpend[i + 1].day, withSpend[i + 2].day) !== 1) continue;
      if (withSpend[i].roas < threshold && withSpend[i + 1].roas < threshold && withSpend[i + 2].roas < threshold) return true;
    }
    return false;
  }

  function hasConsecutiveLowRoas(store, creative, f, threshold) {
    var series = getCreativeDailySeries(store, creative, f).filter(function (d) { return d.spend > 0; });
    return hasConsecutiveLowRoasSeries(series, threshold);
  }

  function classifyLifecycle(store, creatives, f) {
    var latestDay = getLatestDay(store, f);
    return classifyLifecycleFromBundle(creatives, queryBundle(store, f).creativeDayMap, latestDay);
  }

  function classifyLifecycleFromBundle(creatives, creativeDayMap, referenceDay) {
    return creatives.map(function (c) {
      var phase = 'growth';
      if (c.spend < 100) phase = 'test';
      else if (isDeclineCreative(c, creativeDayMap.get(c.creative), referenceDay)) phase = 'decline';
      else if (c.spend > 500) phase = 'scale';
      return Object.assign({}, c, {
        phase: phase,
        phaseLabel: U.PHASE_LABELS[phase],
        isDecline: phase === 'decline',
      });
    });
  }

  function getCreativeFirstSeenDay(creativeDayMap, creative) {
    var dayMap = creativeDayMap && creativeDayMap.get(creative);
    if (!dayMap || !dayMap.size) return '';
    var days = Array.from(dayMap.entries())
      .filter(function (entry) { return entry[1].spend > 0; })
      .map(function (entry) { return entry[0]; })
      .sort();
    return days.length ? days[0] : '';
  }

  function attachRampDays(creatives, creativeDayMap, referenceDay) {
    if (!creativeDayMap) return creatives;
    return creatives.map(function (c) {
      var firstSeen = getCreativeFirstSeenDay(creativeDayMap, c.creative);
      var rampDays = firstSeen && referenceDay ? U.daysBetween(firstSeen, referenceDay) + 1 : 0;
      return Object.assign({}, c, {
        firstSeenDay: firstSeen,
        rampDays: rampDays,
      });
    });
  }

  function buildLifecycleDisplay(periodBundle, creativeDayMap, referenceDay, phaseReferenceDay) {
    if (!periodBundle || !creativeDayMap) return [];
    var phaseDay = phaseReferenceDay || referenceDay || '';

    return periodBundle.creatives.map(function (period) {
      var dayMap = creativeDayMap.get(period.creative);
      var allTimeStats = summarizeCreativeDayMap(dayMap);
      var phaseInfo = classifyLifecycleFromBundle([{
        creative: period.creative,
        spend: allTimeStats.spend,
        roas: allTimeStats.roas,
      }], creativeDayMap, phaseDay)[0] || {
        phase: 'growth',
        phaseLabel: U.PHASE_LABELS.growth,
        isDecline: false,
      };
      var firstSeen = getCreativeFirstSeenDay(creativeDayMap, period.creative);
      var rampDays = firstSeen && referenceDay ? U.daysBetween(firstSeen, referenceDay) + 1 : 0;
      return Object.assign({}, period, {
        phase: phaseInfo.phase,
        phaseLabel: phaseInfo.phaseLabel,
        isDecline: phaseInfo.isDecline,
        firstSeenDay: firstSeen,
        rampDays: rampDays,
      });
    });
  }

  function findRisingFromDayMap(creativeDayMap, latestDay, windowDays, minRoas) {
    if (!latestDay) return [];
    var dayList = U.buildLastNDays(latestDay, windowDays);
    var results = [];

    creativeDayMap.forEach(function (dayMap, creative) {
      var spend = 0;
      var conversionValue = 0;
      var purchases = 0;
      var clicks = 0;
      var spends = dayList.map(function (d) {
        var rec = dayMap.get(d);
        if (!rec) return 0;
        spend += rec.spend;
        conversionValue += rec.conversionValue;
        purchases += rec.purchases;
        clicks += rec.clicks;
        return rec.spend;
      });
      var totalSpend = spend;
      var roas = spend > 0 ? conversionValue / spend : 0;
      if (totalSpend <= 1000) return;
      if (minRoas > 0 && roas <= minRoas) return;
      results.push({
        creative: creative,
        dayList: dayList,
        dailySpends: spends,
        windowDays: windowDays,
        yesterdaySpend: spends[spends.length - 1],
        totalSpend: totalSpend,
        totalSpend7d: totalSpend,
        roas: roas,
        purchases: purchases,
        cpa: purchases > 0 ? spend / purchases : 0,
        payRate: clicks > 0 ? purchases / clicks : 0,
      });
    });
    return results.sort(function (a, b) { return b.totalSpend - a.totalSpend; });
  }

  function findRisingForWindow(store, f, latestDay, windowDays, minRoas) {
    if (!latestDay) return [];
    var dayList = U.buildLastNDays(latestDay, windowDays);
    var daySet = new Set(dayList);
    var byCreative = new Map();

    eachRow(store, f, function (row) {
      var day = store.days[row[0]];
      if (!daySet.has(day)) return;
      var creative = store.creatives[row[3]];
      if (!byCreative.has(creative)) {
        byCreative.set(creative, {
          creative: creative,
          daySpend: {},
          spend: 0,
          conversionValue: 0,
          purchases: 0,
          clicks: 0,
        });
      }
      var item = byCreative.get(creative);
      item.daySpend[day] = (item.daySpend[day] || 0) + row[4];
      item.spend += row[4];
      item.conversionValue += row[6];
      item.purchases += row[5];
      item.clicks += row[7];
    });

    var results = [];
    byCreative.forEach(function (item) {
      var spends = dayList.map(function (d) { return item.daySpend[d] || 0; });
      var totalSpend = spends.reduce(function (s, v) { return s + v; }, 0);
      var roas = item.spend > 0 ? item.conversionValue / item.spend : 0;
      if (totalSpend <= 1000) return;
      if (minRoas > 0 && roas <= minRoas) return;
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

  function findRisingCreatives(store, f, latestDay, windowDays) {
    windowDays = windowDays || 7;
    var minRoas = isApplovinStore(store) ? 0 : 0.3;
    var items = findRisingForWindow(store, f, latestDay, windowDays, minRoas);
    return { windowDays: windowDays, items: items };
  }

  function findRisingFromBundle(creativeDayMap, latestDay, windowDays, minRoas) {
    windowDays = windowDays || 7;
    if (minRoas === undefined) minRoas = 0.3;
    return {
      windowDays: windowDays,
      items: findRisingFromDayMap(creativeDayMap, latestDay, windowDays, minRoas),
    };
  }

  function createDataStore(data) {
    if (!data || !data.meta) return null;

    var platform = data.meta.platform || 'fb';
    var meta = Object.assign({}, data.meta, { platform: platform });
    if (platform !== 'applovin') {
      meta.optimizers = U.OPTIMIZER_NAMES;
    }

    if (!data.meta.compact) {
      return {
        compact: false,
        meta: meta,
        summarize: function (f) { return U.summarizeRecords(filterLegacy(data.records, f)); },
        aggregateByTime: function (f, g) { return U.aggregateByTime(filterLegacy(data.records, f), g); },
        groupByCreative: function (f, ld) { return U.groupByCreative(filterLegacy(data.records, f), ld); },
        groupFunnelByAccount: function (f) { return U.groupFunnelByAccount(filterLegacy(data.records, f)); },
        aggregateFunnelByDay: function (f, accountName) {
          return U.aggregateFunnelByDay(filterLegacy(data.records, f), accountName);
        },
        groupByCountry: function (f) { return U.groupByCountry(filterLegacy(data.records, f)); },
        getCreativeDailySeries: function (c, f) { return U.getCreativeDailySeries(filterLegacy(data.records, f), c); },
        classifyLifecycle: function (items, f) { return U.classifyLifecycle(items, filterLegacy(data.records, f)); },
        findRisingCreatives: function (f, ld, windowDays) {
          windowDays = windowDays || 7;
          var items = U.findRisingCreatives(filterLegacy(data.records, f), ld, windowDays);
          return { windowDays: windowDays, items: items };
        },
        getLatestDay: function (f) { return getLatestDayFromRecords(filterLegacy(data.records, f)); },
      };
    }

    var rowIndexes = buildRowIndexes(data);
    var store = {
      compact: true,
      platform: platform,
      meta: meta,
      days: data.days,
      accounts: data.accounts,
      creatives: data.creatives,
      rows: data.rows,
      dataLatestDay: data.days.length ? data.days[data.days.length - 1] : '',
      rowsByDay: rowIndexes.rowsByDay,
      creativeDayMap: rowIndexes.creativeDayMap,
      optCache: {},
      launchCache: {},
      getOptimizer: function (accIdx) {
        if (platform === 'applovin') return '—';
        if (!store.optCache[accIdx]) store.optCache[accIdx] = U.parseOptimizerFromAccount(store.accounts[accIdx]);
        return store.optCache[accIdx];
      },
      getLaunchDate: function (creative) {
        if (!store.launchCache[creative]) store.launchCache[creative] = U.parseLaunchFromCreative(creative);
        return store.launchCache[creative];
      },
      queryBundle: function (f) { return queryBundle(store, f); },
      rollupTimeSeries: rollupTimeSeries,
      classifyLifecycleFromBundle: classifyLifecycleFromBundle,
      buildLifecycleDisplay: buildLifecycleDisplay,
      attachRampDays: attachRampDays,
      findRisingFromBundle: function (creativeDayMap, latestDay, windowDays) {
        var minRoas = isApplovinStore(store) ? 0 : 0.3;
        return findRisingFromBundle(creativeDayMap, latestDay, windowDays, minRoas);
      },
      summarize: function (f) { return queryBundle(store, f).summary; },
      aggregateByTime: function (f, g) {
        return rollupTimeSeries(queryBundle(store, f).trendByDay, g);
      },
      groupByCreative: function (f, ld) {
        var bundle = queryBundle(store, f);
        if (!ld || ld === bundle.latestDay) return bundle.creatives;
        return finalizeCreativeList(
          new Map(bundle.creatives.map(function (c) { return [c.creative, c]; })),
          ld,
          store
        );
      },
      groupFunnelByAccount: function (f) {
        var bundle = queryBundle(store, f);
        return isApplovinStore(store) ? bundle.funnelCountries : bundle.funnelAccounts;
      },
      aggregateFunnelByDay: function (f) { return queryBundle(store, f).funnelByDay; },
      groupByCountry: function (f) { return queryBundle(store, f).countries; },
      getCreativeDailySeries: function (c, f) { return getCreativeDailySeries(store, c, f); },
      getCountryDailySeries: function (c, f) { return getCountryDailySeries(store, c, f); },
      classifyLifecycle: function (items, f) {
        var bundle = queryBundle(store, f);
        return classifyLifecycleFromBundle(items, bundle.creativeDayMap, bundle.latestDay);
      },
      findRisingCreatives: function (f, ld, windowDays) {
        var bundle = queryBundle(store, f);
        var minRoas = isApplovinStore(store) ? 0 : 0.3;
        return findRisingFromBundle(bundle.creativeDayMap, ld || bundle.latestDay, windowDays, minRoas);
      },
      getLatestDay: function (f) { return queryBundle(store, f).latestDay; },
    };
    var bundleCache = createBundleCache(16);
    var allTimeFilter = { optimizer: '', accounts: [], countries: [] };
    var allTimeKey = filterKey(allTimeFilter);
    var allTimeBundleLazy = null;

    function ensureAllTimeBundle() {
      if (!allTimeBundleLazy) {
        if (store.creativeDayMap) {
          allTimeBundleLazy = queryBundle(store, allTimeFilter);
          allTimeBundleLazy.creativeDayMap = store.creativeDayMap;
        } else {
          allTimeBundleLazy = queryBundle(store, allTimeFilter);
        }
        bundleCache.seed(allTimeKey, allTimeBundleLazy);
      }
      return allTimeBundleLazy;
    }

    Object.defineProperty(store, 'allTimeBundle', {
      get: function () { return ensureAllTimeBundle(); },
      enumerable: true,
      configurable: true,
    });
    store.clearBundleCache = function () {
      bundleCache.clear();
      allTimeBundleLazy = null;
    };
    store.queryBundle = function (f) {
      return bundleCache.get(filterKey(f), function () {
        return queryBundle(store, f);
      });
    };
    return store;
  }

  function filterLegacy(records, f) {
    return records.filter(function (r) {
      var day = U.toIsoDate(r.day);
      if (f.dateStart && day < f.dateStart) return false;
      if (f.dateEnd && day > f.dateEnd) return false;
      if (f.optimizers && f.optimizers.length) {
        if (f.optimizers.indexOf(r.optimizer) < 0) return false;
      } else if (f.optimizer && r.optimizer !== f.optimizer) return false;
      if (f.accounts && f.accounts.length && f.accounts.indexOf(r.accountName) < 0) return false;
      if (f.countries && f.countries.length && f.countries.indexOf(r.country) < 0) return false;
      return true;
    });
  }

  function getLatestDayFromRecords(records) {
    var latest = '';
    records.forEach(function (r) {
      var day = U.toIsoDate(r.day);
      if (!latest || day > latest) latest = day;
    });
    return latest;
  }

  global.createDataStore = createDataStore;
})(window);
