#!/usr/bin/env node

/**
 * 检查 src/service/ 中未被引用的 export
 *
 * 用法: node scripts/check-unused-exports.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVICE_DIR = path.resolve(__dirname, '../src/service');
const SRC_DIR = path.resolve(__dirname, '../src');

// 收集 src/service/ 下所有 ts/tsx/js/jsx 文件（排除 __tests__）
function getServiceFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      results.push(...getServiceFiles(fullPath));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

// 从文件内容中提取所有 named export 的名称
function extractExports(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const exports = [];

  // export function xxx
  for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
    exports.push(m[1]);
  }

  // export const/let/var xxx
  for (const m of content.matchAll(/export\s+(?:const|let|var)\s+(\w+)/g)) {
    exports.push(m[1]);
  }

  // export class xxx
  for (const m of content.matchAll(/export\s+class\s+(\w+)/g)) {
    exports.push(m[1]);
  }

  // export type/interface xxx (skip these — type-only exports)
  // We still track them but mark them

  // export enum xxx
  for (const m of content.matchAll(/export\s+enum\s+(\w+)/g)) {
    exports.push(m[1]);
  }

  // export default — skip, hard to track by name

  return [...new Set(exports)];
}

// 用 ripgrep 检查某个 export 名称是否在 src/ 中被引用（排除定义文件本身）
function isExportUsed(exportName, definitionFile) {
  const relDef = path.relative(process.cwd(), definitionFile);
  try {
    // 搜索 import 语句中的引用 或 直接使用
    const result = execSync(
      `rg -l --type ts --type tsx --type js --type jsx "\\b${exportName}\\b" "${SRC_DIR}" 2>/dev/null || true`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const files = result.trim().split('\n').filter(Boolean);
    // 排除定义文件本身和 __tests__ 目录
    const consumers = files.filter((f) => {
      const rel = path.relative(process.cwd(), f);
      return rel !== relDef && !rel.includes('__tests__');
    });
    return consumers.length > 0;
  } catch {
    return false;
  }
}

// 备用方案：用 grep（兼容没有 rg 的环境）
function isExportUsedGrep(exportName, definitionFile) {
  const relDef = path.relative(process.cwd(), definitionFile);
  try {
    const result = execSync(
      `grep -rl --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" "\\b${exportName}\\b" "${SRC_DIR}" 2>/dev/null || true`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const files = result.trim().split('\n').filter(Boolean);
    const consumers = files.filter((f) => {
      const rel = path.relative(process.cwd(), f);
      return rel !== relDef && !rel.includes('__tests__');
    });
    return consumers.length > 0;
  } catch {
    return false;
  }
}

// 检测是否有 rg
function hasRg() {
  try {
    execSync('which rg', { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

// Main
function main() {
  const useRg = hasRg();
  const searchFn = useRg ? isExportUsed : isExportUsedGrep;

  const serviceFiles = getServiceFiles(SERVICE_DIR);
  const unused = [];
  let totalExports = 0;

  for (const file of serviceFiles) {
    const exports = extractExports(file);
    if (exports.length === 0) continue;

    const relFile = path.relative(process.cwd(), file);
    const fileUnused = [];

    for (const exp of exports) {
      totalExports++;
      if (!searchFn(exp, file)) {
        fileUnused.push(exp);
      }
    }

    if (fileUnused.length > 0) {
      unused.push({ file: relFile, exports: fileUnused });
    }
  }

  // 输出结果
  console.log('\n========================================');
  console.log(' src/service/ 未被引用的 export 检查结果');
  console.log('========================================\n');

  if (unused.length === 0) {
    console.log('✅ 所有 export 均被引用\n');
  } else {
    let totalUnused = 0;
    for (const item of unused) {
      console.log(`📄 ${item.file}`);
      for (const exp of item.exports) {
        console.log(`   ⚠️  ${exp}`);
        totalUnused++;
      }
      console.log('');
    }
    console.log('----------------------------------------');
    console.log(`总计: ${totalExports} 个 export, ${totalUnused} 个未被引用`);
    console.log('----------------------------------------\n');
  }
}

main();
