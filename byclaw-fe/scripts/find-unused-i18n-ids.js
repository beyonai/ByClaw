#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(PROJECT_ROOT, 'src');
const SCAN_DIRS = [path.join(PROJECT_ROOT, 'src'), path.join(PROJECT_ROOT, 'config')];
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.umi',
  '.umi-production',
  'coverage',
]);
const IGNORE_FILE_PATTERNS = [/\.d\.ts$/];
const INCLUDE_TESTS = process.argv.includes('--include-tests');
const JSON_OUTPUT = process.argv.includes('--json');
const DELETE_MODE = process.argv.includes('--delete');

function walkFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
      continue;
    }

    const ext = path.extname(entry.name);
    if (!CODE_EXTENSIONS.has(ext)) continue;
    if (IGNORE_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) continue;
    if (!INCLUDE_TESTS && /(^|\/)__tests__(\/|$)|\.test\.[jt]sx?$|\.spec\.[jt]sx?$/.test(fullPath)) continue;

    files.push(fullPath);
  }

  return files;
}

function parseFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  const plugins = [
    'typescript',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'decorators-legacy',
    'dynamicImport',
    'importMeta',
    'optionalChaining',
    'nullishCoalescingOperator',
    'objectRestSpread',
    'topLevelAwait',
  ];

  if (ext !== '.ts') {
    plugins.unshift('jsx');
  }

  const ast = parser.parse(source, {
    sourceType: 'unambiguous',
    errorRecovery: true,
    plugins,
  });

  return { ast, source };
}

function unwrapExpression(node) {
  let current = node;

  while (
    current &&
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'TypeCastExpression',
      'ParenthesizedExpression',
    ].includes(current.type)
  ) {
    current = current.expression;
  }

  return current;
}

function unwrapPath(nodePath) {
  let currentPath = nodePath;

  while (
    currentPath &&
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'TypeCastExpression',
      'ParenthesizedExpression',
    ].includes(currentPath.node?.type)
  ) {
    currentPath = currentPath.get('expression');
  }

  return currentPath;
}

function getStaticKeyName(node) {
  const target = unwrapExpression(node);
  if (!target) return null;

  if (target.type === 'Identifier') return target.name;
  if (target.type === 'StringLiteral') return target.value;
  if (target.type === 'NumericLiteral') return String(target.value);

  return null;
}

function collectLocaleKeysFromObject(objectNode, parentPath = [], keys = []) {
  for (const property of objectNode.properties || []) {
    if (property.type !== 'ObjectProperty' || property.computed) continue;

    const keyName = getStaticKeyName(property.key);
    if (!keyName) continue;

    const valueNode = unwrapExpression(property.value);
    if (valueNode && valueNode.type === 'ObjectExpression') {
      collectLocaleKeysFromObject(valueNode, parentPath.concat(keyName), keys);
      continue;
    }

    keys.push(parentPath.concat(keyName).join('.'));
  }

  return keys;
}

function collectLocaleDefinitions(localeFiles) {
  const localeIdMap = new Map();
  const parseErrors = [];

  for (const filePath of localeFiles) {
    try {
      const { ast } = parseFile(filePath);
      let foundExport = false;

      traverse(ast, {
        ExportDefaultDeclaration(exportPath) {
          const declaration = unwrapExpression(exportPath.node.declaration);
          if (!declaration || declaration.type !== 'ObjectExpression') return;

          foundExport = true;
          const keys = collectLocaleKeysFromObject(declaration);

          for (const id of keys) {
            if (!localeIdMap.has(id)) {
              localeIdMap.set(id, new Set());
            }
            localeIdMap.get(id).add(filePath);
          }
        },
      });

      if (!foundExport) {
        parseErrors.push({ filePath, reason: '未找到 export default 对象' });
      }
    } catch (error) {
      parseErrors.push({ filePath, reason: error.message });
    }
  }

  return { localeIdMap, parseErrors };
}

function isFormatMessageCall(node) {
  return (
    node &&
    node.type === 'CallExpression' &&
    node.callee &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    getStaticKeyName(node.callee.property) === 'formatMessage'
  );
}

function isMemberLikePath(nodePath) {
  return !!(nodePath?.isMemberExpression?.() || nodePath?.isOptionalMemberExpression?.());
}

function createResolutionResult() {
  return {
    exactValues: new Set(),
    dynamicPrefixes: new Set(),
  };
}

function mergeResolution(target, source) {
  for (const value of source.exactValues) {
    target.exactValues.add(value);
  }

  for (const prefix of source.dynamicPrefixes) {
    if (prefix) {
      target.dynamicPrefixes.add(prefix);
    }
  }

  return target;
}

function combineExactSets(leftSet, rightSet) {
  const combined = new Set();

  for (const leftValue of leftSet) {
    for (const rightValue of rightSet) {
      combined.add(`${leftValue}${rightValue}`);
    }
  }

  return combined;
}

function dedupeNodePaths(nodePaths) {
  const pathMap = new Map();

  for (const nodePath of nodePaths) {
    if (!nodePath?.node) continue;

    const key = `${nodePath.node.start}:${nodePath.node.end}:${nodePath.node.type}`;
    if (!pathMap.has(key)) {
      pathMap.set(key, nodePath);
    }
  }

  return Array.from(pathMap.values());
}

function getBindingInitPath(binding) {
  if (!binding) return null;

  if (binding.path.isVariableDeclarator()) {
    return binding.path.get('init');
  }

  if (binding.path.isAssignmentPattern()) {
    return binding.path.get('right');
  }

  return null;
}

function getStaticContainerEntries(containerPath) {
  if (containerPath?.isObjectExpression()) {
    return containerPath
      .get('properties')
      .filter((propertyPath) => propertyPath.isObjectProperty() && !propertyPath.node.computed)
      .map((propertyPath) => ({
        keyName: getStaticKeyName(propertyPath.node.key),
        valuePath: propertyPath.get('value'),
      }))
      .filter((entry) => entry.keyName);
  }

  if (containerPath?.isArrayExpression()) {
    return containerPath
      .get('elements')
      .map((elementPath, index) => ({
        keyName: `${index}`,
        valuePath: elementPath,
      }))
      .filter((entry) => entry.valuePath?.node);
  }

  return [];
}

function resolveObjectCandidatePaths(nodePath, seenBindings = new Set()) {
  const pathToResolve = unwrapPath(nodePath);

  if (!pathToResolve?.node) {
    return [];
  }

  if (pathToResolve.isObjectExpression() || pathToResolve.isArrayExpression()) {
    return [pathToResolve];
  }

  if (pathToResolve.isConditionalExpression()) {
    return dedupeNodePaths([
      ...resolveObjectCandidatePaths(pathToResolve.get('consequent'), seenBindings),
      ...resolveObjectCandidatePaths(pathToResolve.get('alternate'), seenBindings),
    ]);
  }

  if (pathToResolve.isIdentifier()) {
    const binding = pathToResolve.scope.getBinding(pathToResolve.node.name);
    if (!binding || !binding.constant || seenBindings.has(binding)) {
      return [];
    }

    seenBindings.add(binding);
    const candidates = resolveObjectCandidatePaths(getBindingInitPath(binding), seenBindings);
    seenBindings.delete(binding);
    return dedupeNodePaths(candidates);
  }

  if (isMemberLikePath(pathToResolve)) {
    const valuePaths = resolveMemberValuePaths(pathToResolve, seenBindings);
    const objectPaths = [];

    for (const valuePath of valuePaths) {
      objectPaths.push(...resolveObjectCandidatePaths(valuePath, seenBindings));
    }

    return dedupeNodePaths(objectPaths);
  }

  return [];
}

function resolveMemberValuePaths(memberPath, seenBindings = new Set()) {
  const pathToResolve = unwrapPath(memberPath);
  if (!isMemberLikePath(pathToResolve)) {
    return [];
  }

  const containerCandidates = resolveObjectCandidatePaths(pathToResolve.get('object'), seenBindings);
  if (containerCandidates.length === 0) {
    return [];
  }

  let propertyNames = new Set();
  let useAllProperties = false;

  if (pathToResolve.node.computed) {
    const propertyResolution = resolveExpressionValue(pathToResolve.get('property'), seenBindings);
    if (propertyResolution.exactValues.size > 0) {
      propertyNames = propertyResolution.exactValues;
    } else {
      useAllProperties = true;
    }
  } else {
    const propertyName = getStaticKeyName(pathToResolve.node.property);
    if (!propertyName) {
      return [];
    }
    propertyNames = new Set([propertyName]);
  }

  const matchedPaths = [];

  for (const containerPath of containerCandidates) {
    for (const entry of getStaticContainerEntries(containerPath)) {
      if (useAllProperties || propertyNames.has(entry.keyName)) {
        matchedPaths.push(entry.valuePath);
      }
    }
  }

  return dedupeNodePaths(matchedPaths);
}

function resolveExpressionValue(nodePath, seenBindings = new Set()) {
  const pathToResolve = unwrapPath(nodePath);
  const result = createResolutionResult();

  if (!pathToResolve?.node) {
    return result;
  }

  if (pathToResolve.isStringLiteral()) {
    result.exactValues.add(pathToResolve.node.value);
    return result;
  }

  if (pathToResolve.isNumericLiteral()) {
    result.exactValues.add(String(pathToResolve.node.value));
    return result;
  }

  if (pathToResolve.isTemplateLiteral()) {
    let exactValues = new Set(['']);

    const quasis = pathToResolve.get('quasis');
    const expressions = pathToResolve.get('expressions');

    for (let index = 0; index < quasis.length; index += 1) {
      const quasiValue = quasis[index].node.value.cooked || '';
      exactValues = new Set(Array.from(exactValues, (value) => `${value}${quasiValue}`));

      const expressionPath = expressions[index];
      if (!expressionPath) {
        continue;
      }

      const expressionResolution = resolveExpressionValue(expressionPath, seenBindings);

      for (const prefix of expressionResolution.dynamicPrefixes) {
        for (const baseValue of exactValues) {
          const combinedPrefix = `${baseValue}${prefix}`;
          if (combinedPrefix) {
            result.dynamicPrefixes.add(combinedPrefix);
          }
        }
      }

      if (expressionResolution.exactValues.size === 0) {
        for (const baseValue of exactValues) {
          if (baseValue) {
            result.dynamicPrefixes.add(baseValue);
          }
        }
        return result;
      }

      exactValues = combineExactSets(exactValues, expressionResolution.exactValues);
    }

    mergeResolution(result, { exactValues, dynamicPrefixes: new Set() });
    return result;
  }

  if (pathToResolve.isConditionalExpression()) {
    mergeResolution(result, resolveExpressionValue(pathToResolve.get('consequent'), seenBindings));
    mergeResolution(result, resolveExpressionValue(pathToResolve.get('alternate'), seenBindings));
    return result;
  }

  if (pathToResolve.isBinaryExpression({ operator: '+' })) {
    const leftResolution = resolveExpressionValue(pathToResolve.get('left'), seenBindings);
    const rightResolution = resolveExpressionValue(pathToResolve.get('right'), seenBindings);

    mergeResolution(result, {
      exactValues: combineExactSets(leftResolution.exactValues, rightResolution.exactValues),
      dynamicPrefixes: new Set(),
    });

    for (const prefix of leftResolution.dynamicPrefixes) {
      if (prefix) {
        result.dynamicPrefixes.add(prefix);
      }
    }

    if (leftResolution.exactValues.size > 0) {
      if (rightResolution.dynamicPrefixes.size > 0) {
        for (const leftValue of leftResolution.exactValues) {
          for (const prefix of rightResolution.dynamicPrefixes) {
            const combinedPrefix = `${leftValue}${prefix}`;
            if (combinedPrefix) {
              result.dynamicPrefixes.add(combinedPrefix);
            }
          }
        }
      } else if (rightResolution.exactValues.size === 0) {
        for (const leftValue of leftResolution.exactValues) {
          if (leftValue) {
            result.dynamicPrefixes.add(leftValue);
          }
        }
      }
    }

    return result;
  }

  if (isMemberLikePath(pathToResolve)) {
    const candidateValuePaths = resolveMemberValuePaths(pathToResolve, seenBindings);

    for (const candidatePath of candidateValuePaths) {
      mergeResolution(result, resolveExpressionValue(candidatePath, seenBindings));
    }

    return result;
  }

  if (pathToResolve.isIdentifier()) {
    const binding = pathToResolve.scope.getBinding(pathToResolve.node.name);
    if (!binding || !binding.constant || seenBindings.has(binding)) {
      return result;
    }

    seenBindings.add(binding);

    let resolvedResult = createResolutionResult();
    if (binding.path.isVariableDeclarator()) {
      resolvedResult = resolveExpressionValue(binding.path.get('init'), seenBindings);
    } else if (binding.path.isAssignmentPattern()) {
      resolvedResult = resolveExpressionValue(binding.path.get('right'), seenBindings);
    }

    seenBindings.delete(binding);
    return resolvedResult;
  }

  return result;
}

function collectIdsFromExpressionPath(expressionPath, exactIds, dynamicPrefixes) {
  const resolution = resolveExpressionValue(expressionPath);

  for (const value of resolution.exactValues) {
    exactIds.add(value);
  }

  for (const prefix of resolution.dynamicPrefixes) {
    if (prefix) {
      dynamicPrefixes.add(prefix);
    }
  }
}

function collectSourceReferences(sourceFiles) {
  const exactIds = new Set();
  const dynamicPrefixes = new Set();
  const parseErrors = [];

  for (const filePath of sourceFiles) {
    try {
      const { ast } = parseFile(filePath);

      traverse(ast, {
        StringLiteral(stringPath) {
          exactIds.add(stringPath.node.value);
        },
        TemplateLiteral(templatePath) {
          if (templatePath.node.expressions.length === 0) {
            exactIds.add(templatePath.node.quasis[0] ? templatePath.node.quasis[0].value.cooked || '' : '');
          }
        },
        CallExpression(callPath) {
          if (!isFormatMessageCall(callPath.node)) return;

          const [firstArgumentPath] = callPath.get('arguments');
          const objectPath = unwrapPath(firstArgumentPath);
          if (!objectPath?.isObjectExpression()) return;

          const idPropertyPath = objectPath
            .get('properties')
            .find(
              (propertyPath) =>
                propertyPath.isObjectProperty() &&
                !propertyPath.node.computed &&
                getStaticKeyName(propertyPath.node.key) === 'id',
            );

          if (!idPropertyPath) return;
          collectIdsFromExpressionPath(idPropertyPath.get('value'), exactIds, dynamicPrefixes);
        },
        JSXOpeningElement(jsxPath) {
          if (getStaticKeyName(jsxPath.node.name) !== 'FormattedMessage') return;

          const idAttribute = jsxPath.node.attributes.find(
            (attribute) => attribute.type === 'JSXAttribute' && getStaticKeyName(attribute.name) === 'id',
          );

          if (!idAttribute || !idAttribute.value) return;

          if (idAttribute.value.type === 'StringLiteral') {
            exactIds.add(idAttribute.value.value);
            return;
          }

          if (idAttribute.value.type === 'JSXExpressionContainer') {
            collectIdsFromExpressionPath(jsxPath.get('attributes')[jsxPath.node.attributes.indexOf(idAttribute)].get('value').get('expression'), exactIds, dynamicPrefixes);
          }
        },
      });
    } catch (error) {
      parseErrors.push({ filePath, reason: error.message });
    }
  }

  return { exactIds, dynamicPrefixes, parseErrors };
}

function isLocaleFile(filePath) {
  return filePath.startsWith(SRC_ROOT) && filePath.split(path.sep).includes('locales');
}

function getLocaleFiles() {
  return walkFiles(SRC_ROOT).filter(isLocaleFile).sort();
}

function getSourceFiles() {
  return SCAN_DIRS.flatMap((dir) => walkFiles(dir)).filter((filePath) => !isLocaleFile(filePath)).sort();
}

function buildUnusedLocaleIds(localeIdMap, exactIds, dynamicPrefixes) {
  const unusedEntries = [];

  for (const [id, fileSet] of localeIdMap.entries()) {
    const usedByExactId = exactIds.has(id);
    const usedByDynamicPrefix = Array.from(dynamicPrefixes).some((prefix) => prefix && id.startsWith(prefix));

    if (usedByExactId || usedByDynamicPrefix) continue;

    unusedEntries.push({
      id,
      files: Array.from(fileSet).sort(),
    });
  }

  return unusedEntries.sort((a, b) => a.id.localeCompare(b.id));
}

function getLineStart(source, index) {
  const lineBreakIndex = source.lastIndexOf('\n', index - 1);
  return lineBreakIndex === -1 ? 0 : lineBreakIndex + 1;
}

function getPropertyRemovalRange(source, objectNode, propertyNode) {
  const properties = (objectNode.properties || []).filter(Boolean);
  const propertyIndex = properties.findIndex((item) => item === propertyNode);
  const nextProperty = propertyIndex >= 0 ? properties[propertyIndex + 1] : null;

  const start = getLineStart(source, propertyNode.start);

  if (nextProperty) {
    return {
      start,
      end: getLineStart(source, nextProperty.start),
    };
  }

  return {
    start,
    end: getLineStart(source, objectNode.end - 1),
  };
}

function planObjectRemovals(objectNode, parentPath, targetIds) {
  const removalTargets = [];
  const removedIds = [];
  let remainingPropertyCount = 0;

  for (const property of objectNode.properties || []) {
    if (property.type !== 'ObjectProperty' || property.computed) {
      remainingPropertyCount++;
      continue;
    }

    const keyName = getStaticKeyName(property.key);
    if (!keyName) {
      remainingPropertyCount++;
      continue;
    }

    const localeId = parentPath.concat(keyName).join('.');
    const valueNode = unwrapExpression(property.value);

    if (targetIds.has(localeId)) {
      removalTargets.push({ objectNode, propertyNode: property });
      removedIds.push(localeId);
      continue;
    }

    if (valueNode && valueNode.type === 'ObjectExpression') {
      const childPlan = planObjectRemovals(valueNode, parentPath.concat(keyName), targetIds);

      if (childPlan.removedIds.length > 0 && childPlan.isEmptyAfterRemoval) {
        removalTargets.push({ objectNode, propertyNode: property });
        removedIds.push(...childPlan.removedIds);
        continue;
      }

      removalTargets.push(...childPlan.removalTargets);
      removedIds.push(...childPlan.removedIds);
    }

    remainingPropertyCount++;
  }

  return {
    removalTargets,
    removedIds,
    isEmptyAfterRemoval: remainingPropertyCount === 0,
  };
}

function applyRemovalsToSource(source, removalTargets) {
  let nextSource = source;
  const ranges = removalTargets
    .map(({ objectNode, propertyNode }) => getPropertyRemovalRange(nextSource, objectNode, propertyNode))
    .sort((a, b) => b.start - a.start);

  for (const range of ranges) {
    nextSource = nextSource.slice(0, range.start) + nextSource.slice(range.end);
  }

  return nextSource.replace(/\n{3,}/g, '\n\n');
}

function deleteUnusedLocaleIds(unusedEntries) {
  const unusedIdsByFile = new Map();

  for (const entry of unusedEntries) {
    for (const filePath of entry.files) {
      if (!unusedIdsByFile.has(filePath)) {
        unusedIdsByFile.set(filePath, new Set());
      }
      unusedIdsByFile.get(filePath).add(entry.id);
    }
  }

  const deleteResults = [];

  for (const [filePath, idSet] of unusedIdsByFile.entries()) {
    const { ast, source } = parseFile(filePath);
    let exportObjectNode = null;

    traverse(ast, {
      ExportDefaultDeclaration(exportPath) {
        const declaration = unwrapExpression(exportPath.node.declaration);
        if (declaration && declaration.type === 'ObjectExpression') {
          exportObjectNode = declaration;
          exportPath.stop();
        }
      },
    });

    if (!exportObjectNode) {
      deleteResults.push({
        filePath,
        removedIds: [],
        requestedIds: Array.from(idSet).sort(),
        skipped: true,
      });
      continue;
    }

    const removalPlan = planObjectRemovals(exportObjectNode, [], idSet);
    const nextSource = applyRemovalsToSource(source, removalPlan.removalTargets);

    if (nextSource !== source) {
      fs.writeFileSync(filePath, nextSource, 'utf8');
    }

    deleteResults.push({
      filePath,
      removedIds: Array.from(new Set(removalPlan.removedIds)).sort(),
      requestedIds: Array.from(idSet).sort(),
      skipped: false,
    });
  }

  return deleteResults.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

function toProjectRelative(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
}

function printTextReport({ localeFiles, localeIdMap, exactIds, dynamicPrefixes, unusedEntries, parseErrors }) {
  console.log('Locale files:');
  for (const filePath of localeFiles) {
    console.log(`  - ${toProjectRelative(filePath)}`);
  }

  console.log('');
  console.log(`Locale file count: ${localeFiles.length}`);
  console.log(`Locale id count: ${localeIdMap.size}`);
  console.log(`Exact referenced strings: ${exactIds.size}`);
  console.log(`Dynamic locale prefixes: ${dynamicPrefixes.size}`);

  if (dynamicPrefixes.size > 0) {
    console.log('');
    console.log('Dynamic prefixes:');
    for (const prefix of Array.from(dynamicPrefixes).sort()) {
      console.log(`  - ${prefix}\${...}`);
    }
  }

  console.log('');
  console.log(`Unused locale ids: ${unusedEntries.length}`);

  if (unusedEntries.length > 0) {
    console.log('');
    for (const entry of unusedEntries) {
      console.log(`- ${entry.id}`);
      for (const filePath of entry.files) {
        console.log(`    ${toProjectRelative(filePath)}`);
      }
    }
  }

  if (parseErrors.length > 0) {
    console.log('');
    console.log('Parse warnings:');
    for (const error of parseErrors) {
      console.log(`  - ${toProjectRelative(error.filePath)}: ${error.reason}`);
    }
  }
}

function main() {
  const localeFiles = getLocaleFiles();

  if (localeFiles.length === 0) {
    console.error('No locale files found under src/**/locales or src/locales.');
    process.exitCode = 1;
    return;
  }

  const { localeIdMap, parseErrors: localeParseErrors } = collectLocaleDefinitions(localeFiles);
  const sourceFiles = getSourceFiles();
  const { exactIds, dynamicPrefixes, parseErrors: sourceParseErrors } = collectSourceReferences(sourceFiles);
  const unusedEntries = buildUnusedLocaleIds(localeIdMap, exactIds, dynamicPrefixes);
  const parseErrors = localeParseErrors.concat(sourceParseErrors);
  const deleteResults = DELETE_MODE ? deleteUnusedLocaleIds(unusedEntries) : [];

  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify(
        {
          localeFiles: localeFiles.map(toProjectRelative),
          localeIdCount: localeIdMap.size,
          unusedLocaleIds: unusedEntries.map((entry) => ({
            id: entry.id,
            files: entry.files.map(toProjectRelative),
          })),
          dynamicPrefixes: Array.from(dynamicPrefixes).sort(),
          deleteResults: deleteResults.map((result) => ({
            file: toProjectRelative(result.filePath),
            removedIds: result.removedIds,
            requestedIds: result.requestedIds,
            skipped: result.skipped,
          })),
          parseWarnings: parseErrors.map((error) => ({
            file: toProjectRelative(error.filePath),
            reason: error.reason,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  printTextReport({
    localeFiles,
    localeIdMap,
    exactIds,
    dynamicPrefixes,
    unusedEntries,
    parseErrors,
  });

  if (DELETE_MODE) {
    console.log('');
    console.log('Delete results:');

    for (const result of deleteResults) {
      const relativePath = toProjectRelative(result.filePath);
      if (result.skipped) {
        console.log(`  - ${relativePath}: skipped`);
        continue;
      }

      console.log(`  - ${relativePath}: removed ${result.removedIds.length}/${result.requestedIds.length}`);
    }
  }
}

main();
