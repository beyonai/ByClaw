import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function assertSkillFrontmatter(text, expectedName, expectedDescription) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  assert.ok(match, 'opening YAML frontmatter is required');

  const fields = match[1].split('\n').map((line) => {
    const field = /^([^:\n]+): (.*)$/.exec(line);
    assert.ok(field, `invalid frontmatter line: ${line}`);
    return [field[1], field[2]];
  });

  assert.deepEqual(
    fields,
    [
      ['name', expectedName],
      ['description', expectedDescription],
    ],
    'frontmatter keys and values must exactly match the portable skill contract',
  );
}

const skills = [
  [
    'super-skill-manager',
    '../SKILL.md',
    'Route OpenClaw-first Agent Skill and MCP lifecycle requests to exactly four operation-family skills. Use when users ask to discover, install, create, inspect, update, repair, remove, restore, or manage candidates.',
  ],
  [
    'super-skill-create',
    '../children/super-skill-create/SKILL.md',
    'Create, install, scaffold, import, and restore OpenClaw-first Agent Skills and MCP candidates. Use for creation and addition requests.',
  ],
  [
    'super-skill-read',
    '../children/super-skill-read/SKILL.md',
    'Search, list, inspect, audit, and verify OpenClaw-first Agent Skills and MCP candidates without mutation. Use for discovery and read-only assessment requests.',
  ],
  [
    'super-skill-update',
    '../children/super-skill-update/SKILL.md',
    'Upgrade, edit, repair, enable, disable, and pin OpenClaw-first Agent Skills and MCP candidates. Use for lifecycle changes that retain the target.',
  ],
  [
    'super-skill-delete',
    '../children/super-skill-delete/SKILL.md',
    'Remove and purge OpenClaw-first Agent Skills and MCP candidates. Use for deletion and uninstallation requests.',
  ],
];

for (const [name, relativePath, description] of skills) {
  test(`${name} has matching frontmatter and no private client syntax`, async () => {
    const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assertSkillFrontmatter(text, name, description);
    assert.doesNotMatch(text, /^(allowed-tools|context|disable-model-invocation):/m);
  });
}

test('frontmatter validation rejects an extra private key', () => {
  assert.throws(
    () =>
      assertSkillFrontmatter(
        '---\nname: super-skill-manager\ndescription: expected\nprivate-client-key: true\n---\n',
        'super-skill-manager',
        'expected',
      ),
    /frontmatter keys/,
  );
});

const childSkills = [
  '../children/super-skill-create/SKILL.md',
  '../children/super-skill-read/SKILL.md',
  '../children/super-skill-update/SKILL.md',
  '../children/super-skill-delete/SKILL.md',
];

for (const relativePath of childSkills) {
  test(`${relativePath} requires the shared policy and manager write guardrail`, async () => {
    const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    const policy = await readFile(
      new URL('../../references/policy.md', new URL(relativePath, import.meta.url)),
      'utf8',
    );
    assert.ok(text.includes('../../references/policy.md'));
    assert.ok(text.includes('must not bypass `../../scripts/manager.mjs` for writes'));
    assert.match(policy, /Never update or delete `super-skill-manager` itself\./);
  });
}

test('super-skill-read explicitly forbids writes and installation', async () => {
  const text = await readFile(new URL('../children/super-skill-read/SKILL.md', import.meta.url), 'utf8');
  assert.match(text, /must not perform writes or install/i);
});

test('restore belongs only to create and is described without promising unavailable execution', async () => {
  const parent = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  const create = await readFile(new URL('../children/super-skill-create/SKILL.md', import.meta.url), 'utf8');
  const remove = await readFile(new URL('../children/super-skill-delete/SKILL.md', import.meta.url), 'utf8');
  assert.match(parent, /`super-skill-create`: install, scaffold, import, or restore\./);
  assert.doesNotMatch(create, /manager\.mjs create restore/);
  assert.match(create, /restore[\s\S]*NOT_IMPLEMENTED/i);
  assert.doesNotMatch(remove, /restore/i);
});

test('read skill covers the byCLI-first cross-market strategy without mutation', async () => {
  const text = await readFile(new URL('../children/super-skill-read/SKILL.md', import.meta.url), 'utf8');
  assert.match(text, /\.\.\/\.\.\/references\/source-strategy\.md/);
  for (const requirement of [/concurrently/i, /8 seconds/i, /20 seconds/i, /partial results/i, /GitHub-only.*unverified/i, /STOP/i, /manual link/i, /--refresh/, /--no-cache/]) {
    assert.match(text, requirement);
  }
  assert.match(text, /never mutate/i);
});

for (const name of ['super-skill-create', 'super-skill-update', 'super-skill-delete']) {
  test(`${name} cites the provider contract and forbids cross-provider fallback`, async () => {
    const text = await readFile(new URL(`../children/${name}/SKILL.md`, import.meta.url), 'utf8');
    assert.match(text, /\.\.\/\.\.\/references\/provider-contract\.md/);
    assert.match(text, /no cross-provider fallback/i);
  });
}

for (const name of ['super-skill-update', 'super-skill-delete']) {
  test(`${name} limits OpenClaw lifecycle examples to runtime-confirmed ClawHub tracking`, async () => {
    const text = await readFile(new URL(`../children/${name}/SKILL.md`, import.meta.url), 'utf8');
    assert.match(text, /trackedBy:\s*clawhub/i);
    assert.match(text, /CUSTOM_TRANSACTION_REQUIRED/);
    assert.match(text, /do not assume.*OpenClaw/i);
  });
}

test('manager routes exactly its four lifecycle families and keeps provider boundaries explicit', async () => {
  const text = await readFile(new URL('../SKILL.md', import.meta.url), 'utf8');
  const children = [...text.matchAll(/`(super-skill-(?:create|read|update|delete))`/g)].map((match) => match[1]);
  assert.deepEqual(children, ['super-skill-create', 'super-skill-read', 'super-skill-update', 'super-skill-delete']);
  for (const provider of ['openclaw', 'builtin-repo', 'byclaw-workspace']) {
    assert.match(text, new RegExp('`' + provider + '`'));
  }
  assert.match(text, /Never put tokens or secrets/i);
  assert.match(text, /Do not edit documentation or auto-commit/i);
});

const workflowRequirements = {
  'super-skill-create': {
    actions: ['install', 'scaffold'],
    unavailableActions: ['import', 'restore'],
    terms: [/install/i, /scaffold/i, /import/i, /restore/i],
  },
  'super-skill-read': {
    actions: ['search', 'list', 'show', 'audit', 'doctor'],
    terms: [/source priority/i, /byCLI-first/i, /manual link/i, /cache/i, /read-only/i],
  },
  'super-skill-update': {
    actions: ['upgrade', 'repair', 'enable', 'disable', 'pin', 'unpin'],
    unavailableActions: ['edit'],
    terms: [/upgrade/i, /edit/i, /repair/i, /enable/i, /disable/i, /pin/i],
  },
  'super-skill-delete': {
    actions: ['remove'],
    unavailableActions: ['purge'],
    terms: [/reverse dependenc/i, /recoverable/i, /purge/i],
  },
};

for (const [name, requirement] of Object.entries(workflowRequirements)) {
  test(`${name} documents its complete workflow and invokes only its matching command group`, async () => {
    const text = await readFile(new URL(`../children/${name}/SKILL.md`, import.meta.url), 'utf8');
    for (const term of requirement.terms) assert.match(text, term);
    if (name !== 'super-skill-read') assert.match(text, /Preview.*inspect.*explicit.*scoped confirmation/is);
    assert.match(text, /Never use `--force`, `--yes`, or `--risk-confirm`/);
    const calls = [...text.matchAll(/manager\.mjs\s+([a-z]+)\s+([a-z-]+)/g)].map((match) => [match[1], match[2]]);
    assert.ok(calls.length > 0, 'workflow must call manager.mjs');
    assert.ok(calls.every(([group, action]) => group === name.replace('super-skill-', '') && requirement.actions.includes(action)));
    for (const action of requirement.unavailableActions ?? []) {
      assert.doesNotMatch(text, new RegExp(`manager\\.mjs ${name.replace('super-skill-', '')} ${action}`));
      assert.match(text, new RegExp(`${action}[\\s\\S]*NOT_IMPLEMENTED`, 'i'));
    }
  });
}

test('normalized data-model example uses null for absent optional source values', async () => {
  const text = await readFile(new URL('../references/data-model.md', import.meta.url), 'utf8');
  const jsonExample = /```json\n([\s\S]*?)\n```/.exec(text);
  assert.ok(jsonExample, 'data model must include a JSON example');

  const record = JSON.parse(jsonExample[1]);
  for (const field of ['description', 'author', 'repository', 'path', 'version', 'updatedAt']) {
    assert.equal(record[field], null, `${field} must be null when absent`);
  }

  for (const field of ['provider', 'retrievedAt', 'rawId']) {
    assert.ok(record.provenance[field].length > 0, `provenance.${field} must be non-empty`);
  }
  assert.ok(!Number.isNaN(Date.parse(record.provenance.retrievedAt)), 'provenance.retrievedAt must be parseable');
});
