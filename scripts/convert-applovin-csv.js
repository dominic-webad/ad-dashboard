#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { writeMonthlyOutput, loadExistingForIncremental } = require('./lib/monthly-output');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = ROOT;
const OUT_DIR = path.join(ROOT, 'public', 'applovin');

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}

function parseMoney(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseFloat(String(v).replace(/[$,\s"]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseIntSafe(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseInt(String(v).replace(/[,"]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseCountry(raw) {
  if (!raw) return '未知';
  const m = String(raw).match(/\(([A-Z]{2})\)\s*$/);
  if (m) return m[1];
  return String(raw).trim();
}

function parseCreative(creativeName) {
  if (!creativeName) return { creative: '', launchDate: null };
  const base = String(creativeName).trim();
  const parts = base.split('_');
  const launchDate = /^\d{8}$/.test(parts[0])
    ? parts[0].slice(0, 4) + '-' + parts[0].slice(4, 6) + '-' + parts[0].slice(6, 8)
    : null;
  return { creative: base, launchDate: launchDate };
}

function normalizeDay(day) {
  if (!day) return '';
  const str = String(day).trim().replace(/^"|"$/g, '');
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : str;
}

function findCsvFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(function (f) { return /^report_.*\.csv$/i.test(f) && !f.startsWith('.'); })
    .map(function (f) { return path.join(dir, f); })
    .sort();
}

function readCsvRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (!lines.length) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]).map(function (h) { return h.trim(); });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (!cols.some(Boolean)) continue;
    const obj = {};
    headers.forEach(function (h, idx) {
      obj[h] = cols[idx] !== undefined ? cols[idx].trim() : '';
    });
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function pickField(obj, names) {
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== '') return obj[name];
  }
  return '';
}

function mergeRowsIntoAggMap(rows, aggMap) {
  let merged = 0;
  for (const obj of rows) {
    const day = normalizeDay(pickField(obj, ['Date', 'Day']));
    const creativeName = pickField(obj, ['Creative set name', 'Creative Set Name']);
    const countryRaw = pickField(obj, ['Country / Region', 'Country']);
    if (!day || !creativeName) continue;

    const country = parseCountry(countryRaw);
    const creative = parseCreative(creativeName).creative;
    const key = [day, creative, country].join('\0');

    if (!aggMap.has(key)) {
      aggMap.set(key, {
        day: day,
        accountName: creative,
        country: country,
        creative: creative,
        spend: 0,
        purchases: 0,
        conversionValue: 0,
        d7ConversionValue: 0,
        clicks: 0,
        impressions: 0,
        cpmSum: 0,
        cpmCount: 0,
        cpcSum: 0,
        cpcCount: 0,
        landingPageViews: 0,
        addsToCart: 0,
        checkoutsInitiated: 0,
      });
    }

    const rec = aggMap.get(key);
    const spend = parseMoney(pickField(obj, ['Spend']));
    const impressions = parseIntSafe(pickField(obj, ['Impressions']));
    const cpm = parseMoney(pickField(obj, ['CPM']));
    const cpc = parseMoney(pickField(obj, ['CPC']));
    const clicks = cpc > 0 ? Math.round(spend / cpc) : 0;

    rec.spend += spend;
    rec.purchases += parseIntSafe(pickField(obj, ['D0 checkouts', 'D0 Checkouts']));
    rec.conversionValue += parseMoney(pickField(obj, ['D0 checkout rev', 'D0 Checkout Rev']));
    rec.d7ConversionValue += parseMoney(pickField(obj, ['D7 checkout rev', 'D7 Checkout Rev']));
    rec.impressions += impressions;
    rec.clicks += clicks;
    rec.landingPageViews += parseIntSafe(pickField(obj, ['View product', 'View Product']));
    rec.addsToCart += parseIntSafe(pickField(obj, ['Add to cart', 'Add To Cart']));
    rec.checkoutsInitiated += parseIntSafe(pickField(obj, ['Initiate checkout', 'Initiate Checkout']));
    if (cpm > 0) {
      rec.cpmSum += cpm;
      rec.cpmCount += 1;
    }
    if (cpc > 0) {
      rec.cpcSum += cpc;
      rec.cpcCount += 1;
    }
    merged += 1;
  }
  return merged;
}

function loadAggMapFromExisting(existingData) {
  const aggMap = new Map();
  if (!existingData || !Array.isArray(existingData.rows)) return aggMap;

  const days = existingData.days;
  const accounts = existingData.accounts;
  const creatives = existingData.creatives;
  const rows = existingData.rows;

  for (const row of rows) {
    const day = days[row[0]];
    const accountName = accounts[row[1]];
    const country = row[2];
    const creative = creatives[row[3]];
    if (!day || !accountName || !creative) continue;

    const key = [day, accountName, country].join('\0');
    aggMap.set(key, {
      day: day,
      accountName: accountName,
      country: country,
      creative: creative,
      spend: row[4] || 0,
      purchases: row[5] || 0,
      conversionValue: row[6] || 0,
      d7ConversionValue: row[15] || 0,
      clicks: row[7] || 0,
      impressions: row[10] || 0,
      cpmSum: row[16] || 0,
      cpmCount: row[16] > 0 ? 1 : 0,
      cpcSum: row[9] || 0,
      cpcCount: row[9] > 0 ? 1 : 0,
      landingPageViews: row[11] || 0,
      addsToCart: row[12] || 0,
      checkoutsInitiated: row[13] || 0,
    });
  }
  return aggMap;
}

function buildOutput(aggMap, sourceFiles) {
  const dayList = [...new Set([...aggMap.values()].map(function (r) { return r.day; }))].sort();
  const dayMap = new Map(dayList.map(function (d, i) { return [d, i]; }));
  const accountList = [...new Set([...aggMap.values()].map(function (r) { return r.accountName; }))].sort();
  const accountMap = new Map(accountList.map(function (a, i) { return [a, i]; }));
  const creativeList = [...new Set([...aggMap.values()].map(function (r) { return r.creative; }))].sort();
  const creativeMap = new Map(creativeList.map(function (c, i) { return [c, i]; }));

  const compactRows = [];
  for (const r of aggMap.values()) {
    const spend = +r.spend.toFixed(2);
    const purchases = r.purchases;
    const conversionValue = +r.conversionValue.toFixed(2);
    const d7ConversionValue = +r.d7ConversionValue.toFixed(2);
    const clicks = r.clicks;
    const impressions = r.impressions;
    const ctr = impressions > 0 ? +((clicks / impressions) * 100).toFixed(4) : 0;
    const cpc = r.cpcCount > 0
      ? +(r.cpcSum / r.cpcCount).toFixed(4)
      : clicks > 0 ? +(spend / clicks).toFixed(4) : 0;
    const cpm = r.cpmCount > 0
      ? +(r.cpmSum / r.cpmCount).toFixed(4)
      : impressions > 0 ? +((spend / impressions) * 1000).toFixed(4) : 0;

    compactRows.push([
      dayMap.get(r.day),
      accountMap.get(r.accountName),
      r.country,
      creativeMap.get(r.creative),
      spend,
      purchases,
      conversionValue,
      clicks,
      ctr,
      cpc,
      impressions,
      r.landingPageViews,
      r.addsToCart,
      r.checkoutsInitiated,
      0,
      d7ConversionValue,
      cpm,
    ]);
  }

  const countries = [...new Set(compactRows.map(function (r) { return r[2]; }))].sort();

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      totalRecords: compactRows.length,
      sourceFiles: sourceFiles,
      dateRange: { min: dayList[0] || '', max: dayList[dayList.length - 1] || '' },
      platform: 'applovin',
      accounts: accountList,
      countries: countries,
      compact: true,
    },
    days: dayList,
    accounts: accountList,
    creatives: creativeList,
    rows: compactRows,
  };
}

function main() {
  const forceFull = process.argv.includes('--full');
  const allCsvFiles = findCsvFiles(DATA_DIR);
  const existingState = forceFull ? null : loadExistingForIncremental(OUT_DIR, loadAggMapFromExisting);

  let filesToProcess;
  let sourceFiles;
  let aggMap;

  if (forceFull || !existingState || !existingState.manifest) {
    if (!allCsvFiles.length) {
      console.error('未在项目根目录找到 report_*.csv 文件');
      process.exit(1);
    }
    filesToProcess = allCsvFiles;
    sourceFiles = allCsvFiles.map(function (f) { return path.basename(f); });
    aggMap = new Map();
    console.log(forceFull ? '全量重建模式 (--full)' : '首次转换');
  } else {
    const processed = new Set(existingState.manifest.sourceFiles || []);
    filesToProcess = allCsvFiles.filter(function (f) {
      return !processed.has(path.basename(f));
    });
    sourceFiles = (existingState.manifest.sourceFiles || []).slice();

    if (!filesToProcess.length) {
      console.log('没有新的 CSV 文件，数据未变更');
      console.log('已收录 ' + sourceFiles.length + ' 个文件');
      process.exit(0);
    }

    aggMap = existingState.aggMap;
    filesToProcess.forEach(function (f) {
      sourceFiles.push(path.basename(f));
    });
    console.log('增量更新: 已有 ' + aggMap.size + ' 条，新增 ' + filesToProcess.length + ' 个 CSV');
  }

  console.log('处理 ' + filesToProcess.length + ' 个 CSV 文件:');
  for (const filePath of filesToProcess) {
    const fileName = path.basename(filePath);
    const rows = readCsvRows(filePath).rows;
    const count = mergeRowsIntoAggMap(rows, aggMap);
    console.log('  合并 ' + fileName + ': ' + count + ' 行有效数据');
  }

  const output = buildOutput(aggMap, sourceFiles);
  writeMonthlyOutput(OUT_DIR, 'applovin', output, sourceFiles);
  console.log('日期范围: ' + output.meta.dateRange.min + ' ~ ' + output.meta.dateRange.max);
}

main();
