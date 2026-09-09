export interface ScopedProjectionState {
  projection: Record<string, any>;
  streamId?: string;
}

interface ScopedProjectionOperation {
  field: string;
  op: 'append' | 'json-array-splice' | 'json-patch' | 'set' | 'remove';
  offset?: number;
  index?: number;
  deleteCount?: number;
  value?: any;
  patches?: ScopedJsonPatch[];
}

interface ScopedJsonPatch {
  op: 'append' | 'set' | 'remove' | 'splice';
  path: Array<string | number>;
  offset?: number;
  index?: number;
  deleteCount?: number;
  value?: any;
}

const unsafeFields = new Set(['__proto__', 'constructor', 'prototype']);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const isSafePath = (path: unknown): path is Array<string | number> =>
  Array.isArray(path) &&
  path.every(
    (part) =>
      (typeof part === 'number' && Number.isInteger(part) && part >= 0) ||
      (typeof part === 'string' && !unsafeFields.has(part))
  );

const getJsonValue = (root: any, path: Array<string | number>): { found: boolean; value?: any } => {
  let current = root;
  for (const part of path) {
    if (current === null || typeof current !== 'object') return { found: false };
    if (Array.isArray(current)) {
      if (typeof part !== 'number' || part >= current.length) return { found: false };
    } else if (typeof part !== 'string' || !Object.prototype.hasOwnProperty.call(current, part)) {
      return { found: false };
    }
    current = current[part];
  }
  return { found: true, value: current };
};

const mutateJsonValue = (root: any, patch: ScopedJsonPatch): { applied: boolean; root: any } => {
  if (!isSafePath(patch.path)) return { applied: false, root };

  if (patch.op === 'append' || patch.op === 'splice') {
    const target = getJsonValue(root, patch.path);
    if (!target.found) return { applied: false, root };
    if (patch.op === 'append') {
      if (typeof target.value !== 'string' || patch.offset !== target.value.length || typeof patch.value !== 'string') {
        return { applied: false, root };
      }
      return mutateJsonValue(root, { ...patch, op: 'set', value: target.value + patch.value });
    }
    if (!Array.isArray(target.value) || !Array.isArray(patch.value)) return { applied: false, root };
    if (
      !Number.isInteger(patch.index) ||
      !Number.isInteger(patch.deleteCount) ||
      patch.index! < 0 ||
      patch.deleteCount! < 0 ||
      patch.index! + patch.deleteCount! > target.value.length
    ) {
      return { applied: false, root };
    }
    target.value.splice(patch.index!, patch.deleteCount!, ...clone(patch.value));
    return { applied: true, root };
  }

  if (patch.path.length === 0) {
    return patch.op === 'set' ? { applied: true, root: clone(patch.value) } : { applied: false, root };
  }

  const parentPath = patch.path.slice(0, -1);
  const key = patch.path[patch.path.length - 1];
  const parentResult = getJsonValue(root, parentPath);
  const parent = parentResult.value;
  if (!parentResult.found || parent === null || typeof parent !== 'object') return { applied: false, root };

  if (Array.isArray(parent)) {
    if (typeof key !== 'number' || key >= parent.length) return { applied: false, root };
    if (patch.op === 'remove') parent.splice(key, 1);
    else if (patch.op === 'set') parent[key] = clone(patch.value);
    else return { applied: false, root };
    return { applied: true, root };
  }

  if (typeof key !== 'string') return { applied: false, root };
  if (patch.op === 'remove') {
    if (!Object.prototype.hasOwnProperty.call(parent, key)) return { applied: false, root };
    delete parent[key];
  } else if (patch.op === 'set') {
    parent[key] = clone(patch.value);
  } else {
    return { applied: false, root };
  }
  return { applied: true, root };
};

const applyJsonPatches = (serialized: unknown, patches: unknown): string | null => {
  if (typeof serialized !== 'string' || !Array.isArray(patches) || patches.length === 0) return null;
  try {
    let root = JSON.parse(serialized);
    if (root === null || typeof root !== 'object') return null;
    for (const patch of patches as ScopedJsonPatch[]) {
      if (!patch || !['append', 'set', 'remove', 'splice'].includes(patch.op)) return null;
      const result = mutateJsonValue(root, patch);
      if (!result.applied) return null;
      root = result.root;
    }
    return JSON.stringify(root);
  } catch {
    return null;
  }
};

export const applyScopedProjectionDelta = (
  state: ScopedProjectionState,
  envelope: any
): ScopedProjectionState | null => {
  const payload = envelope?.data;
  if (!payload || `${payload.baseStreamId || ''}` !== `${state.streamId || ''}`) return null;
  if (payload.sessionId && `${payload.sessionId}` !== `${state.projection.sessionId || ''}`) return null;
  if (payload.messageId && `${payload.messageId}` !== `${state.projection.messageId || ''}`) return null;
  if (!Array.isArray(payload.operations)) return null;

  const projection = clone(state.projection);
  for (const operation of payload.operations as ScopedProjectionOperation[]) {
    const field = operation?.field;
    if (!field || unsafeFields.has(field)) return null;
    if (operation.op === 'remove') {
      delete projection[field];
      continue;
    }
    if (operation.op === 'set') {
      projection[field] = clone(operation.value);
      continue;
    }
    if (operation.op === 'append') {
      const current = projection[field];
      if (typeof current !== 'string' || operation.offset !== current.length || typeof operation.value !== 'string') {
        return null;
      }
      projection[field] = current + operation.value;
      continue;
    }
    if (operation.op === 'json-array-splice') {
      if (typeof projection[field] !== 'string' || !Array.isArray(operation.value)) return null;
      const index = operation.index;
      const deleteCount = operation.deleteCount;
      if (!Number.isInteger(index) || !Number.isInteger(deleteCount) || index! < 0 || deleteCount! < 0) return null;
      try {
        const array = JSON.parse(projection[field]);
        if (!Array.isArray(array) || index! + deleteCount! > array.length) return null;
        array.splice(index!, deleteCount!, ...clone(operation.value));
        projection[field] = JSON.stringify(array);
      } catch {
        return null;
      }
      continue;
    }
    if (operation.op === 'json-patch') {
      const patched = applyJsonPatches(projection[field], operation.patches);
      if (patched === null) return null;
      projection[field] = patched;
      continue;
    }
    return null;
  }

  return {
    projection,
    streamId: payload.streamId || envelope.streamId,
  };
};
