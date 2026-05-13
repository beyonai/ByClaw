const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const SRC_ASSETS_DIR = path.join(SRC_DIR, 'assets');
const RESOURCE_DIRS = [PUBLIC_DIR, SRC_ASSETS_DIR];
const SCAN_DIRS = ['src', 'config', 'public'];
const SOURCE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.vue', '.mjs', '.cjs', '.less', '.css', '.scss', '.sass', '.html', '.htm'];

const RESOURCE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.flac',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.json', '.xml', '.txt', '.md'
];

const IGNORE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.umi',
  '.umi-production',
  '.cache'
];

const IGNORE_FILES = new Set([
  'favicon.ico',
  'favicon.png',
  'favicon.svg',
  'logo.svg',
  'logo.png',
  'robots.txt',
  'manifest.json',
  '.DS_Store',
  'Thumbs.db'
]);

const IGNORE_PATTERNS = [
  /preview\/offices/,
  /dingdingLoginApp/,
  /dingdingLoginAppJzby/,
  /download\/index\.html/,
  /html\/registration\.html/,
  /locales/,
];

const DYNAMIC_REFERENCE_PATTERNS = [
  { pattern: /loginBg.*getLocale/, resources: ['beyond/loginBg.png', 'beyond/loginBg_en-US.png'] },
  { pattern: /avatar.*\$\{.*\}/, resources: [] },
  { pattern: /avatar.*\$\d+/, resources: [] },
];

function getAllResourceFiles(dir) {
  const files = [];

  function traverse(currentPath) {
    try {
      const stats = fs.statSync(currentPath);

      if (stats.isDirectory()) {
        const items = fs.readdirSync(currentPath);
        for (const item of items) {
          if (IGNORE_DIRS.includes(item)) continue;
          traverse(path.join(currentPath, item));
        }
      } else if (stats.isFile()) {
        const ext = path.extname(currentPath).toLowerCase();
        const basename = path.basename(currentPath);

        if (IGNORE_FILES.has(basename)) return;
        if (IGNORE_PATTERNS.some(pattern => pattern.test(currentPath))) return;

        if (RESOURCE_EXTENSIONS.includes(ext)) {
          files.push(currentPath);
        }
      }
    } catch (err) {
      // Ignore errors for inaccessible files
    }
  }

  traverse(dir);
  return files;
}

function getAllSourceFiles(dirs) {
  const files = [];

  for (const dir of dirs) {
    const fullPath = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(fullPath)) continue;

    function traverse(currentPath) {
      try {
        const stats = fs.statSync(currentPath);

        if (stats.isDirectory()) {
          const items = fs.readdirSync(currentPath);
          for (const item of items) {
            if (IGNORE_DIRS.includes(item)) continue;
            traverse(path.join(currentPath, item));
          }
        } else if (stats.isFile()) {
          const ext = path.extname(currentPath).toLowerCase();
          if (SOURCE_EXTENSIONS.includes(ext)) {
            files.push(currentPath);
          }
        }
      } catch (err) {
        // Ignore errors for inaccessible files
      }
    }

    traverse(fullPath);
  }

  return files;
}

function normalizeResourcePath(resourcePath) {
  let relativePath;

  if (resourcePath.startsWith(PUBLIC_DIR)) {
    relativePath = path.relative(PUBLIC_DIR, resourcePath);
  } else if (resourcePath.startsWith(SRC_ASSETS_DIR)) {
    relativePath = path.relative(SRC_DIR, resourcePath);
  } else {
    relativePath = path.relative(PROJECT_ROOT, resourcePath);
  }

  return relativePath.split(path.sep).join('/');
}

function extractResourceReferences(content, filePath) {
  const references = new Set();
  const ext = path.extname(filePath).toLowerCase();

  const stringLiteralRegex = /['"`]([^'"`]*\.(png|jpg|jpeg|gif|svg|webp|ico|bmp|mp4|webm|ogg|mp3|wav|flac|pdf|doc|docx|xls|xlsx|ppt|pptx|woff|woff2|ttf|eot|otf|json|xml|txt|md))['"`]/gi;
  let match;
  while ((match = stringLiteralRegex.exec(content)) !== null) {
    references.add(match[1]);
  }

  const urlRegex = /url\s*\(\s*['"`]?([^'"`\)]+)['"`]?\s*\)/gi;
  while ((match = urlRegex.exec(content)) !== null) {
    references.add(match[1]);
  }

  const srcRegex = /(?:src|href|data-src|data-href)\s*=\s*['"`]([^'"`]+)['"`]/gi;
  while ((match = srcRegex.exec(content)) !== null) {
    references.add(match[1]);
  }

  const dynamicPathRegex = /['"`]([^'"`]*)\$\{[^}]+\}([^'"`]*)['"`]/gi;
  while ((match = dynamicPathRegex.exec(content)) !== null) {
    references.add(match[1]);
    references.add(match[2]);
    references.add(match[1] + match[2]);
  }

  const templateLiteralRegex = /`([^`]*\.(png|jpg|jpeg|gif|svg|webp|ico|bmp|mp4|webm|ogg|mp3|wav|flac|pdf|doc|docx|xls|xlsx|ppt|pptx|woff|woff2|ttf|eot|otf)[^`]*)`/gi;
  while ((match = templateLiteralRegex.exec(content)) !== null) {
    const template = match[1];
    const baseMatch = template.match(/^([^$]*)/);
    if (baseMatch) {
      references.add(baseMatch[1]);
    }
  }

  const ternaryPathRegex = /\?\s*['"`]([^'"`]+)['"`]\s*:\s*['"`]([^'"`]+)['"`]/g;
  while ((match = ternaryPathRegex.exec(content)) !== null) {
    references.add(match[1]);
    references.add(match[2]);
  }

  const templateWithTernaryRegex = /`[^`]*\$\{[^}]*\?\s*['"`]([^'"`]+)['"`]\s*:\s*['"`]([^'"`]+)['"`][^}]*\}[^`]*`/g;
  while ((match = templateWithTernaryRegex.exec(content)) !== null) {
    const fullMatch = match[0];
    const afterTernaryMatch = fullMatch.match(/:\s*['"`]([^'"`]+)['"`][^}]*\}([^`]*)`$/);
    
    if (afterTernaryMatch) {
      const suffix = afterTernaryMatch[2];
      
      let prefix = '';
      const parts = fullMatch.split('${');
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const afterBrace = part.match(/\}([^]*)$/);
        if (afterBrace) {
          prefix += afterBrace[1];
        } else if (i > 0) {
          prefix += part;
        }
      }
      
      references.add(prefix + match[1] + suffix);
      references.add(prefix + match[2] + suffix);
    }
  }

  return references;
}

function normalizeReference(ref) {
  let normalized = ref;

  normalized = normalized.replace(/^~?@\/assets\//, 'assets/');
  normalized = normalized.replace(/^src\//, '');

  normalized = normalized.replace(/\.\.\//g, '');
  normalized = normalized.replace(/^\.\//, '');

  normalized = normalized.replace(/^public\//, '');

  normalized = normalized.replace(/^\/+/, '');

  return normalized;
}

function analyzeUnusedResources() {
  console.log('🔍 开始分析未使用的资源文件...\n');

  console.log('📂 扫描资源目录...');
  const resourceFiles = RESOURCE_DIRS.flatMap((dir) => {
    if (!fs.existsSync(dir)) return [];
    return getAllResourceFiles(dir);
  });
  console.log(`   找到 ${resourceFiles.length} 个资源文件\n`);

  console.log('📄 扫描源代码文件...');
  const sourceFiles = getAllSourceFiles(SCAN_DIRS);
  console.log(`   找到 ${sourceFiles.length} 个源文件\n`);

  console.log('🔎 提取资源引用...');
  const allReferences = new Set();
  const dynamicReferences = new Set();

  for (const file of sourceFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const refs = extractResourceReferences(content, file);
      for (const ref of refs) {
        const normalized = normalizeReference(ref);
        allReferences.add(normalized);
        allReferences.add(ref);
      }

      for (const { pattern, resources } of DYNAMIC_REFERENCE_PATTERNS) {
        if (pattern.test(content)) {
          resources.forEach(r => dynamicReferences.add(r));
        }
      }

      const avatarPatternMatch = content.match(/avatar\d+/gi);
      if (avatarPatternMatch) {
        avatarPatternMatch.forEach(m => dynamicReferences.add(m));
      }

      const toolPatternMatch = content.match(/tool\d+/gi);
      if (toolPatternMatch) {
        toolPatternMatch.forEach(m => dynamicReferences.add(m));
      }

    } catch (err) {
      // Ignore read errors
    }
  }

  console.log(`   提取到 ${allReferences.size} 个资源引用`);
  console.log(`   检测到 ${dynamicReferences.size} 个动态引用\n`);

  console.log('📊 分析未使用的资源...');
  const unusedResources = [];
  const usedResources = [];

  for (const resourcePath of resourceFiles) {
    const relativePath = normalizeResourcePath(resourcePath);
    const filename = path.basename(resourcePath);
    const filenameWithoutExt = path.basename(resourcePath, path.extname(resourcePath));

    let isUsed = false;

    for (const ref of allReferences) {
      const normalizedRef = normalizeReference(ref);
      
      if (normalizedRef === relativePath || ref === relativePath) {
        isUsed = true;
        break;
      }
      
      if (normalizedRef.endsWith('/' + relativePath) || ref.endsWith('/' + relativePath)) {
        isUsed = true;
        break;
      }
      
      if (normalizedRef.includes(relativePath) || ref.includes(relativePath)) {
        isUsed = true;
        break;
      }
      
      if (normalizedRef.endsWith('/' + filename) || ref.endsWith('/' + filename) || 
          normalizedRef === filename || ref === filename) {
        isUsed = true;
        break;
      }
    }

    if (!isUsed) {
      for (const dynRef of dynamicReferences) {
        if (relativePath.includes(dynRef) || filename.includes(dynRef)) {
          isUsed = true;
          break;
        }
      }
    }

    if (!isUsed) {
      try {
        const content = fs.readFileSync(resourcePath, 'utf-8');
        if (content.includes('export') || content.includes('module.exports') || content.includes('import')) {
          isUsed = true;
        }
      } catch (err) {
        // Not a text file or can't read
      }
    }

    if (isUsed) {
      usedResources.push({
        path: resourcePath,
        relativePath
      });
    } else {
      unusedResources.push({
        path: resourcePath,
        relativePath
      });
    }
  }

  console.log('\n✅ 正在使用的资源:');
  usedResources.forEach(res => {
    console.log(`   ${res.relativePath}`);
  });

  console.log(`\n⚠️  可能未使用的资源 (共 ${unusedResources.length} 个):`);
  if (unusedResources.length === 0) {
    console.log('   没有发现未使用的资源！');
  } else {
    unusedResources.forEach(res => {
      const stats = fs.statSync(res.path);
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(`   ${res.relativePath} (${sizeKB} KB)`);
    });

    const totalSize = unusedResources.reduce((sum, res) => {
      const stats = fs.statSync(res.path);
      return sum + stats.size;
    }, 0);
    console.log(`\n   总计可释放空间: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  }

  return { unusedResources, usedResources };
}

function deleteResources(resources) {
  if (resources.length === 0) {
    console.log('\n✨ 没有需要删除的资源。');
    return;
  }

  console.log('\n🗑️  准备删除以下资源:');
  resources.forEach(res => {
    console.log(`   - ${res.relativePath}`);
  });

  let deletedCount = 0;
  let failedCount = 0;

  for (const res of resources) {
    try {
      fs.unlinkSync(res.path);
      deletedCount++;
    } catch (err) {
      console.error(`   ❌ 删除失败: ${res.relativePath} - ${err.message}`);
      failedCount++;
    }
  }

  console.log(`\n✅ 成功删除 ${deletedCount} 个文件`);
  if (failedCount > 0) {
    console.log(`❌ 删除失败 ${failedCount} 个文件`);
  }
}

function askConfirmation(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const shouldDelete = args.includes('--delete') || args.includes('-d');
  const autoConfirm = args.includes('--yes') || args.includes('-y');
  const dryRun = args.includes('--dry-run');

  const { unusedResources, usedResources } = analyzeUnusedResources();

  if (unusedResources.length > 0) {
    if (dryRun) {
      console.log('\n📝 这是试运行模式，不会实际删除文件');
      console.log('   使用 --delete 参数删除未使用的资源');
      console.log('   使用 --delete --yes 参数自动确认删除');
    } else if (shouldDelete) {
      if (autoConfirm) {
        deleteResources(unusedResources);
      } else {
        console.log('\n💡 提示: 使用 --yes 或 -y 参数自动确认删除');
        console.log('   或使用 --dry-run 参数仅查看而不删除');
        const confirmed = await askConfirmation('\n是否确认删除以上资源? (y/N): ');
        if (confirmed) {
          deleteResources(unusedResources);
        } else {
          console.log('\n❌ 已取消删除操作');
        }
      }
    } else {
      console.log('\n💡 提示: 使用 --delete 或 -d 参数删除未使用的资源');
      console.log('   使用 --yes 或 -y 参数自动确认删除');
      console.log('   使用 --dry-run 参数仅查看而不删除');
      console.log('\n示例:');
      console.log('   npm run check-unused-assets -- --dry-run');
      console.log('   npm run check-unused-assets -- --delete');
      console.log('   npm run check-unused-assets -- --delete --yes');
    }
  }

  console.log('\n📝 分析完成！');
}

main().catch(console.error);
