#!/usr/bin/env node
const path = require('path');
const {
  readManifest,
  loadAllMonthlyData,
  writeMonthlyOutput,
} = require('./lib/monthly-output');

const ROOT = path.join(__dirname, '..');

function resplitPlatform(platform) {
  const outDir = path.join(ROOT, 'public', platform);
  const manifest = readManifest(outDir);
  if (!manifest) {
    console.error('找不到 manifest: ' + outDir);
    process.exit(1);
  }

  console.log('读取 ' + platform + ' 现有数据…');
  const data = loadAllMonthlyData(outDir, manifest);
  if (!data.rows.length) {
    console.error(platform + ' 无可用数据行');
    process.exit(1);
  }

  const output = {
    meta: {
      platform: platform,
      sourceFiles: manifest.sourceFiles || [],
      totalRecords: data.rows.length,
      dateRange: data.days.length
        ? { min: data.days[0], max: data.days[data.days.length - 1] }
        : { min: '', max: '' },
      compact: true,
    },
    days: data.days,
    accounts: data.accounts,
    creatives: data.creatives,
    rows: data.rows,
  };

  console.log('按 7 天分段写出 ' + platform + ' …');
  writeMonthlyOutput(outDir, platform, output, manifest.sourceFiles || []);
}

function main() {
  const platformArg = process.argv.find(function (a) { return a.startsWith('--platform='); });
  const platform = platformArg ? platformArg.split('=')[1] : '';
  const targets = platform ? [platform] : ['fb', 'applovin'];

  targets.forEach(function (p) {
    if (p !== 'fb' && p !== 'applovin') {
      console.error('用法: node scripts/resplit-weekly.js [--platform=fb|applovin]');
      process.exit(1);
    }
    resplitPlatform(p);
  });

  console.log('完成');
}

main();
