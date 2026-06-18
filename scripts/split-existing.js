#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { writeMonthlyOutput } = require('./lib/monthly-output');

const ROOT = path.join(__dirname, '..');

function main() {
  const platformArg = process.argv.find(function (a) { return a.startsWith('--platform='); });
  const platform = platformArg ? platformArg.split('=')[1] : process.argv[2];
  if (!platform || (platform !== 'fb' && platform !== 'applovin')) {
    console.error('用法: node scripts/split-existing.js --platform=fb|applovin');
    process.exit(1);
  }

  const srcPath = platform === 'fb'
    ? path.join(ROOT, 'public', 'data.json')
    : path.join('/Users/dominic/Desktop/applovin/applovin-dashboard/public/data.json');

  if (!fs.existsSync(srcPath)) {
    console.error('找不到源数据: ' + srcPath);
    process.exit(1);
  }

  console.log('读取 ' + srcPath + ' ...');
  const output = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  if (!output.meta) output.meta = {};
  if (platform === 'fb' && !output.meta.platform) output.meta.platform = 'fb';
  if (platform === 'applovin') output.meta.platform = 'applovin';

  const outDir = path.join(ROOT, 'public', platform);
  writeMonthlyOutput(outDir, platform, output, output.meta.sourceFiles || []);
  console.log('完成拆分 -> ' + outDir);
}

main();
