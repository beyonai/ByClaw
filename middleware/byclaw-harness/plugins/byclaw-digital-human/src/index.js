import { DEFAULT_CONFIG_PATH, readConfiguration } from './config.js';
import { uploadMedia } from './oss.js';
import { invoke, MODES } from './volcengine.js';

export const name = 'byclaw-digital-human';
export const inject = ['tools', 'fs'];
const mode = { type: 'string', enum: Object.keys(MODES), description: '驱动模式：normal 普通、loopy 灵动、loopyb 大画幅灵动。创建形象、生成视频与查询须使用同一模式。' };
const id = (description) => ({ type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9_-]+$', description });
const url = (description) => ({ type: 'string', minLength: 1, maxLength: 4096, description });
const output = {
  schema: {
    type: 'object', required: ['stage', 'mode', 'taskId', 'status'], additionalProperties: false,
    properties: {
      stage: { type: 'string', enum: ['role', 'video'] }, mode,
      taskId: { type: 'string' }, status: { type: 'string', enum: ['submitted', 'in_queue', 'generating', 'done', 'not_found', 'expired'] },
      requestId: { type: 'string' }, resourceId: { type: 'string' },
      videoUrls: { type: 'array', items: { type: 'string' } },
      pollAfterSeconds: { type: 'integer' }, urlValidForSeconds: { type: 'integer' },
    },
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

const definitions = [
  ['role', false, 'digital_human_create_role', '用户要求创建数字人形象时调用，产生供应商费用。使用清晰无遮挡的单人正脸。图片 URL 与本地路径二选一；本地图片会上传到 OSS 并设为公开读。仅提交，用 digital_human_get_role 查询；勿因超时重复提交。', {}],
  ['role', true, 'digital_human_get_role', '查询形象创建任务；完成后返回可复用的 resourceId。使用提交时的模式；排队或处理中按 pollAfterSeconds 等待后再查。任务过期或失败不自动重新提交，不产生新的形象创建任务。', { taskId: id('形象创建接口返回的任务 ID。') }],
  ['video', false, 'digital_human_create_video', '用现有形象和音频提交视频生成，产生供应商费用。须用形象创建时的模式。普通音频最长180秒；灵动宠物90秒、真人180秒；大画幅45秒且不支持宠物。音频 URL 与本地路径二选一；本地音频会上传到 OSS 并设为公开读。用 digital_human_get_video 查询；勿因超时重复提交。', { resourceId: id('同一账号、同一驱动模式创建并查询成功的形象 ID。') }],
  ['video', true, 'digital_human_get_video', '查询视频生成任务；完成后返回视频 URL，有效期约1小时。使用提交时的模式；处理中按 pollAfterSeconds 等待后再查。仅提交或处理中不能声称生成成功；不会下载视频，也不会自动重新提交任务。', { taskId: id('视频生成接口返回的任务 ID。') }],
];

export function apply(ctx, config = {}) {
  // This is a deployment-controlled path, never a model-visible tool argument or credential source.
  if (Object.keys(config).some((key) => key !== 'configPath') || (config.configPath !== undefined
    && (typeof config.configPath !== 'string' || !config.configPath.startsWith('/') || /[\u0000-\u001f]/u.test(config.configPath)))) {
    throw new Error('DIGITAL_HUMAN_INVALID_PLUGIN_CONFIG');
  }
  for (const [stage, query, toolName, description, fields] of definitions) {
    const properties = { mode, ...fields };
    const required = Object.keys(properties);
    const kind = stage === 'role' ? 'image' : 'audio';
    const urlField = `${kind}Url`;
    const pathField = `${kind}Path`;
    if (!query) {
      const label = kind === 'image' ? '图片' : '音频';
      const formats = kind === 'image' ? 'JPG/PNG' : 'MP3/WAV';
      properties[urlField] = url(`火山可访问的${label} HTTP(S) URL，与 ${pathField} 二选一。`);
      properties[pathField] = url(`会话工作区内的${label}文件路径（${formats}），与 ${urlField} 二选一。上传 OSS 后公开可读。`);
    }
    ctx.effect(() => ctx.tools.register({
      name: toolName, description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
      output,
      async execute(args, exec = {}) {
        // Validate again for callers outside the registry; fail before credential access or network IO.
        if (!args || typeof args !== 'object' || Array.isArray(args) || required.some((key) => !Object.hasOwn(args, key))) {
          throw new Error('DIGITAL_HUMAN_INVALID_ARGUMENT');
        }
        for (const [key, value] of Object.entries(args)) {
          const field = Object.hasOwn(properties, key) ? properties[key] : undefined;
          if (!field || typeof value !== 'string' || !value.trim() || value.length > (field.maxLength ?? Infinity)
            || (field.enum && !field.enum.includes(value)) || (field.pattern && !new RegExp(field.pattern, 'u').test(value))) {
            throw new Error('DIGITAL_HUMAN_INVALID_ARGUMENT');
          }
        }
        const local = Object.hasOwn(args, pathField);
        if (!query && local === Object.hasOwn(args, urlField)) {
          throw new Error(`DIGITAL_HUMAN_INVALID_ARGUMENT: ${urlField} 与 ${pathField} 必须二选一。`);
        }
        const fs = ctx.get('fs');
        const credentials = await readConfiguration(fs, config.configPath ?? DEFAULT_CONFIG_PATH, exec.signal);
        const request = local ? { ...args, [urlField]: await uploadMedia(fs, exec.agent?.session?.header?.cwd, args[pathField], kind, exec.signal) } : args;
        return invoke(credentials, stage, args.mode, request, query, exec.signal);
      },
    }));
  }
  ctx.effect(() => ctx.tools.register({
    name: 'digital_human_check_configuration',
    description: '检查数字人连接器配置能否通过当前文件系统读取及本地格式校验。只读，不请求火山、不产生费用、不返回凭据；ready 不代表账号权限或服务调用已验证。失败返回安全的阶段和原因。',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: {
      schema: { type: 'object', required: ['status'], additionalProperties: false, properties: {
        status: { type: 'string', enum: ['ready', 'configuration_required'] },
        stage: { type: 'string' }, reason: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec = {}) {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error('DIGITAL_HUMAN_INVALID_ARGUMENT');
      try {
        await readConfiguration(ctx.get('fs'), config.configPath ?? DEFAULT_CONFIG_PATH, exec.signal);
        return { status: 'ready' };
      } catch (error) {
        exec.signal?.throwIfAborted();
        if (error?.code !== 'DIGITAL_HUMAN_CONFIGURATION_REQUIRED') throw error;
        return { status: 'configuration_required', stage: error.stage, reason: error.reason };
      }
    },
  }));
}
