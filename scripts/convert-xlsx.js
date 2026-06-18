#!/usr/bin/env node
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const { writeMonthlyOutput, loadExistingForIncremental } = require('./lib/monthly-output');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = ROOT;
const OUT_DIR = path.join(ROOT, 'public', 'fb');
const TMP_ROOT = '/tmp/xlsx_convert';
const OPTIMIZERS = ['Alina', 'Barry', 'Dom', 'Creative', 'Angie'];

function colToIndex(col) {
  let idx = 0;
  for (let i = 0; i < col.length; i++) {
    idx = idx * 26 + (col.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function parseCreative(adName) {
  if (!adName || typeof adName !== 'string') {
    return { creative: adName || '', launchDate: null };
  }
  const base = adName.replace(/\s*-\s*Copy.*$/i, '').trim();
  const parts = base.split('_');
  const launchDate = /^\d{8}$/.test(parts[0])
    ? parts[0].slice(0, 4) + '-' + parts[0].slice(4, 6) + '-' + parts[0].slice(6, 8)
    : null;
  return { creative: base, launchDate };
}

function parseOptimizer(accountName) {
  const lower = (accountName || '').toLowerCase();
  if (lower.includes('creative')) return 'Creative';
  if (lower.includes('barry')) return 'Barry';
  if (lower.includes('angie')) return 'Angie';
  if (lower.includes('dom')) return 'Dom';
  if (lower.includes('alina')) return 'Alina';
  return '其他';
}

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDay(day) {
  if (!day) return '';
  const str = String(day).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const serial = parseFloat(str);
  if (Number.isFinite(serial) && serial > 30000 && serial < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return str;
}

function pickField(obj, names) {
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== '') return obj[name];
  }
  return '';
}

function findExcelFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(function (f) {
      return /^Untitled-report_\d{4}\.xlsx$/i.test(f) && !f.startsWith('~$');
    })
    .map(function (f) { return path.join(dir, f); })
    .sort();
}

function readXlsx(filePath) {
  const safeName = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpDir = path.join(TMP_ROOT, safeName);
  fs.mkdirSync(tmpDir, { recursive: true });
  execSync('unzip -o "' + filePath + '" -d "' + tmpDir + '"', { stdio: 'pipe' });

  const sharedXml = fs.readFileSync(path.join(tmpDir, 'xl/sharedStrings.xml'), 'utf8');
  const strings = [];
  const siBlocks = sharedXml.match(/<si>[\s\S]*?<\/si>/g) || [];
  for (const block of siBlocks) {
    if (block.includes('<r>')) {
      const texts = [...block.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(function (m) { return m[1]; });
      strings.push(texts.join(''));
    } else {
      const m = block.match(/<t[^>]*>([^<]*)<\/t>/);
      strings.push(m ? m[1] : '');
    }
  }

  const sheetXml = fs.readFileSync(path.join(tmpDir, 'xl/worksheets/sheet1.xml'), 'utf8');
  const rowBlocks = sheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
  const allRows = [];

  for (const rowBlock of rowBlocks) {
    const cellBlocks = rowBlock.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) || [];
    const row = [];
    for (const cell of cellBlocks) {
      const ref = cell.match(/r="([A-Z]+)(\d+)"/);
      if (!ref) continue;
      const colIdx = colToIndex(ref[1]);
      let val = '';
      const vMatch = cell.match(/<v>([^<]*)<\/v>/);
      if (vMatch) {
        val = vMatch[1];
        if (cell.includes('t="s"')) val = strings[parseInt(val, 10)] ?? '';
      }
      row[colIdx] = val;
    }
    allRows.push(row);
  }

  return allRows;
}

function mergeRowsIntoAggMap(rows, aggMap) {
  if (!rows.length) return 0;
  const headers = rows[0].map(function (h) { return (h || '').trim(); });
  let merged = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some(Boolean)) continue;

    const obj = {};
    headers.forEach(function (h, idx) {
      obj[h] = row[idx] ?? '';
    });

    const day = normalizeDay(obj.Day);
    const accountName = pickField(obj, ['Account name', 'Account Name', 'Account']);
    const country = pickField(obj, ['Country', '国家']) || '未知';
    const adName = pickField(obj, ['Ad name', 'Ad Name', 'Ad']);
    if (!day || !adName || !accountName) continue;

    const creative = parseCreative(adName).creative;
    const key = [day, accountName, country, creative].join('\0');

    if (!aggMap.has(key)) {
      aggMap.set(key, {
        day: day,
        accountName: accountName,
        country: country,
        creative: creative,
        spend: 0,
        purchases: 0,
        conversionValue: 0,
        clicks: 0,
        landingPageViews: 0,
        addsToCart: 0,
        checkoutsInitiated: 0,
        addsPaymentInfo: 0,
        ctrSum: 0,
        ctrCount: 0,
        cpcSum: 0,
        cpcCount: 0,
      });
    }

    const rec = aggMap.get(key);
    const spend = toNum(pickField(obj, ['Amount spent (USD)', 'Amount spent', 'Spend']));
    const clicks = toNum(pickField(obj, ['Clicks (all)', 'Clicks', 'Link clicks']));
    const ctr = toNum(pickField(obj, ['CTR (all)', 'CTR']));
    const cpc = toNum(pickField(obj, [
      'CPC (cost per link click)',
      'CPC (all)',
      'CPC',
      'Cost per link click',
    ]));

    rec.spend += spend;
    rec.purchases += toNum(obj.Purchases);
    rec.conversionValue += toNum(obj['Purchases conversion value']);
    rec.clicks += clicks;
    rec.landingPageViews += toNum(obj['Landing page views']);
    rec.addsToCart += toNum(obj['Adds to cart']);
    rec.checkoutsInitiated += toNum(obj['Checkouts initiated']);
    rec.addsPaymentInfo += toNum(obj['Adds of payment info']);
    if (ctr > 0) {
      rec.ctrSum += ctr;
      rec.ctrCount += 1;
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

    const key = [day, accountName, country, creative].join('\0');
    const ctr = row[8] || 0;
    const cpc = row[9] || 0;
    aggMap.set(key, {
      day: day,
      accountName: accountName,
      country: country,
      creative: creative,
      spend: row[4] || 0,
      purchases: row[5] || 0,
      conversionValue: row[6] || 0,
      clicks: row[7] || 0,
      landingPageViews: row[11] || 0,
      addsToCart: row[12] || 0,
      checkoutsInitiated: row[13] || 0,
      addsPaymentInfo: row[14] || 0,
      ctrSum: ctr,
      ctrCount: ctr > 0 ? 1 : 0,
      cpcSum: cpc,
      cpcCount: cpc > 0 ? 1 : 0,
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
    const purchases = +r.purchases.toFixed(2);
    const conversionValue = +r.conversionValue.toFixed(2);
    const clicks = r.clicks;
    const ctr = r.ctrCount > 0 ? +(r.ctrSum / r.ctrCount).toFixed(4) : 0;
    const cpc = r.cpcCount > 0 ? +(r.cpcSum / r.cpcCount).toFixed(4) : r.clicks > 0 ? +(r.spend / r.clicks).toFixed(4) : 0;
    const impressions = ctr > 0 ? Math.round((clicks / ctr) * 100) : 0;

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
      r.addsPaymentInfo,
    ]);
  }

  const countries = [...new Set(compactRows.map(function (r) { return r[2]; }))].sort();

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      totalRecords: compactRows.length,
      sourceFiles: sourceFiles,
      dateRange: { min: dayList[0] || '', max: dayList[dayList.length - 1] || '' },
      platform: 'fb',
      optimizers: OPTIMIZERS,
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

function processExcelFile(filePath, aggMap) {
  const rows = readXlsx(filePath);
  const fileName = path.basename(filePath);
  if (!rows.length) {
    console.warn('  警告: ' + fileName + ' 无法读取或为空，已跳过');
    return 0;
  }
  const count = mergeRowsIntoAggMap(rows, aggMap);
  console.log('  合并 ' + fileName + ': ' + count + ' 行有效数据');
  return count;
}

function main() {
  const forceFull = process.argv.includes('--full');
  const allExcelFiles = findExcelFiles(DATA_DIR);
  const existingState = forceFull ? null : loadExistingForIncremental(OUT_DIR, loadAggMapFromExisting);

  let filesToProcess;
  let sourceFiles;
  let aggMap;

  if (forceFull || !existingState || !existingState.manifest) {
    if (!allExcelFiles.length) {
      console.error('未在项目根目录找到 Untitled-report_MMDD.xlsx 文件');
      process.exit(1);
    }
    filesToProcess = allExcelFiles;
    sourceFiles = allExcelFiles.map(function (f) { return path.basename(f); });
    aggMap = new Map();
    console.log(forceFull ? '全量重建模式 (--full)' : '首次转换');
  } else {
    const processed = new Set(existingState.manifest.sourceFiles || []);
    filesToProcess = allExcelFiles.filter(function (f) {
      return !processed.has(path.basename(f));
    });
    sourceFiles = (existingState.manifest.sourceFiles || []).slice();

    if (!filesToProcess.length) {
      console.log('没有新的 Excel 文件，数据未变更');
      console.log('已收录 ' + sourceFiles.length + ' 个文件');
      process.exit(0);
    }

    aggMap = existingState.aggMap;
    filesToProcess.forEach(function (f) {
      sourceFiles.push(path.basename(f));
    });
    console.log('增量更新: 已有 ' + aggMap.size + ' 条，新增 ' + filesToProcess.length + ' 个 Excel');
  }

  console.log('处理 ' + filesToProcess.length + ' 个 Excel 文件:');
  filesToProcess.forEach(function (f) { processExcelFile(f, aggMap); });

  const output = buildOutput(aggMap, sourceFiles);
  writeMonthlyOutput(OUT_DIR, 'fb', output, sourceFiles);
  console.log('日期范围: ' + output.meta.dateRange.min + ' ~ ' + output.meta.dateRange.max);
}

main();
