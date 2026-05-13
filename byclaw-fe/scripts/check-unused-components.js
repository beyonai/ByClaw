const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const COMPONENTS_DIR = path.join(PROJECT_ROOT, 'src/components');
const SCAN_DIRS = ['src'];
const FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.umi', 'coverage']);

const IGNORE_COMPONENTS = new Set([]);

function getAllComponentDirs() {
  const components = [];
  
  if (!fs.existsSync(COMPONENTS_DIR)) {
    console.error('❌ components 目录不存在');
    return components;
  }
  
  const items = fs.readdirSync(COMPONENTS_DIR);
  
  for (const item of items) {
    const itemPath = path.join(COMPONENTS_DIR, item);
    try {
      const stats = fs.statSync(itemPath);
      if (stats.isDirectory()) {
        const hasIndex = fs.existsSync(path.join(itemPath, 'index.tsx')) ||
                         fs.existsSync(path.join(itemPath, 'index.ts')) ||
                         fs.existsSync(path.join(itemPath, 'index.jsx')) ||
                         fs.existsSync(path.join(itemPath, 'index.js'));
        if (hasIndex) {
          components.push({
            name: item,
            path: itemPath,
          });
        }
      }
    } catch (err) {
      // Ignore errors
    }
  }
  
  return components;
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

function extractComponentImports(content, componentNames) {
  const imports = new Set();
  
  const patterns = [
    /from\s*['"](@\/components\/([^'"]+))['"]/g,
    /from\s*['"](@beyond\/components\/([^'"]+))['"]/g,
    /from\s*['"](\.\.?\/[^'"]*components\/([^'"]+))['"]/g,
    /import\s*\(\s*['"](@\/components\/([^'"]+))['"]\s*\)/g,
    /import\s*\(\s*['"](@beyond\/components\/([^'"]+))['"]\s*\)/g,
    /import\s*\(\s*['"](\.\.?\/[^'"]*components\/([^'"]+))['"]\s*\)/g,
  ];
  
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const importPath = match[1];
      for (const compName of componentNames) {
        if (importPath.includes(`/components/${compName}`) || 
            importPath.includes(`/components/${compName}/`) ||
            importPath.endsWith(`/components/${compName}`)) {
          imports.add(compName);
        }
      }
    }
  }
  
  const relativePatterns = [
    new RegExp(`from\\s*['"]\\.\\.\\/(${componentNames.join('|')})['"]`, 'g'),
    new RegExp(`from\\s*['"]\\.\\.\\/(${componentNames.join('|')})\\/`, 'g'),
    new RegExp(`from\\s*['"]\\.\\/(${componentNames.join('|')})['"]`, 'g'),
    new RegExp(`from\\s*['"]\\.\\/(${componentNames.join('|')})\\/`, 'g'),
    new RegExp(`import\\s*\\(\\s*['"]\\.\\.\\/(${componentNames.join('|')})['"]`, 'g'),
    new RegExp(`import\\s*\\(\\s*['"]\\.\\.\\/(${componentNames.join('|')})\\/`, 'g'),
  ];
  
  for (const regex of relativePatterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const matchedName = match[1];
      if (componentNames.includes(matchedName)) {
        imports.add(matchedName);
      }
    }
  }
  
  return imports;
}

function analyzeComponents() {
  console.log('📦 开始分析未使用的组件...\n');
  
  const allComponents = getAllComponentDirs();
  const componentNames = allComponents.map(c => c.name);
  
  console.log(`🔍 找到 ${allComponents.length} 个组件目录`);
  console.log('   组件列表:');
  allComponents.forEach(comp => {
    console.log(`   - ${comp.name}`);
  });
  console.log('');
  
  const usedComponents = new Set();
  const usageDetails = new Map();
  
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
        const imports = extractComponentImports(content, componentNames);
        imports.forEach(imp => {
          usedComponents.add(imp);
          const relativePath = path.relative(PROJECT_ROOT, file);
          if (!usageDetails.has(imp)) {
            usageDetails.set(imp, []);
          }
          usageDetails.get(imp).push(relativePath);
        });
        
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
  
  const unusedComponents = [];
  const usedComponentsList = [];
  
  for (const comp of allComponents) {
    if (IGNORE_COMPONENTS.has(comp.name)) {
      continue;
    }
    
    if (usedComponents.has(comp.name)) {
      usedComponentsList.push({
        name: comp.name,
        usages: usageDetails.get(comp.name) || []
      });
    } else {
      unusedComponents.push(comp.name);
    }
  }
  
  console.log('\n📊 扫描结果:');
  console.log(`   总组件数: ${allComponents.length}`);
  console.log(`   使用的组件: ${usedComponentsList.length}`);
  console.log(`   未使用的组件: ${unusedComponents.length}`);
  
  console.log('\n✅ 正在使用的组件:');
  if (usedComponentsList.length === 0) {
    console.log('   没有发现正在使用的组件！');
  } else {
    usedComponentsList.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
      console.log(`   ${item.name} (${item.usages.length} 处引用)`);
    });
  }
  
  console.log('\n⚠️  可能未使用的组件:');
  if (unusedComponents.length === 0) {
    console.log('   所有组件都在使用中！');
  } else {
    unusedComponents.sort().forEach(name => {
      console.log(`   ${name}`);
    });
  }
  
  return { unusedComponents, usedComponentsList };
}

function main() {
  const args = process.argv.slice(2);
  const showDetails = args.includes('--detail') || args.includes('-d');
  
  const { unusedComponents, usedComponentsList } = analyzeComponents();
  
  if (showDetails && usedComponentsList.length > 0) {
    console.log('\n📋 详细引用信息:');
    usedComponentsList.sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
      console.log(`\n   ${item.name}:`);
      item.usages.slice(0, 5).forEach(u => console.log(`     - ${u}`));
      if (item.usages.length > 5) {
        console.log(`     - ... 还有 ${item.usages.length - 5} 处引用`);
      }
    });
  }
  
  if (unusedComponents.length > 0) {
    console.log('\n💡 提示: 这些组件可能未被引用，请手动确认后再删除');
    console.log('   注意: 动态导入或特殊引用方式可能未被检测到');
    console.log('\n   使用 --detail 或 -d 参数查看详细的引用信息');
  }
  
  console.log('\n📝 分析完成！');
}

main();
