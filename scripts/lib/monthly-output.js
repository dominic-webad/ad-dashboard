const fs = require('fs');
const path = require('path');

function monthIdFromDay(day) {
  if (!day || day.length < 7) return '';
  return day.slice(0, 7);
}

function readManifest(outDir) {
  const manifestPath = path.join(outDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function loadMonthlyJson(outDir, monthId) {
  const filePath = path.join(outDir, monthId + '.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadAllMonthlyData(outDir, manifest) {
  const months = manifest && manifest.months ? manifest.months : [];
  const daySet = new Set();
  const accountSet = new Set();
  const creativeSet = new Set();
  const allRows = [];

  months.forEach(function (m) {
    const data = loadMonthlyJson(outDir, m.id);
    if (!data) return;
    data.days.forEach(function (d) { daySet.add(d); });
    data.accounts.forEach(function (a) { accountSet.add(a); });
    data.creatives.forEach(function (c) { creativeSet.add(c); });
    data.rows.forEach(function (row) {
      allRows.push({
        day: data.days[row[0]],
        account: data.accounts[row[1]],
        country: row[2],
        creative: data.creatives[row[3]],
        cells: row.slice(4),
      });
    });
  });

  const dayList = Array.from(daySet).sort();
  const accountList = Array.from(accountSet).sort();
  const creativeList = Array.from(creativeSet).sort();
  const dayMap = new Map(dayList.map(function (d, i) { return [d, i]; }));
  const accountMap = new Map(accountList.map(function (a, i) { return [a, i]; }));
  const creativeMap = new Map(creativeList.map(function (c, i) { return [c, i]; }));

  return {
    days: dayList,
    accounts: accountList,
    creatives: creativeList,
    rows: allRows.map(function (r) {
      return [
        dayMap.get(r.day),
        accountMap.get(r.account),
        r.country,
        creativeMap.get(r.creative),
      ].concat(r.cells);
    }),
  };
}

function splitCompactByMonth(output) {
  const groups = new Map();
  const { days, accounts, creatives, rows, meta } = output;

  rows.forEach(function (row) {
    const day = days[row[0]];
    const monthId = monthIdFromDay(day);
    if (!monthId) return;
    if (!groups.has(monthId)) groups.set(monthId, []);
    groups.get(monthId).push({
      day: day,
      account: accounts[row[1]],
      country: row[2],
      creative: creatives[row[3]],
      cells: row.slice(4),
    });
  });

  const monthOutputs = [];
  groups.forEach(function (items, monthId) {
    const dayList = Array.from(new Set(items.map(function (i) { return i.day; }))).sort();
    const accountList = Array.from(new Set(items.map(function (i) { return i.account; }))).sort();
    const creativeList = Array.from(new Set(items.map(function (i) { return i.creative; }))).sort();
    const dayMap = new Map(dayList.map(function (d, i) { return [d, i]; }));
    const accountMap = new Map(accountList.map(function (a, i) { return [a, i]; }));
    const creativeMap = new Map(creativeList.map(function (c, i) { return [c, i]; }));

    const compactRows = items.map(function (r) {
      return [
        dayMap.get(r.day),
        accountMap.get(r.account),
        r.country,
        creativeMap.get(r.creative),
      ].concat(r.cells);
    });

    const monthMeta = Object.assign({}, meta, {
      month: monthId,
      totalRecords: compactRows.length,
      dateRange: {
        min: dayList[0] || '',
        max: dayList[dayList.length - 1] || '',
      },
    });
    delete monthMeta.sourceFiles;

    monthOutputs.push({
      id: monthId,
      data: {
        meta: monthMeta,
        days: dayList,
        accounts: accountList,
        creatives: creativeList,
        rows: compactRows,
      },
    });
  });

  monthOutputs.sort(function (a, b) { return a.id.localeCompare(b.id); });
  return monthOutputs;
}

function writeMonthlyOutput(outDir, platform, output, sourceFiles) {
  fs.mkdirSync(outDir, { recursive: true });
  const monthChunks = splitCompactByMonth(output);
  const months = monthChunks.map(function (chunk) {
    const fileName = chunk.id + '.json';
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(chunk.data));
    const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
    console.log('  写出 ' + fileName + ': ' + chunk.data.meta.totalRecords + ' 条 (' + sizeMb + ' MB)');
    return {
      id: chunk.id,
      file: fileName,
      dateRange: chunk.data.meta.dateRange,
      totalRecords: chunk.data.meta.totalRecords,
    };
  });

  const defaultMonth = months.length ? months[months.length - 1].id : '';
  const manifest = {
    platform: platform,
    generatedAt: new Date().toISOString(),
    defaultMonth: defaultMonth,
    sourceFiles: sourceFiles || output.meta.sourceFiles || [],
    months: months,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest -> ' + path.join(outDir, 'manifest.json') + ' (' + months.length + ' 个月)');
  return manifest;
}

function loadExistingForIncremental(outDir, loadAggMapFromExisting) {
  const manifest = readManifest(outDir);
  if (!manifest) return { manifest: null, data: null, aggMap: new Map() };
  const data = loadAllMonthlyData(outDir, manifest);
  data.meta = {
    sourceFiles: manifest.sourceFiles || [],
    totalRecords: data.rows.length,
    dateRange: data.days.length
      ? { min: data.days[0], max: data.days[data.days.length - 1] }
      : { min: '', max: '' },
  };
  return {
    manifest: manifest,
    data: data,
    aggMap: loadAggMapFromExisting(data),
  };
}

module.exports = {
  monthIdFromDay: monthIdFromDay,
  readManifest: readManifest,
  loadMonthlyJson: loadMonthlyJson,
  loadAllMonthlyData: loadAllMonthlyData,
  splitCompactByMonth: splitCompactByMonth,
  writeMonthlyOutput: writeMonthlyOutput,
  loadExistingForIncremental: loadExistingForIncremental,
};
