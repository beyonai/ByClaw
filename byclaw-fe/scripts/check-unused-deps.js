const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');

const SCAN_DIRS = ['src'];
const FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.mjs', '.cjs']);

const IGNORE_DEPENDENCIES = new Set([
  '@types/node',
  '@types/react',
  '@types/react-dom',
  '@types/jest',
  '@types/lodash',
  '@types/mockjs',
  '@types/md5',
  '@types/js-cookie',
  '@types/formidable',
  '@types/jsonwebtoken',
  '@types/papaparse',
  '@types/react-infinite-scroller',
  '@types/react-lazylog',
  '@types/react-syntax-highlighter',
  '@types/request-ip',
  '@testing-library/jest-dom',
  '@testing-library/react',
  'jest',
  'jest-environment-jsdom',
  'typescript',
  'eslint',
  'eslint-config-next',
  'eslint-config-prettier',
  'prettier',
  'prettier-plugin-organize-imports',
  'prettier-plugin-packagejson',
  'husky',
  'lint-staged',
  'cross-env',
  'fs-extra',
  'glob',
  'chalk',
  'babel-loader',
  '@babel/parser',
  '@babel/traverse',
  'stylelint',
  'postcss-less',
  'ts-node',
  'identity-obj-proxy',
  '@umijs/fabric',
  'umi-plugin-keep-alive',
  'shiki',
  'react-router',
]);

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.umi', 'coverage']);

function readPackageJson() {
  const content = fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8');
  return JSON.parse(content);
}

function getAllFiles(dir) {
  const files = [];
  const stack = [dir];
  
  while (stack.length > 0) {
    const currentPath = stack.pop();
    
    try {
      const stats = fs.statSync(currentPath);
      
      if (stats.isDirectory()) {
        const items = fs.readdirSync(currentPath);
        for (const item of items) {
          if (IGNORE_DIRS.has(item)) continue;
          stack.push(path.join(currentPath, item));
        }
      } else if (stats.isFile()) {
        const ext = path.extname(currentPath);
        if (FILE_EXTENSIONS.has(ext)) {
          files.push(currentPath);
        }
      }
    } catch (err) {
      // Ignore errors
    }
  }
  
  return files;
}

function extractImports(content) {
  const imports = new Set();
  
  const patterns = [
    /import\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      imports.add(match[1]);
    }
  }
  
  return imports;
}

function normalizeImport(importPath) {
  if (!importPath || importPath.startsWith('.') || importPath.startsWith('/')) {
    return null;
  }
  
  const parts = importPath.split('/');
  if (importPath.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : importPath;
  }
  
  return parts[0];
}

function analyzeDependencies() {
  console.log('📦 开始分析未使用的依赖...\n');
  
  const packageJson = readPackageJson();
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const depNames = Object.keys(dependencies).filter(name => !IGNORE_DEPENDENCIES.has(name));
  
  const allImports = new Set();
  
  for (const dir of SCAN_DIRS) {
    const fullPath = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(fullPath)) continue;
    
    console.log(`🔍 扫描目录: ${dir}`);
    const files = getAllFiles(fullPath);
    console.log(`   找到 ${files.length} 个文件，正在分析...`);
    
    let processed = 0;
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const imports = extractImports(content);
        for (const imp of imports) {
          const normalized = normalizeImport(imp);
          if (normalized) {
            allImports.add(normalized);
          }
        }
        processed++;
        if (processed % 100 === 0) {
          process.stdout.write(`\r   已处理 ${processed}/${files.length} 个文件`);
        }
      } catch (err) {
        // Ignore errors
      }
    }
    console.log(`\r   已处理 ${processed}/${files.length} 个文件 ✓`);
  }
  
  console.log(`\n📊 扫描结果:`);
  console.log(`   总依赖数: ${Object.keys(dependencies).length}`);
  console.log(`   分析依赖数: ${depNames.length}`);
  console.log(`   使用的导入: ${allImports.size}`);
  
  const unusedDeps = [];
  const usedDeps = [];
  
  for (const depName of depNames) {
    let isUsed = false;
    
    if (allImports.has(depName)) {
      isUsed = true;
    } else {
      for (const imp of allImports) {
        if (imp === depName || imp.startsWith(depName + '/')) {
          isUsed = true;
          break;
        }
      }
    }
    
    if (isUsed) {
      usedDeps.push({ name: depName, version: dependencies[depName] });
    } else {
      unusedDeps.push({ name: depName, version: dependencies[depName] });
    }
  }
  
  console.log('\n✅ 正在使用的依赖:');
  usedDeps.forEach(dep => {
    console.log(`   ${dep.name}@${dep.version}`);
  });
  
  console.log('\n⚠️  可能未使用的依赖:');
  if (unusedDeps.length === 0) {
    console.log('   没有发现未使用的依赖！');
  } else {
    unusedDeps.forEach(dep => {
      console.log(`   ${dep.name}@${dep.version}`);
    });
  }
  
  return { unusedDeps, usedDeps };
}

function removeDependencies(depsToRemove) {
  if (depsToRemove.length === 0) {
    console.log('\n✨ 没有需要删除的依赖。');
    return;
  }
  
  console.log('\n🗑️  准备删除以下依赖:');
  depsToRemove.forEach(dep => console.log(`   - ${dep.name}`));
  
  const depNames = depsToRemove.map(d => d.name).join(' ');
  
  try {
    console.log('\n⏳ 正在执行删除命令...');
    execSync(`pnpm remove ${depNames}`, { 
      cwd: PROJECT_ROOT, 
      stdio: 'inherit' 
    });
    console.log('\n✅ 依赖删除成功！');
  } catch (error) {
    console.error('\n❌ 删除失败，尝试使用 npm...');
    try {
      execSync(`npm uninstall ${depNames}`, { 
        cwd: PROJECT_ROOT, 
        stdio: 'inherit' 
      });
      console.log('\n✅ 依赖删除成功！');
    } catch (npmError) {
      console.error('\n❌ 删除失败:', npmError.message);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const shouldDelete = args.includes('--delete') || args.includes('-d');
  const autoConfirm = args.includes('--yes') || args.includes('-y');
  
  const { unusedDeps, usedDeps } = analyzeDependencies();
  
  if (unusedDeps.length > 0) {
    console.log('\n💡 提示: 使用 --delete --yes 参数删除未使用的依赖');
    console.log('   示例: npm run check-deps -- --delete --yes');
    
    if (shouldDelete && autoConfirm) {
      removeDependencies(unusedDeps);
    }
  }
  
  console.log('\n📝 分析完成！');
}

main();
