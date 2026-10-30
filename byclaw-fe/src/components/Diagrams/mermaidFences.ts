/** 保留代码块原文及真实闭合状态，不能用流式 Markdown 的补闭合结果判断是否可绘图。 */
export function mermaidFences(text: string) {
  const blocks: Array<{ source: string; complete: boolean }> = [];
  let fence: string | undefined;
  let diagram = false;
  let lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!fence) {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^\s]*)/);
      if (match) {
        fence = match[1];
        diagram = /^(mermaid|mmd)$/i.test(match[2]);
        lines = [];
      }
    } else if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) {
      if (diagram) blocks.push({ source: lines.join('\n'), complete: true });
      fence = undefined;
    } else {
      lines.push(line);
    }
  }
  if (fence && diagram) blocks.push({ source: lines.join('\n'), complete: false });
  return blocks;
}
