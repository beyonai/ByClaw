const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const getArgvOptions = require('../getArgvOptions');

function formatDateTime(date: Date) {
  const year = date.getFullYear(); // 获取年份
  const month = (date.getMonth() + 1).toString().padStart(2, '0'); // 获取月份，月份从0开始，所以+1，并确保两位数字
  const day = date.getDate().toString().padStart(2, '0'); // 获取日期，并确保两位数字
  const hour = date.getHours().toString().padStart(2, '0'); // 获取小时，并确保两位数字
  const minute = date.getMinutes().toString().padStart(2, '0'); // 获取分钟，并确保两位数字
  const second = date.getSeconds().toString().padStart(2, '0'); // 获取秒数，并确保两位数字
  // 构造格式化的日期时间字符串
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * 获取Git信息
 */
function getGitInfo() {
  const info = {
    branch: '',           // 分支名
    commitDate: '',       // 提交日期
    buildDate: formatDateTime(new Date()) // 构建日期
  };

  try {
    // 获取分支名
    info.branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    
    // 获取提交日期
    info.commitDate = execSync('git log -1 --pretty=format:%cd').toString().trim();
    
  } catch (error) {
    console.error(`获取Git信息出错: ${error}`);
  }

  return info;
}

/**
 * 生成版本信息文件
 */
function generateVersionFile(api: any, customBranch: string | undefined) {
  const publicDir = path.join(api.cwd, 'public');
  const filePath = path.join(publicDir, 'version.txt');
  
  // 确保public目录存在
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  
  // 获取Git信息
  const gitInfo = getGitInfo();
  if (customBranch) {
    gitInfo.branch = customBranch;
  }
  
  // 写入版本信息
  const content = JSON.stringify(gitInfo, null, 2);
  fs.writeFileSync(filePath, content);
  console.log(`版本信息已写入: ${filePath}`);
}

module.exports = (api: any) => {
  const argvOptions = getArgvOptions();
  const { branch } = argvOptions;
  
  // 在初始化时生成版本信息
  api.onStart(() => {
    generateVersionFile(api, branch);
  });
  
  // 在构建完成后也生成版本信息（确保构建输出也有）
  api.onBuildComplete(() => {
    const { absOutputPath } = api.paths;
    const gitInfo = getGitInfo();
    if (branch) {
      gitInfo.branch = branch;
    }
    
    // 将版本信息写入构建输出目录
    const filePath = path.join(absOutputPath, 'version.txt');
    const content = JSON.stringify(gitInfo, null, 2);
    fs.writeFileSync(filePath, content);
    console.log(`版本信息已写入: ${filePath}`);
  });
};
