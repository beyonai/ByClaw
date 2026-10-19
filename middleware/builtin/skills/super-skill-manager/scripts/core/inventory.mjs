import path from 'node:path';

import { validateSkillName } from './paths.mjs';
import { validateRegistry, validateRegistryEntry } from './registry.mjs';

function warning(code, skill, observationSource = null, details = null) {
  const result = observationSource ? { code, skill, observationSource } : { code, skill };
  return details ? { ...result, details } : result;
}

function validObservation(observation) {
  return observation !== null && typeof observation === 'object' && !Array.isArray(observation) &&
    (Object.getPrototypeOf(observation) === Object.prototype || Object.getPrototypeOf(observation) === null) && typeof observation.name === 'string';
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function hasOnlyKeys(observation, keys) {
  return Object.keys(observation).every((key) => keys.has(key));
}

function validRuntime(observation) {
  const allowed = new Set(['name', 'provider', 'sourceId', 'installed', 'ready', 'eligible', 'path', 'contentHash']);
  return hasOnlyKeys(observation, allowed) && typeof observation.installed === 'boolean' && typeof observation.ready === 'boolean' &&
    (!observation.ready || observation.installed) &&
    isNonEmptyString(observation.sourceId) && (observation.provider === undefined || isNonEmptyString(observation.provider)) &&
    (observation.eligible === undefined || typeof observation.eligible === 'boolean') &&
    (observation.path === undefined || (isNonEmptyString(observation.path) && (path.isAbsolute(observation.path) || path.win32.isAbsolute(observation.path)))) &&
    (observation.contentHash === undefined || isSha256(observation.contentHash));
}

function validClawhub(observation) {
  const allowed = new Set(['name', 'source', 'ref', 'origin', 'contentHash', 'sourceType']);
  return hasOnlyKeys(observation, allowed) && isNonEmptyString(observation.source) && isNonEmptyString(observation.ref) &&
    isNonEmptyString(observation.origin) && isSha256(observation.contentHash) &&
    (observation.sourceType === undefined || observation.sourceType === 'clawhub');
}

function validFilesystem(observation) {
  const allowed = new Set(['name', 'path', 'contentHash']);
  return hasOnlyKeys(observation, allowed) && isNonEmptyString(observation.path) &&
    (path.isAbsolute(observation.path) || path.win32.isAbsolute(observation.path)) && isSha256(observation.contentHash);
}

const VALIDATORS = { runtime: validRuntime, clawhub: validClawhub, filesystem: validFilesystem };

function inspectObservation(observation, kind) {
  let name = null;
  try {
    if (validObservation(observation)) name = observation.name;
    if (!validObservation(observation) || !VALIDATORS[kind](observation)) return { valid: false, name };
    validateSkillName(observation.name);
    return { valid: true, name: observation.name, observation };
  } catch {
    return { valid: false, name };
  }
}

function addObservations(collection, kind, buckets, warnings) {
  const valid = [];
  for (const observation of Array.isArray(collection) ? collection : []) {
    const inspected = inspectObservation(observation, kind);
    if (!inspected.valid) {
      warnings.push(warning('INVALID_OBSERVATION', inspected.name, kind));
      continue;
    }
    valid.push(inspected);
  }
  valid.sort((left, right) => {
    const leftKey = JSON.stringify(left.observation);
    const rightKey = JSON.stringify(right.observation);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  for (const { observation } of valid) {
    const bucket = buckets.get(observation.name) ?? {};
    if (bucket[kind]) warnings.push(warning(`DUPLICATE_${kind.toUpperCase()}_OBSERVATION`, observation.name));
    else bucket[kind] = observation;
    buckets.set(observation.name, bucket);
  }
}

function compareHashes(name, bucket, warnings) {
  const declared = ['runtime', 'clawhub', 'registry', 'filesystem']
    .filter((kind) => bucket[kind]?.contentHash)
    .map((kind) => ({ kind, contentHash: bucket[kind].contentHash }));
  for (let leftIndex = 0; leftIndex < declared.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < declared.length; rightIndex += 1) {
      const left = declared[leftIndex];
      const right = declared[rightIndex];
      if (left.contentHash !== right.contentHash) {
        warnings.push(warning('HASH_MISMATCH', name, null, {
          sources: [left.kind, right.kind],
          values: { [left.kind]: left.contentHash, [right.kind]: right.contentHash },
        }));
      }
    }
  }
}

function compareProvenance(name, bucket, warnings) {
  const declared = ['clawhub', 'registry']
    .filter((kind) => bucket[kind])
    .map((kind) => ({ kind, source: bucket[kind].source, ref: bucket[kind].ref }));
  for (let leftIndex = 0; leftIndex < declared.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < declared.length; rightIndex += 1) {
      const left = declared[leftIndex];
      const right = declared[rightIndex];
      if (left.source !== right.source || left.ref !== right.ref) {
        warnings.push(warning('SOURCE_REF_CONFLICT', name, null, {
          sources: [left.kind, right.kind],
          values: {
            [left.kind]: { source: left.source, ref: left.ref },
            [right.kind]: { source: right.source, ref: right.ref },
          },
        }));
      }
    }
  }
}

export function reconcileInventory({ runtime = [], clawhub = [], registry = { schemaVersion: 1, skills: {} }, filesystem = [] } = {}) {
  const warnings = [];
  const buckets = new Map();
  addObservations(runtime, 'runtime', buckets, warnings);
  addObservations(clawhub, 'clawhub', buckets, warnings);
  addObservations(filesystem, 'filesystem', buckets, warnings);
  let registryHasValidTopLevel = registry !== null && typeof registry === 'object' && !Array.isArray(registry) &&
    (Object.getPrototypeOf(registry) === Object.prototype || Object.getPrototypeOf(registry) === null) &&
    Object.keys(registry).length === 2 && Object.prototype.hasOwnProperty.call(registry, 'schemaVersion') &&
    Object.prototype.hasOwnProperty.call(registry, 'skills') && registry.schemaVersion === 1 && registry.skills !== null &&
    typeof registry.skills === 'object' && !Array.isArray(registry.skills) &&
    (Object.getPrototypeOf(registry.skills) === Object.prototype || Object.getPrototypeOf(registry.skills) === null);
  let registryFullyValid = true;
  try { validateRegistry(registry); } catch { registryFullyValid = false; }
  if (registryHasValidTopLevel) {
    try { validateRegistry({ schemaVersion: registry.schemaVersion, skills: {} }); } catch { registryHasValidTopLevel = false; }
  }
  if (!registryFullyValid && !registryHasValidTopLevel) warnings.push(warning('INVALID_REGISTRY_OBSERVATION', null, 'registry'));
  for (const [name, entry] of registryHasValidTopLevel ? Object.entries(registry.skills) : []) {
    try {
      validateRegistryEntry(name, entry);
    } catch {
      warnings.push(warning('INVALID_REGISTRY_OBSERVATION', name, 'registry'));
      continue;
    }
    const bucket = buckets.get(name) ?? {};
    if (bucket.registry) warnings.push(warning('DUPLICATE_REGISTRY_OBSERVATION', name));
    else bucket.registry = entry;
    buckets.set(name, bucket);
  }

  const skills = [];
  for (const name of [...buckets.keys()].sort()) {
    const bucket = buckets.get(name);
    if (bucket.filesystem && !bucket.registry && !bucket.clawhub) warnings.push(warning('FILESYSTEM_UNREGISTERED', name));
    if (bucket.registry && !bucket.filesystem) warnings.push(warning('REGISTRY_MISSING_FILESYSTEM', name));
    if (bucket.runtime && !bucket.filesystem) warnings.push(warning('RUNTIME_MISSING_FILESYSTEM', name));
    if (bucket.clawhub && !bucket.filesystem) warnings.push(warning('CLAWHUB_MISSING_FILESYSTEM', name));
    if (bucket.filesystem && !bucket.runtime) warnings.push(warning('FILESYSTEM_MISSING_RUNTIME', name));
    if (bucket.runtime && bucket.filesystem) {
      if (bucket.runtime.installed !== true) warnings.push(warning('RUNTIME_INSTALL_STATE_CONFLICT', name, null, {
        runtimeInstalled: bucket.runtime.installed,
        filesystemPresent: true,
      }));
      if (bucket.runtime.path && bucket.runtime.path !== bucket.filesystem.path) warnings.push(warning('PATH_MISMATCH', name, null, {
        runtimePath: bucket.runtime.path,
        filesystemPath: bucket.filesystem.path,
      }));
    }
    const provenance = bucket.clawhub ?? bucket.registry ?? null;
    compareHashes(name, bucket, warnings);
    compareProvenance(name, bucket, warnings);
    skills.push({
      name,
      provider: bucket.runtime?.provider ?? null,
      present: Boolean(bucket.filesystem),
      path: bucket.filesystem?.path ?? null,
      contentHash: bucket.filesystem?.contentHash ?? null,
      sourceType: provenance?.sourceType ?? (bucket.clawhub ? 'clawhub' : null),
      source: provenance?.source ?? null,
      ref: provenance?.ref ?? null,
      runtime: bucket.runtime ?? null,
    });
  }
  warnings.sort((left, right) => {
    const leftKey = JSON.stringify([left.code, left.skill, left.observationSource ?? '']);
    const rightKey = JSON.stringify([right.code, right.skill, right.observationSource ?? '']);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return { skills, warnings };
}
