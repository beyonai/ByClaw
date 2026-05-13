#!/usr/bin/env node

/**
 * 检查并删除 src/locales/ 中未被引用的国际化 key
 *
 * 用法:
 *   node scripts/check-unused-locales.js          # 仅检查，列出未使用的 key
 *   node scripts/check-unused-locales.js --delete  # 检查并删除未使用的 key
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '../src');
const DELETE_MODE = process.argv.includes('--delete');

// ===================== 工具函数 =====================

/** 递归收集所有 ts/tsx/js/jsx 文件 */
function getAllSourceFiles(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.umi') continue;
      getAllSourceFiles(full, result);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

// ===================== 收集所有 locale key =====================

function extractFlatKeys(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const keys = [];
  const re = /^\s*['"]([^'"]+)['"]\s*:/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

function extractNestedKeys(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const keys = [];
  const lines = content.split('\n');
  const pathStack = [];
  let inObject = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'export default {') { inObject = true; continue; }
    if (!inObject) continue;

    const objMatch = trimmed.match(/^['"]?([^'":\s]+)['"]?\s*:\s*\{/);
    if (objMatch) { pathStack.push(objMatch[1]); continue; }

    const leafMatch = trimmed.match(/^['"]([^'"]+)['"]\s*:\s*['"][^'"]*['"]/);
    if (leafMatch) {
      keys.push([...pathStack, leafMatch[1]].join('.'));
      continue;
    }

    if (/^\}/.test(trimmed) && pathStack.length > 0) pathStack.pop();
  }
  return keys;
}

function collectAllKeys() {
  const keyFileMap = new Map();

  const mainFile = path.join(SRC_DIR, 'locales/zh-CN.ts');
  if (fs.existsSync(mainFile)) {
    for (const key of extractFlatKeys(mainFile)) keyFileMap.set(key, mainFile);
  }

  const subFiles = [
    'locales/zh-CN/secondEdition.ts',
    'locales/zh-CN/manager.ts',
    'pages/manager/dashboard/locales/zh-CN.ts',
    'pages/manager/digitalEmployeeMgr/locales/zh-CN.ts',
  ];
  for (const rel of subFiles) {
    const fp = path.join(SRC_DIR, rel);
    if (fs.existsSync(fp)) {
      for (const key of extractFlatKeys(fp)) keyFileMap.set(key, fp);
    }
  }

  const dighumFile = path.join(SRC_DIR, 'locales/zh-CN/dighum.ts');
  if (fs.existsSync(dighumFile)) {
    for (const key of extractNestedKeys(dighumFile)) keyFileMap.set(key, dighumFile);
  }

  return keyFileMap;
}

// ===================== 构建全项目内容索引 =====================

function buildSourceIndex() {
  const allFiles = getAllSourceFiles(SRC_DIR);
  const contentChunks = [];

  for (const file of allFiles) {
    // 排除 locale 定义文件和测试文件
    const rel = path.relative(SRC_DIR, file);
    if (rel.startsWith('locales/') || rel.includes('__tests__')) continue;
    if (rel.includes('/locales/')) continue; // page-level locales

    contentChunks.push(fs.readFileSync(file, 'utf-8'));
  }

  return contentChunks.join('\n');
}

/** 从源码内容中提取动态拼接的 locale key 前缀 */
function collectDynamicPrefixes(sourceContent) {
  const prefixes = new Set();
  // 匹配 `somePrefix.${variable}` 格式
  const re = /`([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*\.)\$\{/g;
  let m;
  while ((m = re.exec(sourceContent)) !== null) {
    prefixes.add(m[1]);
  }
  return prefixes;
}

function isKeyUsed(key, sourceContent, dynamicPrefixes) {
  // 检查动态前缀匹配
  for (const prefix of dynamicPrefixes) {
    if (key.startsWith(prefix)) return true;
  }

  // 精确搜索 key 出现（作为字符串）
  return sourceContent.includes(key);
}

// ===================== 删除 =====================

function removeKeysFromFlatFile(filePath, keysToRemove) {
  if (!fs.existsSync(filePath)) return 0;
  const keySet = new Set(keysToRemove);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const newLines = [];
  let removed = 0;

  for (const line of lines) {
    const m = line.match(/^\s*['"]([^'"]+)['"]\s*:/);
    if (m && keySet.has(m[1])) {
      removed++;
      continue;
    }
    newLines.push(line);
  }

  if (removed > 0) {
    const cleaned = newLines.join('\n').replace(/\n{3,}/g, '\n\n');
    fs.writeFileSync(filePath, cleaned);
  }
  return removed;
}

function getEnUSCounterpart(zhCNPath) {
  return zhCNPath.replace(/zh-CN/g, 'en-US');
}

// ===================== Main =====================

function main() {
  console.log('\n收集所有 locale key...');
  const keyFileMap = collectAllKeys();
  console.log(`共找到 ${keyFileMap.size} 个 locale key`);

  console.log('构建源码索引...');
  const sourceContent = buildSourceIndex();
  console.log(`已索引 ${(sourceContent.length / 1024 / 1024).toFixed(1)} MB 源码`);

  console.log('收集动态拼接前缀...');
  const dynamicPrefixes = collectDynamicPrefixes(sourceContent);
  if (dynamicPrefixes.size > 0) {
    console.log(`发现 ${dynamicPrefixes.size} 个动态前缀:`);
    for (const p of dynamicPrefixes) console.log(`  ${p}\${...}`);
  }

  console.log('\n检查每个 key 的引用情况...');
  const unusedByFile = new Map();
  let checked = 0;
  const total = keyFileMap.size;

  for (const [key, filePath] of keyFileMap) {
    checked++;
    if (checked % 200 === 0) process.stdout.write(`  进度: ${checked}/${total}\r`);
    if (!isKeyUsed(key, sourceContent, dynamicPrefixes)) {
      if (!unusedByFile.has(filePath)) unusedByFile.set(filePath, []);
      unusedByFile.get(filePath).push(key);
    }
  }
  console.log(`  进度: ${total}/${total}    `);

  // 输出
  console.log('\n========================================');
  console.log(' 未被引用的 locale key 检查结果');
  console.log('========================================\n');

  let totalUnused = 0;
  const cwd = process.cwd();

  if (unusedByFile.size === 0) {
    console.log('✅ 所有 locale key 均被引用\n');
    return;
  }

  for (const [filePath, keys] of unusedByFile) {
    const relPath = path.relative(cwd, filePath);
    console.log(`📄 ${relPath} (${keys.length} 个未使用)`);
    for (const key of keys) console.log(`   ⚠️  '${key}'`);
    console.log('');
    totalUnused += keys.length;
  }

  console.log('----------------------------------------');
  console.log(`总计: ${total} 个 key, ${totalUnused} 个未被引用`);
  console.log('----------------------------------------\n');

  if (DELETE_MODE) {
    console.log('🗑️  开始删除未使用的 key...\n');
    for (const [filePath, keys] of unusedByFile) {
      const relPath = path.relative(cwd, filePath);
      // dighum.ts 是嵌套格式，暂不自动删除，仅提示
      if (filePath.includes('dighum.ts')) {
        console.log(`  ⏭️  ${relPath}: 嵌套格式，需手动处理 (${keys.length} 个 key)`);
        continue;
      }

      const removedZh = removeKeysFromFlatFile(filePath, keys);
      console.log(`  ✅ ${relPath}: 删除 ${removedZh} 个 key`);

      const enUSPath = getEnUSCounterpart(filePath);
      if (fs.existsSync(enUSPath)) {
        const removedEn = removeKeysFromFlatFile(enUSPath, keys);
        console.log(`  ✅ ${path.relative(cwd, enUSPath)}: 删除 ${removedEn} 个 key`);
      }
    }
    console.log('\n✅ 完成!\n');
  } else {
    console.log('💡 添加 --delete 参数来删除这些未使用的 key:');
    console.log('   node scripts/check-unused-locales.js --delete\n');
  }
}

main();
