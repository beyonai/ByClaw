import { agentTypeMap } from '@/constants/agent';
import { DOWNLOAD_PATH, UPLOAD_PATH } from './const';
import { getOpenClawWebSocket } from '@/utils/openClaw/openclawWebSocket';
import type { IAgentCache } from '@/typescript/agent';
import type { IQueryFile } from '@/typescript/file';

/**
 * 获取 openclaw 插件的 API 地址（http服务）
 * 从 WebSocket 的 ws(s) URL 解析出同源的 HTTP(S) 协议、host、port，拼出上传接口 base URL
 */
function getOpenClawPluginApiUrl(path: string) {
  const client = getOpenClawWebSocket();
  if (!client) return null;
  const wsUrl = client.getWsUrl();
  if (!wsUrl) return null;
  const originUrl = client.getOriginUrl();
  if (!originUrl) return null;
  const oUrl = new URL(originUrl);
  const realPort = oUrl.port;
  const realIp = oUrl.hostname;
  try {
    const u = new URL(wsUrl);
    const protocol = u.protocol === 'https:' || u.protocol === 'wss:' ? 'https:' : 'http:';
    const port = u.port || (protocol === 'https:' ? '443' : '80');
    const host = u.hostname;
    return `${protocol}//${host}:${port}${path}?port=${realPort}&ip=${realIp}`;
  } catch {
    return null;
  }
}

function getOpenClawPluginUploadUrl(): string | null {
  return getOpenClawPluginApiUrl(UPLOAD_PATH);
}

export interface UploadFileToOpenClawResult {
  paths: string[];
}

/**
 * 使用全局 openclaw WebSocket 的同一 host，通过 fetch 上传 FormData 到 /upload-file。
 * 仅当响应码为 200 时视为成功，成功时响应 JSON 格式为 { paths: string[] }。
 */
export async function uploadFileToOpenClaw(rawFile: File): Promise<Partial<IQueryFile>> {
  const formData = new FormData();
  formData.append('file', rawFile);

  const uploadUrl = getOpenClawPluginUploadUrl();

  if (!uploadUrl) {
    throw new Error('OpenClaw WebSocket 未初始化，无法获取上传地址');
  }

  const res = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  });
  if (res.status !== 200) {
    throw new Error(`上传失败: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as UploadFileToOpenClawResult;
  if (!json || !Array.isArray(json.paths)) {
    throw new Error('上传响应格式异常');
  }

  const path = json.paths?.[0];
  if (!path) {
    throw new Error('上传响应格式异常');
  }

  const queryFile: Partial<IQueryFile> = {
    fileId: 0,
    fileName: rawFile.name,
    fileUrl: path,
    length: rawFile.size,
    originFileName: rawFile.name,
    contentType: rawFile.type || '',
    uploadState: 'done',
    uploadDate: Date.now(),
  };

  return queryFile;
}

export function isOpenClawAgent(agentInfo?: IAgentCache) {
  return agentInfo?.agentType === agentTypeMap.openclaw;
}

const PROMPT_TAG_NAME = 'openclaw_file_context';

/**
 * 1. 生成提示词函数
 *
 * @param {string} userQuestion - 用户实际问的问题
 * @param {object} fileInfo - 文件信息对象 { name, size, path }
 * @returns {string} 拼接好的完整提示词
 */
export function generateFilePrompt(
  userQuestion: string,
  fileInfo: {
    fileName: string;
    filePath: string;
    fileSize: number;
  }
) {
  // 1. 构造给大模型的隐式指令（这部分在UI上不可见，但大模型能看到）
  // 我们将JSON和指令都放在标签内
  const hiddenBlock = [
    `<${PROMPT_TAG_NAME}>`,
    JSON.stringify(fileInfo),
    // eslint-disable-next-line quotes
    `\n[System Instruction: 请阅读上面JSON中指定的“filePath”处的本地文件，以回答用户的问题。filePath是一个相对路径，基于你的工作目录(.openClaw所在位置)]`,
    `</${PROMPT_TAG_NAME}>`,
  ].join('');

  // 2. 拼接：隐藏块 + 换行 + 用户问题
  return `${hiddenBlock}\n${userQuestion}`;
}

export function parseFilePrompt(fullPrompt: string) {
  // 构造正则：匹配 <tag>...内容...</tag>
  // [\s\S]*? 用于匹配包括换行符在内的所有字符，非贪婪模式
  const regex = new RegExp(`<${PROMPT_TAG_NAME}>([\\s\\S]*?)<\\/${PROMPT_TAG_NAME}>`, 'i');

  const match = fullPrompt.match(regex);

  // 默认返回结果
  const result = {
    userQuestion: fullPrompt, // 如果没找到文件标签，整个文本就是问题
    fileInfo: null,
  } as {
    userQuestion: string;
    fileInfo: {
      fileName: string;
      filePath: string;
      fileSize: number;
    } | null;
  };

  if (match) {
    // match[0] 是整个标签块（包括<tag>）
    // match[1] 是标签内部的内容
    const contextContent = match[1];

    // 1. 提取用户问题：将整个标签块从原字符串中移除，并去除首尾空白
    result.userQuestion = fullPrompt.replace(match[0], '').trim();

    // 2. 提取文件信息：尝试从标签内容中解析JSON
    try {
      // 这里的正则用于提取JSON部分（假设JSON是标签内第一段内容）
      // 也可以直接用 JSON.parse(contextContent.split('\n')[0]) 视具体生成逻辑而定
      // 为了稳健，我们查找第一个 '{' 和最后一个 '}'
      const jsonStartIndex = contextContent.indexOf('{');
      const jsonEndIndex = contextContent.lastIndexOf('}');

      if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
        const jsonStr = contextContent.substring(jsonStartIndex, jsonEndIndex + 1);
        const parsedData = JSON.parse(jsonStr);

        // 映射回业务需要的字段
        result.fileInfo = parsedData;
      }
    } catch (e) {
      console.error('OpenClaw Prompt Parsing Error: Invalid JSON in context', e);
      // 解析失败时，fileInfo 保持为 null
    }
  }

  return result;
}

export function getDownloadOpenClawFileUrl(filePath: string) {
  return `${getOpenClawPluginApiUrl(DOWNLOAD_PATH)}&path=${filePath}`;
}
