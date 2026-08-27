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

function isDataChunkRelativePath(relativeFile) {
  if (/^\d{4}-\d{2}\.json$/.test(relativeFile)) return true;
  if (/^\d{4}-\d{2}\/\d{2}-\d{2}\.json$/.test(relativeFile)) return true;
  return false;
}

function listExistingDataFiles(outDir) {
  const files = [];
  if (!fs.existsSync(outDir)) return files;
  fs.readdirSync(outDir).forEach(function (name) {
    const full = path.join(outDir, name);
    if (name === 'manifest.json') return;
    if (name.endsWith('.json') && fs.statSync(full).isFile()) {
      if (isDataChunkRelativePath(name)) files.push(name);
      return;
    }
    if (fs.statSync(full).isDirectory() && /^\d{4}-\d{2}$/.test(name)) {
      fs.readdirSync(full).forEach(function (partName) {
        const relativeFile = name + '/' + partName;
        if (partName.endsWith('.json') && isDataChunkRelativePath(relativeFile)) {
          files.push(relativeFile);
        }
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
    console.log('  删除旧数据分片 ' + relativeFile);
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

function partIdsFromDays(days) {
  const ids = new Set();
  if (!days) return ids;
  days.forEach(function (day) {
    if (day) ids.add(weekPartForDay(day).id);
  });
  return ids;
}

function writeChunkFile(outDir, chunk) {
  const relativeFile = chunk.part.file;
  const filePath = path.join(outDir, relativeFile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(chunk.data));
  const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
  console.log(
    '  写出 ' + relativeFile + ': ' + chunk.data.meta.totalRecords + ' 条 (' + sizeMb + ' MB)'
  );
  return relativeFile;
}

function manifestPartFromChunk(chunk, file) {
  const actual = chunk.data && chunk.data.meta && chunk.data.meta.dateRange;
  const fallback = chunk.part.dateRange || {};
  return {
    id: chunk.part.id,
    file: file || chunk.part.file,
    dateRange: {
      min: (actual && actual.min) || fallback.min || '',
      max: (actual && actual.max) || fallback.max || '',
    },
    totalRecords: chunk.data.meta.totalRecords,
  };
}

function summarizeMonthParts(parts) {
  let monthRecords = 0;
  let monthMin = '';
  let monthMax = '';
  (parts || []).forEach(function (part) {
    monthRecords += part.totalRecords || 0;
    const dr = part.dateRange || {};
    if (dr.min && (!monthMin || dr.min < monthMin)) monthMin = dr.min;
    if (dr.max && (!monthMax || dr.max > monthMax)) monthMax = dr.max;
  });
  return {
    dateRange: { min: monthMin, max: monthMax },
    totalRecords: monthRecords,
  };
}

function writePartialMonthMapToDisk(outDir, platform, touchedMonthMap, sourceFiles, existingManifest) {
  fs.mkdirSync(outDir, { recursive: true });
  const touchedByFile = new Map();
  touchedMonthMap.forEach(function (parts) {
    parts.forEach(function (chunk) {
      touchedByFile.set(chunk.part.file, chunk);
    });
  });

  const months = [];
  (existingManifest.months || []).forEach(function (existingMonth) {
    const manifestParts = [];
    (existingMonth.parts || []).forEach(function (existingPart) {
      const chunk = touchedByFile.get(existingPart.file);
      if (chunk) {
        writeChunkFile(outDir, chunk);
        manifestParts.push(manifestPartFromChunk(chunk, existingPart.file));
        touchedByFile.delete(existingPart.file);
      } else {
        manifestParts.push(existingPart);
      }
    });
    const summary = summarizeMonthParts(manifestParts);
    months.push({
      id: existingMonth.id,
      dateRange: summary.dateRange,
      totalRecords: summary.totalRecords,
      parts: manifestParts,
    });
  });

  if (touchedByFile.size) {
    const newMonths = new Map();
    touchedMonthMap.forEach(function (parts, monthId) {
      parts.forEach(function (chunk) {
        if (!touchedByFile.has(chunk.part.file)) return;
        if (!newMonths.has(monthId)) newMonths.set(monthId, []);
        newMonths.get(monthId).push(chunk);
      });
    });

    Array.from(newMonths.keys()).sort().forEach(function (monthId) {
      const manifestParts = [];
      newMonths.get(monthId).forEach(function (chunk) {
        writeChunkFile(outDir, chunk);
        manifestParts.push(manifestPartFromChunk(chunk));
        touchedByFile.delete(chunk.part.file);
      });
      manifestParts.sort(function (a, b) {
        return (a.dateRange.min || '').localeCompare(b.dateRange.min || '');
      });

      const existingMonth = months.find(function (m) { return m.id === monthId; });
      if (existingMonth) {
        const knownFiles = new Set((existingMonth.parts || []).map(function (p) { return p.file; }));
        manifestParts.forEach(function (part) {
          if (!knownFiles.has(part.file)) {
            existingMonth.parts.push(part);
            knownFiles.add(part.file);
          }
        });
        existingMonth.parts.sort(function (a, b) {
          return (a.dateRange.min || '').localeCompare(b.dateRange.min || '');
        });
        const summary = summarizeMonthParts(existingMonth.parts);
        existingMonth.dateRange = summary.dateRange;
        existingMonth.totalRecords = summary.totalRecords;
      } else {
        const summary = summarizeMonthParts(manifestParts);
        months.push({
          id: monthId,
          dateRange: summary.dateRange,
          totalRecords: summary.totalRecords,
          parts: manifestParts,
        });
      }
    });
    months.sort(function (a, b) { return a.id.localeCompare(b.id); });
  }

  const keepFiles = [];
  months.forEach(function (month) {
    (month.parts || []).forEach(function (part) {
      keepFiles.push(part.file);
    });
  });
  cleanupStaleDataFiles(outDir, keepFiles);

  const defaultMonth = months.length ? months[months.length - 1].id : '';
  const manifest = {
    platform: platform,
    generatedAt: new Date().toISOString(),
    defaultMonth: defaultMonth,
    chunkDays: WEEK_DAYS,
    sourceFiles: sourceFiles || existingManifest.sourceFiles || [],
    months: months,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest -> ' + path.join(outDir, 'manifest.json') + ' (' + months.length + ' 个月, 按 ' + WEEK_DAYS + ' 天分段)');
  return manifest;
}

function writeMonthMapToDisk(outDir, platform, monthMap, sourceFiles, sourceFilesFallback) {
  fs.mkdirSync(outDir, { recursive: true });
  const monthIds = Array.from(monthMap.keys()).sort();
  const keepFiles = [];
  const months = [];

  monthIds.forEach(function (monthId) {
    const parts = monthMap.get(monthId);
    const manifestParts = [];

    parts.forEach(function (chunk) {
      const relativeFile = writeChunkFile(outDir, chunk);
      keepFiles.push(relativeFile);
      manifestParts.push(manifestPartFromChunk(chunk, relativeFile));
    });

    const summary = summarizeMonthParts(manifestParts);
    months.push({
      id: monthId,
      dateRange: summary.dateRange,
      totalRecords: summary.totalRecords,
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
    sourceFiles: sourceFiles || sourceFilesFallback || [],
    months: months,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest -> ' + path.join(outDir, 'manifest.json') + ' (' + months.length + ' 个月, 按 ' + WEEK_DAYS + ' 天分段)');
  return manifest;
}

function writeMonthlyOutput(outDir, platform, output, sourceFiles) {
  const monthMap = splitCompactByWeek(output);
  return writeMonthMapToDisk(outDir, platform, monthMap, sourceFiles, output.meta.sourceFiles);
}

function writeAggMapMonthlyOutput(outDir, platform, aggMap, sourceFiles, options) {
  options = options || {};
  const recordToItem = options.recordToItem;
  if (typeof recordToItem !== 'function') {
    throw new Error('writeAggMapMonthlyOutput 需要 options.recordToItem');
  }

  const existingManifest = options.existingManifest || null;
  const touchedDays = options.touchedDays || null;
  const isPartialWrite = !!(
    existingManifest
    && touchedDays
    && typeof touchedDays.size === 'number'
    && touchedDays.size > 0
  );
  const touchedPartIds = isPartialWrite ? partIdsFromDays(touchedDays) : null;

  if (isPartialWrite) {
    console.log(
      '增量写出: 仅更新 ' + touchedPartIds.size + ' 个周分片（'
      + Array.from(touchedPartIds).sort().join(', ') + '）'
    );
  }

  const groups = new Map();
  const accountSet = new Set();
  const countrySet = new Set();
  let minDay = '';
  let maxDay = '';

  for (const rec of aggMap.values()) {
    const part = weekPartForDay(rec.day);
    if (touchedPartIds && !touchedPartIds.has(part.id)) continue;

    if (rec.accountName) accountSet.add(rec.accountName);
    if (rec.country) countrySet.add(rec.country);
    if (rec.day) {
      if (!minDay || rec.day < minDay) minDay = rec.day;
      if (!maxDay || rec.day > maxDay) maxDay = rec.day;
    }
    if (!groups.has(part.id)) groups.set(part.id, { part: part, items: [] });
    groups.get(part.id).items.push(recordToItem(rec));
  }

  const baseMeta = Object.assign({
    generatedAt: new Date().toISOString(),
    totalRecords: isPartialWrite
      ? Array.from(groups.values()).reduce(function (sum, g) { return sum + g.items.length; }, 0)
      : aggMap.size,
    platform: platform,
    accounts: Array.from(accountSet).sort(),
    countries: Array.from(countrySet).sort(),
    compact: true,
    dateRange: { min: minDay, max: maxDay },
  }, options.meta || {});

  const monthMap = new Map();
  groups.forEach(function (group, partId) {
    const monthId = monthIdFromDay(group.part.dateRange.min);
    const data = buildCompactChunk(group.items, baseMeta, {
      month: monthId,
      part: partId,
    });
    if (!monthMap.has(monthId)) monthMap.set(monthId, []);
    monthMap.get(monthId).push({ part: group.part, data: data });
  });

  monthMap.forEach(function (parts) {
    parts.sort(function (a, b) {
      return a.part.dateRange.min.localeCompare(b.part.dateRange.min);
    });
  });

  if (isPartialWrite) {
    return writePartialMonthMapToDisk(outDir, platform, monthMap, sourceFiles, existingManifest);
  }
  return writeMonthMapToDisk(outDir, platform, monthMap, sourceFiles);
}

function loadExistingForIncremental(outDir, ingestCompactRow) {
  const manifest = readManifest(outDir);
  if (!manifest) return { manifest: null, aggMap: new Map() };

  const aggMap = new Map();
  expandMonthEntries(manifest).forEach(function (entry) {
    const data = loadJsonFile(outDir, entry.file);
    if (!data || !Array.isArray(data.rows)) return;
    const days = data.days;
    const accounts = data.accounts;
    const creatives = data.creatives;
    for (let i = 0; i < data.rows.length; i++) {
      ingestCompactRow(aggMap, days, accounts, creatives, data.rows[i]);
    }
  });

  return { manifest: manifest, aggMap: aggMap };
}

function ensureNodeHeap(minMb) {
  if (process.env.AD_DASHBOARD_NO_HEAP_REEXEC === '1') return;
  const wantMb = minMb || parseInt(process.env.AD_DASHBOARD_HEAP_MB || '8192', 10);
  const v8 = require('v8');
  const currentMb = Math.floor(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
  if (currentMb >= wantMb - 64) return;

  const { spawnSync } = require('child_process');
  const nodeOpts = (process.env.NODE_OPTIONS || '').trim();
  const extra = '--max-old-space-size=' + wantMb;
  const nextOpts = nodeOpts.includes('max-old-space-size') ? nodeOpts : (nodeOpts + ' ' + extra).trim();
  console.log('Node 堆上限 ' + currentMb + ' MB 不足，以 ' + wantMb + ' MB 重新启动…');
  const result = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: Object.assign({}, process.env, {
      NODE_OPTIONS: nextOpts,
      AD_DASHBOARD_NO_HEAP_REEXEC: '1',
    }),
  });
  process.exit(result.status != null ? result.status : 1);
}

function parseRefreshArgs(argv) {
  const names = [];
  let refreshToday = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--refresh-today') refreshToday = true;
    else if (argv[i] === '--refresh' && argv[i + 1]) names.push(argv[++i]);
  }
  return { names: names, refreshToday: refreshToday };
}

function todayIsoLocal() {
  const d = new Date();
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

function purgeDaysFromAggMap(aggMap, days) {
  const daySet = days instanceof Set ? days : new Set([].concat(days || []));
  if (!daySet.size) return 0;
  let removed = 0;
  aggMap.forEach(function (rec, key) {
    if (daySet.has(rec.day)) {
      aggMap.delete(key);
      removed += 1;
    }
  });
  return removed;
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
  writeAggMapMonthlyOutput: writeAggMapMonthlyOutput,
  loadExistingForIncremental: loadExistingForIncremental,
  expandMonthEntries: expandMonthEntries,
  ensureNodeHeap: ensureNodeHeap,
  isDataChunkRelativePath: isDataChunkRelativePath,
  partIdsFromDays: partIdsFromDays,
  parseRefreshArgs: parseRefreshArgs,
  todayIsoLocal: todayIsoLocal,
  purgeDaysFromAggMap: purgeDaysFromAggMap,
};
