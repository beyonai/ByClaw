import type { IMessage } from '@/typescript/message';

/** Tool results are durable message segments; final prose is not the image contract. */
export function structuredImagePaths(message: IMessage): string[] {
  const paths = new Set<string>();
  let budget = 1000;
  const visit = (value: unknown, depth: number) => {
    if (value === null || value === undefined || depth > 10 || --budget < 0) return;
    if (typeof value === 'string') {
      if (value.length > 1024 * 1024) return;
      try {
        visit(JSON.parse(value), depth + 1);
      } catch {
        return; // Legacy prose paths are extracted separately.
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.imageArtifacts)) {
      object.imageArtifacts.forEach((item) => {
        if (
          item?.schemaVersion === 1 &&
          typeof item.path === 'string' &&
          typeof item.id === 'string' &&
          /\.(png|jpe?g|webp)$/i.test(item.id) &&
          item.path.endsWith(`/image/${item.id}`)
        )
          paths.add(item.path);
      });
    }
    // Known transport envelopes only; never search arbitrary user prose for structured references.
    ['content', 'substance', 'output', 'text', 'result', 'orginContent'].forEach((key) =>
      visit(object[key], depth + 1)
    );
  };
  [...(message.messageList || []), ...(message.thinkList || [])].forEach((segment) => {
    budget = 1000;
    visit(segment, 0);
  });
  return Array.from(paths);
}
