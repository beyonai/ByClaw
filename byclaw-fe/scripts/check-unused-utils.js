const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const UTILS_DIR = path.join(PROJECT_ROOT, 'src/utils');
const SCAN_DIRS = ['src'];
const FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.umi', 'coverage']);

const IGNORE_FILES = new Set([
  'index.ts',
  'polyfill.ts',
]);

function getAllUtilsFiles() {
  const files = [];
  
  if (!fs.existsSync(UTILS_DIR)) {
    console.error('❌ utils 目录不存在');
    return files;
  }
  
  const stack = [UTILS_DIR];
  
  while (stack.length > 0) {
    const currentPath = stack.pop();
    const items = fs.readdirSync(currentPath);
    
    for (const item of items) {
      const itemPath = path.join(currentPath, item);
      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
        if (!IGNORE_DIRS.has(item)) {
          stack.push(itemPath);
        }
      } else if (stats.isFile()) {
        const ext = path.extname(item);
        if (FILE_EXTENSIONS.has(ext) && !IGNORE_FILES.has(item)) {
          files.push(itemPath);
        }
      }
    }
  }
  
  return files;
}

function extractExports(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const exports = [];
  const relativePath = path.relative(PROJECT_ROOT, filePath);
  
  const exportDefaultFunctionPattern = /export\s+default\s+(?:async\s+)?function\s+(\w+)/g;
  let match;
  while ((match = exportDefaultFunctionPattern.exec(content)) !== null) {
    exports.push({ name: match[1], type: 'default', usedInFile: false });
  }
  
  const exportDefaultClassPattern = /export\s+default\s+class\s+(\w+)/g;
  while ((match = exportDefaultClassPattern.exec(content)) !== null) {
    exports.push({ name: match[1], type: 'default', usedInFile: false });
  }
  
  const exportDefaultAnonymousPattern = /export\s+default\s+(?:async\s+)?function\s*\(/g;
  if (exportDefaultAnonymousPattern.test(content)) {
    const fileBaseName = path.basename(filePath, path.extname(filePath));
    if (!exports.some(e => e.name === fileBaseName)) {
      exports.push({ name: fileBaseName, type: 'default', usedInFile: false });
    }
  }
  
  const exportDefaultExprPattern = /export\s+default\s+(\w+)\s*[,;\n]/g;
  while ((match = exportDefaultExprPattern.exec(content)) !== null) {
    if (!exports.some(e => e.name === match[1])) {
      exports.push({ name: match[1], type: 'default', usedInFile: false });
    }
  }
  
  const exportFunctionPattern = /(?<!export\s+default\s)export\s+(?:async\s+)?function\s+(\w+)/g;
  while ((match = exportFunctionPattern.exec(content)) !== null) {
    if (!exports.some(e => e.name === match[1])) {
      exports.push({ name: match[1], type: 'function', usedInFile: false });
    }
  }
  
  const exportConstPattern = /export\s+(?:const|let|var)\s+(\w+)\s*=/g;
  while ((match = exportConstPattern.exec(content)) !== null) {
    if (!match[1].startsWith('_') && !exports.some(e => e.name === match[1])) {
      exports.push({ name: match[1], type: 'const', usedInFile: false });
    }
  }
  
  const exportClassPattern = /(?<!export\s+default\s)export\s+class\s+(\w+)/g;
  while ((match = exportClassPattern.exec(content)) !== null) {
    if (!exports.some(e => e.name === match[1])) {
      exports.push({ name: match[1], type: 'class', usedInFile: false });
    }
  }
  
  const exportTypePattern = /export\s+type\s+(\w+)/g;
  while ((match = exportTypePattern.exec(content)) !== null) {
    if (!exports.some(e => e.name === match[1])) {
      exports.push({ name: match[1], type: 'type', usedInFile: false });
    }
  }
  
  const exportInterfacePattern = /export\s+interface\s+(\w+)/g;
  while ((match = exportInterfacePattern.exec(content)) !== null) {
    if (!exports.some(e => e.name === match[1])) {
      exports.push({ name: match[1], type: 'interface', usedInFile: false });
    }
  }
  
  const exportFromPattern = /export\s*\{([^}]+)\}\s*from/g;
  while ((match = exportFromPattern.exec(content)) !== null) {
    const names = match[1].split(',').map(n => n.trim().split(' as ')[0].trim());
    names.forEach(name => {
      if (name && !name.startsWith('_') && !exports.some(e => e.name === name)) {
        exports.push({ name, type: 'reexport', usedInFile: false });
      }
    });
  }
  
  const exportPattern = /export\s*\{([^}]+)\}/g;
  while ((match = exportPattern.exec(content)) !== null) {
    const names = match[1].split(',').map(n => n.trim().split(' as ')[0].trim());
    names.forEach(name => {
      if (name && !name.startsWith('_') && !exports.some(e => e.name === name)) {
        exports.push({ name, type: 'named', usedInFile: false });
      }
    });
  }
  
  for (const exp of exports) {
    const name = exp.name;
    const patterns = [
      new RegExp(`\\b${name}\\b`, 'g'),
    ];
    
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 1) {
        exp.usedInFile = true;
        break;
      }
    }
  }
  
  return { file: relativePath, exports };
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

function extractImportedNames(content) {
  const importedNames = new Set();
  
  const namedImportPattern = /import\s*\{([^}]+)\}\s*from/g;
  let match;
  while ((match = namedImportPattern.exec(content)) !== null) {
    const names = match[1].split(',').map(n => n.trim().split(' as ')[0].trim());
    names.forEach(name => {
      if (name && !name.startsWith('_')) {
        importedNames.add(name);
      }
    });
  }
  
  const defaultImportPattern = /import\s+(\w+)\s*,?\s*(?:\{[^}]*\})?\s*from/g;
  while ((match = defaultImportPattern.exec(content)) !== null) {
    if (match[1] && !match[1].startsWith('_')) {
      importedNames.add(match[1]);
    }
  }
  
  const namespaceImportPattern = /import\s*\*\s*as\s+(\w+)\s*from/g;
  while ((match = namespaceImportPattern.exec(content)) !== null) {
    if (match[1]) {
      importedNames.add(match[1]);
    }
  }
  
  return importedNames;
}

function analyzeUtils() {
  console.log('📦 开始分析未使用的 utils 文件和方法...\n');
  
  const utilsFiles = getAllUtilsFiles();
  console.log(`🔍 找到 ${utilsFiles.length} 个 utils 文件\n`);
  
  const utilsExports = [];
  const fileExportsMap = new Map();
  
  for (const file of utilsFiles) {
    const result = extractExports(file);
    utilsExports.push(result);
    fileExportsMap.set(result.file, result.exports.map(e => e.name));
    
    console.log(`📄 ${result.file}`);
    if (result.exports.length > 0) {
      result.exports.forEach(e => console.log(`   - ${e.name} (${e.type})`));
    } else {
      console.log('   (无导出)');
    }
  }
  
  console.log('\n🔍 扫描项目中的引用...\n');
  
  const usedFiles = new Set();
  const usedNames = new Set();
  
  for (const dir of SCAN_DIRS) {
    const fullPath = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(fullPath)) continue;
    
    const files = getAllFiles(fullPath);
    console.log(`   扫描 ${dir}: ${files.length} 个文件`);
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        
        const imports = extractImports(content);
        imports.forEach(imp => {
          if (imp.includes('@/utils/') || imp.includes('../utils/') || imp.includes('./utils/')) {
            let utilPath = imp;
            if (imp.includes('@/utils/')) {
              utilPath = imp.split('@/utils/')[1];
            } else if (imp.includes('../utils/')) {
              utilPath = imp.split('../utils/')[1];
            } else if (imp.includes('./utils/')) {
              utilPath = imp.split('./utils/')[1];
            }
            utilPath = utilPath.split('.')[0];
            usedFiles.add(utilPath);
            
            const utilName = utilPath.split('/').pop();
            usedFiles.add(utilName);
          }
        });
        
        const names = extractImportedNames(content);
        names.forEach(name => usedNames.add(name));
      } catch (err) {
        // Ignore errors
      }
    }
  }
  
  console.log('\n📊 分析结果:\n');
  
  const unusedFiles = [];
  const unusedExports = [];
  
  for (const result of utilsExports) {
    const fileName = path.basename(result.file, path.extname(result.file));
    const relativePath = result.file;
    const dirName = path.dirname(relativePath).replace('src/utils/', '').replace('src/utils', '');
    const fullPath = dirName ? `${dirName}/${fileName}` : fileName;
    
    const isFileUsed = usedFiles.has(fileName) || 
                       usedFiles.has(fullPath) ||
                       usedNames.has(fileName) ||
                       result.exports.some(e => usedNames.has(e.name) || e.usedInFile);
    
    if (!isFileUsed && result.exports.length > 0) {
      unusedFiles.push({
        file: relativePath,
        exports: result.exports
      });
    }
    
    const fileUnusedExports = [];
    for (const exp of result.exports) {
      if (!usedNames.has(exp.name) && !exp.usedInFile) {
        fileUnusedExports.push(exp);
      }
    }
    
    if (fileUnusedExports.length > 0 && isFileUsed) {
      unusedExports.push({
        file: relativePath,
        exports: fileUnusedExports
      });
    }
  }
  
  console.log('⚠️  可能未使用的文件:');
  if (unusedFiles.length === 0) {
    console.log('   所有文件都有被引用！');
  } else {
    unusedFiles.forEach(f => {
      console.log(`   ${f.file}`);
      f.exports.forEach(e => console.log(`     - ${e.name}`));
    });
  }
  
  console.log('\n⚠️  部分方法未使用的文件:');
  if (unusedExports.length === 0) {
    console.log('   所有导出方法都有被引用！');
  } else {
    unusedExports.forEach(f => {
      console.log(`   ${f.file}`);
      f.exports.forEach(e => console.log(`     - ${e.name} (${e.type})`));
    });
  }
  
  console.log('\n💡 提示: 这些文件/方法可能未被引用，请手动确认后再删除');
  console.log('   注意: 动态导入、字符串引用或特殊引用方式可能未被检测到');
  console.log('\n📝 分析完成！');
  
  return { unusedFiles, unusedExports };
}

analyzeUtils();
