const path = require('path');
const fs = require('fs');
const fsExtra = require('fs-extra');

const { join } = path;
const { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } = fs;
const { copySync, removeSync } = fsExtra;

const replace = (fullPath, source, target) => {
  const content = readFileSync(fullPath, 'utf8');
  if (content.indexOf(source) > -1) {
    let newContent = content.replace(new RegExp(source, 'gm'), target);
    newContent = newContent.replace(new RegExp('"antd"', 'gm'), '"antd5"');
    writeFileSync(fullPath, newContent);
  }
};

const readFileList = (dir, source, target) => {
  const files = readdirSync(dir);
  files.forEach(filename => {
    const fullPath = join(dir, filename);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      readFileList(join(dir, filename), source, target); //递归读取文件
    }
    if (stat.isFile()) {
      if (
        filename.endsWith('.js') ||
        filename.endsWith('.jsx') ||
        filename.endsWith('.ts') ||
        filename.endsWith('.tsx')
      ) {
        replace(fullPath, `${source}`, `${target}`);
      }
    }
  });
};

module.exports = (api) => {
  const { paths } = api;
  const { absSrcPath, cwd } = paths;
  // 依赖工程和路径
  const projectName = '3ddemo';
  const dependSourcePath = [
    // 'src/components/human',
    'src/components/fetch-event-source',
    'src/components/chatting',
    'src/metabot',
    'src/utils/varUtils.ts',
    'src/utils/request.ts',
    'src/utils/const.ts',
    'src/utils/command.ts',
    'src/services/login/tokenHandler.ts',
    // 'public/actions/mixamo',
    // 'public/models/default.glb',
    // 'public/js/draco',
    // 'public/actions',
    // 'public/models',
    // 'public/images',
  ];

  // 拉取依赖统一命名
  const dependCatName = 'depend';
  const dependSrcPath = join(absSrcPath, dependCatName);

  let hasError = false;
  if (existsSync(join(cwd, `../${projectName}`))) {
    dependSourcePath.forEach(module => {
      // 迁移到对应目录
      const [parentCat, ...resPathArr] = module.split('/');
      const resPath = resPathArr.join('/');
      const dependTargetPath = join(absSrcPath, `../${parentCat}/${dependCatName}`);
      if (!existsSync(dependTargetPath)) {
        mkdirSync(dependTargetPath, {recursive: true});
      }
      try {
        const from = join(cwd, `../${projectName}/${module}`);
        const to = join(dependTargetPath, `/${resPath}`);
        removeSync(to);
        copySync(from, to);
      } catch (err) {
        console.error(err);
  
        hasError = true;
      }
    });
  }
  if (hasError) {
    return;
  }
  // depend静态路径，vite下变量获取兼容
  readFileList(dependSrcPath, 'const { BASE_URL } = import.meta.env;', 'const BASE_URL = `${window.publicPath}depend`;');
  console.log('依赖模块搬迁代码成功');
};
