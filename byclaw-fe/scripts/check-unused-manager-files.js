#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(PROJECT_ROOT, 'src');
const SRC_PAGES_ROOT = path.join(SRC_ROOT, 'pages');
const MANAGER_ROOT = path.join(SRC_PAGES_ROOT, 'manager');
const MANAGER_MODELS_ROOT = path.join(MANAGER_ROOT, 'models');
const SCAN_DIRS = ['src', 'config'];

const args = process.argv.slice(2);
const SHOW_DETAILS = args.includes('--detail') || args.includes('-d');
const INCLUDE_TESTS = args.includes('--include-tests');
const DELETE_MODE = args.includes('--delete');

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.umi',
  '.umi-production',
  '.cache',
  'dist',
  'build',
  'coverage',
]);

const CANDIDATE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.less',
  '.css',
  '.scss',
  '.sass',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.bmp',
  '.json',
]);

const SCAN_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.less',
  '.css',
  '.scss',
  '.sass',
]);

const RESOLVE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.less',
  '.css',
  '.scss',
  '.sass',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.bmp',
  '.json',
];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function toProjectRelative(filePath) {
  return toPosix(path.relative(PROJECT_ROOT, filePath));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTestFile(filePath) {
  return /(^|\/)__tests__(\/|$)|\.(test|spec)\.[jt]sx?$/.test(toPosix(filePath));
}

function isCandidateFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!CANDIDATE_EXTENSIONS.has(ext)) {
    return false;
  }

  if (filePath.endsWith('.d.ts')) {
    return false;
  }

  if (!INCLUDE_TESTS && isTestFile(filePath)) {
    return false;
  }

  return true;
}

function isScanFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SCAN_EXTENSIONS.has(ext)) {
    return false;
  }

  if (!INCLUDE_TESTS && isTestFile(filePath)) {
    return false;
  }

  return true;
}

function collectFiles(startDir, predicate) {
  const files = [];

  if (!fs.existsSync(startDir)) {
    return files;
  }

  const stack = [startDir];

  while (stack.length > 0) {
    const currentPath = stack.pop();
    let stats;

    try {
      stats = fs.statSync(currentPath);
    } catch (error) {
      continue;
    }

    if (stats.isDirectory()) {
      let items = [];
      try {
        items = fs.readdirSync(currentPath);
      } catch (error) {
        continue;
      }

      for (const item of items) {
        if (IGNORE_DIRS.has(item)) {
          continue;
        }
        stack.push(path.join(currentPath, item));
      }
      continue;
    }

    if (stats.isFile() && predicate(currentPath)) {
      files.push(currentPath);
    }
  }

  return files;
}

function buildCandidateLookup(candidateFiles) {
  const lookup = new Set();
  candidateFiles.forEach((filePath) => {
    lookup.add(toPosix(path.resolve(filePath)));
  });
  return lookup;
}

function stripQueryAndHash(ref) {
  return ref.replace(/[?#].*$/, '');
}

function normalizeAliasReference(ref) {
  if (ref.startsWith('~')) {
    return ref.slice(1);
  }
  return ref;
}

function resolveCandidate(basePath, candidateLookup) {
  const variants = [];
  const ext = path.extname(basePath);

  variants.push(basePath);

  if (!ext) {
    for (const resolveExt of RESOLVE_EXTENSIONS) {
      variants.push(`${basePath}${resolveExt}`);
    }

    for (const resolveExt of RESOLVE_EXTENSIONS) {
      variants.push(path.join(basePath, `index${resolveExt}`));
    }
  }

  for (const variant of variants) {
    const normalized = toPosix(path.resolve(variant));
    if (candidateLookup.has(normalized)) {
      return normalized;
    }
  }

  return null;
}

function resolveReference(ref, importerPath, candidateLookup) {
  if (!ref) {
    return null;
  }

  let normalizedRef = stripQueryAndHash(normalizeAliasReference(ref.trim()));
  if (!normalizedRef) {
    return null;
  }

  if (
    normalizedRef.startsWith('http://') ||
    normalizedRef.startsWith('https://') ||
    normalizedRef.startsWith('data:') ||
    normalizedRef.startsWith('#') ||
    normalizedRef.startsWith('//')
  ) {
    return null;
  }

  let basePath = null;

  if (normalizedRef.startsWith('@/') || normalizedRef.startsWith('@beyond/')) {
    const withoutAlias = normalizedRef.replace(/^@(?:beyond)?\//, '');
    basePath = path.join(SRC_ROOT, withoutAlias);
  } else if (normalizedRef.startsWith('src/')) {
    basePath = path.join(PROJECT_ROOT, normalizedRef);
  } else if (normalizedRef.startsWith('./manager/') || normalizedRef.startsWith('../manager/')) {
    basePath = path.join(SRC_PAGES_ROOT, normalizedRef.replace(/^\.\//, ''));
  } else if (normalizedRef.startsWith('./') || normalizedRef.startsWith('../')) {
    basePath = path.resolve(path.dirname(importerPath), normalizedRef);
  } else {
    return null;
  }

  return resolveCandidate(basePath, candidateLookup);
}

function extractPathReferences(content) {
  const refs = new Set();
  const patterns = [
    /import\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
    /export\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/g,
    /@import\s+(?:url\()?\s*['"]([^'"]+)['"]\s*\)?/g,
    /component\s*:\s*['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      refs.add(match[1]);
    }
  }

  return refs;
}

function getManagerModelFiles(candidateLookup) {
  const files = [];

  if (!fs.existsSync(MANAGER_MODELS_ROOT)) {
    return files;
  }

  const items = fs.readdirSync(MANAGER_MODELS_ROOT);
  for (const item of items) {
    const fullPath = path.join(MANAGER_MODELS_ROOT, item);
    let stats;

    try {
      stats = fs.statSync(fullPath);
    } catch (error) {
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    if (!['.ts', '.tsx', '.js', '.jsx'].includes(path.extname(item))) {
      continue;
    }

    const normalized = toPosix(path.resolve(fullPath));
    if (!candidateLookup.has(normalized)) {
      continue;
    }

    files.push({
      name: path.basename(item, path.extname(item)),
      path: normalized,
    });
  }

  return files;
}

function extractModelReferences(content, modelFiles) {
  const used = new Set();

  for (const model of modelFiles) {
    const name = escapeRegExp(model.name);
    const patterns = [
      new RegExp(`['"\`]${name}/`, 'g'),
      new RegExp(`useModel\\(\\s*['"\`]${name}['"\`]`, 'g'),
      new RegExp(`(?:connect|useSelector)\\s*\\(\\s*\\(\\s*\\{[^)]*\\b${name}\\b`, 'gs'),
    ];

    for (const pattern of patterns) {
      if (pattern.test(content)) {
        used.add(model.path);
        break;
      }
    }
  }

  return used;
}

function removeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

function analyzeManagerFiles() {
  if (!fs.existsSync(MANAGER_ROOT)) {
    console.error('❌ manager 目录不存在');
    process.exitCode = 1;
    return;
  }

  console.log('🔍 开始分析 manager 目录下未被引用的文件...\n');

  const candidateFiles = collectFiles(MANAGER_ROOT, isCandidateFile).sort();
  const candidateLookup = buildCandidateLookup(candidateFiles);
  const scanFiles = SCAN_DIRS.flatMap((dir) => collectFiles(path.join(PROJECT_ROOT, dir), isScanFile)).sort();
  const modelFiles = getManagerModelFiles(candidateLookup);

  console.log(`📂 候选文件: ${candidateFiles.length} 个`);
  console.log(`📄 扫描源码: ${scanFiles.length} 个`);
  console.log(`🧠 特殊处理 manager models: ${modelFiles.length} 个\n`);

  const usedFiles = new Set();
  const usageDetails = new Map();

  for (const scanFile of scanFiles) {
    let content = '';

    try {
      content = fs.readFileSync(scanFile, 'utf-8');
    } catch (error) {
      continue;
    }

    const refs = extractPathReferences(content);
    const importerRel = toProjectRelative(scanFile);

    refs.forEach((ref) => {
      const resolved = resolveReference(ref, scanFile, candidateLookup);
      if (!resolved) {
        return;
      }

      usedFiles.add(resolved);
      if (!usageDetails.has(resolved)) {
        usageDetails.set(resolved, new Set());
      }
      usageDetails.get(resolved).add(importerRel);
    });

    const modelRefs = extractModelReferences(content, modelFiles);
    modelRefs.forEach((resolved) => {
      usedFiles.add(resolved);
      if (!usageDetails.has(resolved)) {
        usageDetails.set(resolved, new Set());
      }
      usageDetails.get(resolved).add(`${importerRel} (model namespace)`);
    });
  }

  const unusedFiles = candidateFiles
    .map((filePath) => toPosix(path.resolve(filePath)))
    .filter((filePath) => !usedFiles.has(filePath))
    .sort();

  console.log('📊 扫描结果:');
  console.log(`   总文件数: ${candidateFiles.length}`);
  console.log(`   已引用: ${usedFiles.size}`);
  console.log(`   未引用: ${unusedFiles.length}\n`);

  if (unusedFiles.length === 0) {
    console.log('✅ 没有发现未被引用的 manager 文件');
    return;
  }

  console.log('⚠️  可能未被引用的文件:');
  unusedFiles.forEach((filePath) => {
    console.log(`   - ${toProjectRelative(filePath)}`);
  });

  if (SHOW_DETAILS) {
    console.log('\n📋 已引用文件明细:');
    const usedList = Array.from(usedFiles).sort();
    usedList.forEach((filePath) => {
      const referrers = Array.from(usageDetails.get(filePath) || []).sort();
      console.log(`\n   ${toProjectRelative(filePath)}`);
      referrers.slice(0, 5).forEach((referrer) => {
        console.log(`     - ${referrer}`);
      });
      if (referrers.length > 5) {
        console.log(`     - ... 还有 ${referrers.length - 5} 处引用`);
      }
    });
  }

  if (DELETE_MODE) {
    console.log('\n🗑️  开始删除这些未被引用的文件...');

    let deletedCount = 0;
    const failedFiles = [];

    unusedFiles.forEach((filePath) => {
      if (removeFile(filePath)) {
        deletedCount += 1;
        console.log(`   ✅ 已删除: ${toProjectRelative(filePath)}`);
      } else {
        failedFiles.push(filePath);
        console.log(`   ❌ 删除失败: ${toProjectRelative(filePath)}`);
      }
    });

    console.log(`\n📦 删除完成: ${deletedCount}/${unusedFiles.length}`);

    if (failedFiles.length > 0) {
      console.log('⚠️  以下文件删除失败:');
      failedFiles.forEach((filePath) => {
        console.log(`   - ${toProjectRelative(filePath)}`);
      });
    }

    return;
  }

  console.log('\n💡 提示:');
  console.log('   1. 结果按“静态引用”分析，动态拼接路径仍可能漏判');
  console.log('   2. 默认不把测试文件当作引用来源，可加 --include-tests 再跑一遍');
  console.log('   3. 可用 --detail 查看已命中的引用来源');
  console.log('   4. 确认无误后，可加 --delete 删除这些文件');
}

analyzeManagerFiles();
