const fs = require('fs');
const path = require('path');

const WEEK_DAYS = 7;

function monthIdFromDay(day) {
  if (!day || day.length < 7) return '';
  return day.slice(0, 7);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function daysInMonth(monthId) {
  const parts = monthId.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return new Date(y, m, 0).getDate();
}

function weekPartForDay(day) {
  const monthId = monthIdFromDay(day);
  const dayNum = parseInt(day.slice(8, 10), 10);
  const startNum = Math.floor((dayNum - 1) / WEEK_DAYS) * WEEK_DAYS + 1;
  const endNum = Math.min(startNum + WEEK_DAYS - 1, daysInMonth(monthId));
  const min = monthId + '-' + pad2(startNum);
  const max = monthId + '-' + pad2(endNum);
  const partId = monthId + '/' + pad2(startNum) + '-' + pad2(endNum);
  return {
    id: partId,
    file: partId + '.json',
    dateRange: { min: min, max: max },
  };
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

function loadJsonFile(outDir, relativeFile) {
  const filePath = path.join(outDir, relativeFile);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadMonthlyJson(outDir, monthId) {
  return loadJsonFile(outDir, monthId + '.json');
}

function expandMonthEntries(manifest) {
  const entries = [];
  (manifest.months || []).forEach(function (m) {
    if (m.parts && m.parts.length) {
      m.parts.forEach(function (p) {
        entries.push({
          monthId: m.id,
          file: p.file,
          dateRange: p.dateRange || {},
        });
      });
      return;
    }
    if (m.file) {
      entries.push({ monthId: m.id, file: m.file, dateRange: m.dateRange || {} });
      return;
    }
    entries.push({
      monthId: m.id,
      file: m.id + '.json',
      dateRange: m.dateRange || {},
    });
  });
  return entries;
}

function loadAllMonthlyData(outDir, manifest) {
  const daySet = new Set();
  const accountSet = new Set();
  const creativeSet = new Set();
  const allRows = [];

  expandMonthEntries(manifest).forEach(function (entry) {
    const data = loadJsonFile(outDir, entry.file);
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

function buildCompactChunk(items, meta, extraMeta) {
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

  const chunkMeta = Object.assign({}, meta, extraMeta, {
    totalRecords: compactRows.length,
    dateRange: {
      min: dayList[0] || '',
      max: dayList[dayList.length - 1] || '',
    },
  });
  delete chunkMeta.sourceFiles;

  return {
    meta: chunkMeta,
    days: dayList,
    accounts: accountList,
    creatives: creativeList,
    rows: compactRows,
  };
}

function splitCompactByWeek(output) {
  const groups = new Map();
  const { days, accounts, creatives, rows, meta } = output;

  rows.forEach(function (row) {
    const day = days[row[0]];
    const part = weekPartForDay(day);
    if (!groups.has(part.id)) groups.set(part.id, { part: part, items: [] });
    groups.get(part.id).items.push({
      day: day,
      account: accounts[row[1]],
      country: row[2],
      creative: creatives[row[3]],
      cells: row.slice(4),
    });
  });

  const monthMap = new Map();
  groups.forEach(function (group, partId) {
    const monthId = monthIdFromDay(group.part.dateRange.min);
    const data = buildCompactChunk(group.items, meta, {
      month: monthId,
      part: partId,
    });
    if (!monthMap.has(monthId)) monthMap.set(monthId, []);
    monthMap.get(monthId).push({
      part: group.part,
      data: data,
    });
  });

  monthMap.forEach(function (parts) {
    parts.sort(function (a, b) {
      return a.part.dateRange.min.localeCompare(b.part.dateRange.min);
    });
  });

  return monthMap;
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
    monthOutputs.push({
      id: monthId,
      data: buildCompactChunk(items, meta, { month: monthId }),
    });
  });

  monthOutputs.sort(function (a, b) { return a.id.localeCompare(b.id); });
  return monthOutputs;
}

function listExistingDataFiles(outDir) {
  const files = [];
  if (!fs.existsSync(outDir)) return files;
  fs.readdirSync(outDir).forEach(function (name) {
    const full = path.join(outDir, name);
    if (name === 'manifest.json') return;
    if (name.endsWith('.json') && fs.statSync(full).isFile()) {
      files.push(name);
      return;
    }
    if (fs.statSync(full).isDirectory() && /^\d{4}-\d{2}$/.test(name)) {
      fs.readdirSync(full).forEach(function (partName) {
        if (partName.endsWith('.json')) files.push(name + '/' + partName);
      });
    }
  });
  return files;
}

function cleanupStaleDataFiles(outDir, keepFiles) {
  const keep = new Set(keepFiles);
  listExistingDataFiles(outDir).forEach(function (relativeFile) {
    if (keep.has(relativeFile)) return;
    const full = path.join(outDir, relativeFile);
    fs.unlinkSync(full);
    console.log('  删除旧文件 ' + relativeFile);
  });

  if (!fs.existsSync(outDir)) return;
  fs.readdirSync(outDir).forEach(function (name) {
    if (!/^\d{4}-\d{2}$/.test(name)) return;
    const dir = path.join(outDir, name);
    if (!fs.statSync(dir).isDirectory()) return;
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  });
}

function writeMonthlyOutput(outDir, platform, output, sourceFiles) {
  fs.mkdirSync(outDir, { recursive: true });
  const monthMap = splitCompactByWeek(output);
  const monthIds = Array.from(monthMap.keys()).sort();
  const keepFiles = [];
  const months = [];

  monthIds.forEach(function (monthId) {
    const parts = monthMap.get(monthId);
    let monthRecords = 0;
    let monthMin = '';
    let monthMax = '';
    const manifestParts = [];

    parts.forEach(function (chunk) {
      const relativeFile = chunk.part.file;
      const filePath = path.join(outDir, relativeFile);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(chunk.data));
      keepFiles.push(relativeFile);

      const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
      console.log(
        '  写出 ' + relativeFile + ': ' + chunk.data.meta.totalRecords + ' 条 (' + sizeMb + ' MB)'
      );

      monthRecords += chunk.data.meta.totalRecords;
      const dr = chunk.data.meta.dateRange || {};
      if (dr.min && (!monthMin || dr.min < monthMin)) monthMin = dr.min;
      if (dr.max && (!monthMax || dr.max > monthMax)) monthMax = dr.max;

      manifestParts.push({
        id: chunk.part.id,
        file: relativeFile,
        dateRange: chunk.part.dateRange,
        totalRecords: chunk.data.meta.totalRecords,
      });
    });

    months.push({
      id: monthId,
      dateRange: { min: monthMin, max: monthMax },
      totalRecords: monthRecords,
      parts: manifestParts,
    });
  });

  cleanupStaleDataFiles(outDir, keepFiles);

  const defaultMonth = months.length ? months[months.length - 1].id : '';
  const manifest = {
    platform: platform,
    generatedAt: new Date().toISOString(),
    defaultMonth: defaultMonth,
    chunkDays: WEEK_DAYS,
    sourceFiles: sourceFiles || output.meta.sourceFiles || [],
    months: months,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest -> ' + path.join(outDir, 'manifest.json') + ' (' + months.length + ' 个月, 按 ' + WEEK_DAYS + ' 天分段)');
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
  WEEK_DAYS: WEEK_DAYS,
  monthIdFromDay: monthIdFromDay,
  weekPartForDay: weekPartForDay,
  readManifest: readManifest,
  loadMonthlyJson: loadMonthlyJson,
  loadAllMonthlyData: loadAllMonthlyData,
  splitCompactByMonth: splitCompactByMonth,
  splitCompactByWeek: splitCompactByWeek,
  writeMonthlyOutput: writeMonthlyOutput,
  loadExistingForIncremental: loadExistingForIncremental,
  expandMonthEntries: expandMonthEntries,
};
