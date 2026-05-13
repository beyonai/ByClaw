export function getNodesToHide(parentDom: HTMLElement): HTMLElement[] {
  if (!parentDom || !parentDom.parentNode) return [];
  const compType = parentDom.getAttribute('data-comptype');

  const siblings = Array.from(parentDom.parentNode.children) as HTMLElement[];
  const parentIndex = siblings.indexOf(parentDom);

  let siblingIndex = -1;
  for (let i = parentIndex + 1; i < siblings.length; i += 1) {
    if (siblings[i].getAttribute('data-comptype') === compType) {
      siblingIndex = i;
      break;
    }
  }
  if (siblingIndex > parentIndex + 1) {
    return siblings.slice(parentIndex + 1, siblingIndex);
  }
  if (siblingIndex === -1) {
    return siblings.slice(parentIndex + 1);
  }
  return [];
}

export function hideNodesBatch(nodesToHide: HTMLElement[], batchSize = 10) {
  let index = 0;
  function processBatch() {
    const end = Math.min(index + batchSize, nodesToHide.length);
    for (let i = index; i < end; i += 1) {
      nodesToHide[i].style.display = 'none';
    }
    index = end;
    if (index < nodesToHide.length) {
      requestAnimationFrame(processBatch);
    }
  }
  requestAnimationFrame(processBatch);
}

export function showNodesBatch(nodesToHide: HTMLElement[], batchSize = 10) {
  let index = 0;
  function processBatch() {
    const end = Math.min(index + batchSize, nodesToHide.length);
    for (let i = index; i < end; i += 1) {
      nodesToHide[i].style.display = 'block';
    }
    index = end;
    if (index < nodesToHide.length) {
      requestAnimationFrame(processBatch);
    }
  }
  requestAnimationFrame(processBatch);
}
