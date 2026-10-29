export const versionFields: Record<string, string> = {
  resourceName: '名称',
  catalogId: '目录分类',
  openSuperHelper: '超级助手配置',
  resourceDesc: '描述',
  avatar: '头像',
  agentType: '员工类型',
  tags: '标签',
  sample: '示例',
  prologue: '模型与开场配置',
  corePersonaDefinition: '核心人设与提示词',
  ability: '能力',
  constraints: '能力边界',
  faqs: '常见问题',
  roleAttributes: '岗位职责',
  processingFlow: '处理流程',
  personalityDimensions: '性格',
  wordPreferences: '用词偏好',
  sentenceAndTone: '句式与语气',
  terminal: '终端',
  coreCompetencies: '核心能力',
  advancedSettings: '高级配置',
  ttsModelId: '语音模型',
  imageModelId: '图像模型',
  relPrompt: '运行提示词',
  relIds: '关联资源',
  relResourceInfoList: '关联资源配置',
  relTools: '工具',
  relSkills: '技能',
  employeeGroupMembers: '员工组成员',
};
const unordered = new Set(['relIds', 'relTools', 'relSkills', 'relResourceInfoList']);
const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)])
    );
  }
  return value;
};
export function displayValue(value: unknown, field = ''): string {
  if (value === null || value === undefined || value === '') return '未设置';
  let parsed = value;
  if (typeof value === 'string' && /^[{[]/.test(value.trim())) {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value;
    }
  }
  let canonical = normalize(parsed);
  if (Array.isArray(canonical) && unordered.has(field)) {
    canonical = canonical.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return typeof canonical === 'string' ? canonical : JSON.stringify(canonical, null, 2);
}
export function comparisonRows(left: Record<string, unknown>, right: Record<string, unknown>) {
  return Object.entries(versionFields).map(([key, label]) => {
    const before = displayValue(left[key], key);
    const after = displayValue(right[key], key);
    const changed = before !== after;
    const kind = !changed ? 'same' : before === '未设置' ? 'added' : after === '未设置' ? 'removed' : 'changed';
    return { key, label, before, after, changed, kind };
  });
}

/** 标记变化文本，保留共同前后文；不将用户提示词作为 HTML 渲染。 */
export function changedText(value: string, other: string) {
  let start = 0;
  let end = 0;
  while (start < Math.min(value.length, other.length) && value[start] === other[start]) start += 1;
  while (
    end < Math.min(value.length, other.length) - start &&
    value[value.length - end - 1] === other[other.length - end - 1]
  )
    end += 1;
  return [value.slice(0, start), value.slice(start, value.length - end), end ? value.slice(-end) : ''];
}
