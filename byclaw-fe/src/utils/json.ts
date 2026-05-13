export function isJSON(str: string) {
  if (typeof str !== 'string') return false;

  try {
    const result = JSON.parse(str);
    const type = Object.prototype.toString.call(result);
    // 检查是否解析为对象或数组（可选）
    return type === '[object Object]' || type === '[object Array]';
  } catch (e) {
    return false;
  }
}
