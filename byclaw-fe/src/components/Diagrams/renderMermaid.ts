let runtime: Promise<typeof import('mermaid')['default']> | undefined;
let sequence = 0;

/** 按需加载本地依赖；不允许图定义降低站点的安全级别。 */
export async function renderMermaid(source: string) {
  if (source.length > 50_000) throw new Error('Diagram exceeds preview limit');
  if (!runtime) {
    runtime = import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          maxTextSize: 50_000,
          maxEdges: 500,
          htmlLabels: false,
        });
        return mermaid;
      })
      .catch((error) => {
        runtime = undefined;
        throw error;
      });
  }
  const mermaid = await runtime;
  sequence += 1;
  return mermaid.render(`byai-mermaid-${sequence}`, source);
}
