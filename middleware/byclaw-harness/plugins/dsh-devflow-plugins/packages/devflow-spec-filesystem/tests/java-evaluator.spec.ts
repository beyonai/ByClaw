// The Java evaluator: what counts as a declaration — including overloads, the
// first name in this line's five languages that means several declarations at
// once — and which formatting dimensions must not move a content hash.
// google-java-format's dimensions are line wrapping, indentation, and putting
// each annotation on its own line; semicolons are not one, because Java's are
// mandatory and no formatter can add or remove one.
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SpecStore from '@zhchxiao123/dsh-devflow-spec-filesystem'
import { javaEvaluator } from '../src/evaluators/java.ts'
import { evaluatorFor } from '../src/evaluators/registry.ts'

async function hashOf(source: string, symbol: string): Promise<string | undefined> {
  return (await javaEvaluator.lookup(source, symbol)).hash
}

async function declared(source: string, symbol: string): Promise<boolean> {
  return (await javaEvaluator.lookup(source, symbol)).declared
}

const ORIGINAL = `package org.example.owner;

public class Owner {

	/**
	 * Return the Pet with the given name.
	 * @param name to test
	 */
	public Pet getPet(String name) {
		// Case is not significant.
		return findPet(name.toLowerCase());
	}

}
`

describe('normalization', () => {
  it('survives a comment rewrite, and does not mistake // inside a string for one', async () => {
    const uncommented = ORIGINAL.replace('\t\t// Case is not significant.\n', '')
    await expect(hashOf(uncommented, 'Owner.getPet')).resolves.toBe(await hashOf(ORIGINAL, 'Owner.getPet'))
    const url = 'class C { String u = "https://x/y"; }'
    await expect(hashOf(url, 'C.u')).resolves.not.toBe(await hashOf('class C { String u = "https:"; }', 'C.u'))
  })

  it('drops Javadoc: it reaches a doc tool, never a running program', async () => {
    const reworded = ORIGINAL.replace('Return the Pet with the given name.', 'Look the Pet up by name.')
    await expect(hashOf(reworded, 'Owner.getPet')).resolves.toBe(await hashOf(ORIGINAL, 'Owner.getPet'))
  })

  it('hashes annotations, which sit in the declaration\'s modifiers and are behavior', async () => {
    const annotated = 'class C {\n  @Column\n  @NotBlank\n  private String address;\n}\n'
    await expect(hashOf(annotated, 'C.address')).resolves.not.toBe(await hashOf('class C {\n  private String address;\n}\n', 'C.address'))
    const other = annotated.replace('@NotBlank', '@NotNull')
    await expect(hashOf(other, 'C.address')).resolves.not.toBe(await hashOf(annotated, 'C.address'))
  })

  it('survives a google-java-format rewrap, annotations moved onto their own lines', async () => {
    const formatted = 'class C {\n  @Column\n  @NotBlank\n  private String address;\n}\n'
    await expect(hashOf('class C { @Column @NotBlank private String address; }\n', 'C.address')).resolves.toBe(await hashOf(formatted, 'C.address'))
    const wrapped = 'class C {\n  void f(\n      int a,\n      int b) {\n    call(a, b);\n  }\n}\n'
    await expect(hashOf(wrapped, 'C.f')).resolves.toBe(await hashOf('class C { void f(int a, int b) { call(a, b); } }\n', 'C.f'))
  })

  it('drops a trailing comma an array initializer or an enum constant list may carry', async () => {
    await expect(hashOf('class C { int[] xs = {1, 2,}; }\n', 'C.xs')).resolves.toBe(await hashOf('class C { int[] xs = {1, 2}; }\n', 'C.xs'))
    await expect(hashOf('enum E { A, B, }\n', 'E')).resolves.toBe(await hashOf('enum E { A, B }\n', 'E'))
  })

  it('moves when a statement changes blocks: the braces are tokens in the stream', async () => {
    const guarded = 'class C { void f(O o) { if (o.a) { o.b = 1; } o.c = 2; } }\n'
    const moved = 'class C { void f(O o) { if (o.a) { o.b = 1; o.c = 2; } } }\n'
    await expect(hashOf(guarded, 'C.f')).resolves.not.toBe(await hashOf(moved, 'C.f'))
  })
})

describe('symbol lookup', () => {
  it('finds each of the type declaration forms a spec cites', async () => {
    await expect(declared('class C {}\n', 'C')).resolves.toBe(true)
    await expect(declared('interface I { void m(); }\n', 'I')).resolves.toBe(true)
    await expect(declared('enum E { A }\n', 'E')).resolves.toBe(true)
    await expect(declared('record R(int x) {}\n', 'R')).resolves.toBe(true)
    await expect(declared('@interface Ann { String value(); }\n', 'Ann')).resolves.toBe(true)
  })

  it('finds each of the member forms as Type.name, never as a bare name', async () => {
    const source = 'class C {\n  private String a;\n  public void m() {}\n  public C() {}\n}\n'
    await expect(declared(source, 'C.a')).resolves.toBe(true)
    await expect(declared(source, 'C.m')).resolves.toBe(true)
    await expect(declared(source, 'm')).resolves.toBe(false)
    await expect(declared('interface I {\n  int K = 1;\n  void m();\n  default void d() {}\n}\n', 'I.K')).resolves.toBe(true)
    await expect(declared('interface I {\n  void m();\n}\n', 'I.m')).resolves.toBe(true)
    await expect(declared('enum E { A, B; int n; void m() {} }\n', 'E.A')).resolves.toBe(true)
    await expect(declared('enum E { A, B; int n; void m() {} }\n', 'E.n')).resolves.toBe(true)
    await expect(declared('enum E { A, B; int n; void m() {} }\n', 'E.m')).resolves.toBe(true)
    await expect(declared('@interface Ann { String value(); }\n', 'Ann.value')).resolves.toBe(true)
  })

  it('resolves every overload of one name to a single unit, so editing any of them stales it', async () => {
    const three = 'class C {\n  Pet get(String n) { return byName(n); }\n  Pet get(Integer i) { return byId(i); }\n  Pet get(String n, boolean b) { return byName(n, b); }\n}\n'
    expect(await declared(three, 'C.get')).toBe(true)
    // Not the first overload alone.
    await expect(hashOf(three, 'C.get')).resolves.not.toBe(await hashOf('class C {\n  Pet get(String n) { return byName(n); }\n}\n', 'C.get'))
    // Each overload is inside the unit: touching the last one moves the hash.
    const edited = three.replace('return byName(n, b);', 'return lookup(n, b);')
    await expect(hashOf(edited, 'C.get')).resolves.not.toBe(await hashOf(three, 'C.get'))
    // And a middle one.
    await expect(hashOf(three.replace('return byId(i);', 'return byKey(i);'), 'C.get')).resolves.not.toBe(await hashOf(three, 'C.get'))
  })

  it('groups a field and a method of the same name, which Java keeps in separate namespaces', async () => {
    const both = 'class C {\n  int count;\n  int count() { return count; }\n}\n'
    expect(await declared(both, 'C.count')).toBe(true)
    await expect(hashOf(both, 'C.count')).resolves.not.toBe(await hashOf('class C {\n  int count;\n}\n', 'C.count'))
  })

  it('cites every constructor as Type.Type, all of them one unit', async () => {
    const source = 'class Owner {\n  Owner() {}\n  Owner(String x) { this.x = x; }\n}\n'
    await expect(declared(source, 'Owner.Owner')).resolves.toBe(true)
    await expect(hashOf(source, 'Owner.Owner')).resolves.not.toBe(await hashOf('class Owner {\n  Owner() {}\n}\n', 'Owner.Owner'))
  })

  it('anchors either name of a multi-declarator field to the whole statement', async () => {
    const source = 'class C { private int a, b; }\n'
    await expect(hashOf(source, 'C.a')).resolves.toBe(await hashOf(source, 'C.b'))
    await expect(hashOf(source, 'C.a')).resolves.not.toBe(await hashOf('class C { private int a, c; }\n', 'C.a'))
  })

  it('separates a nested type with a dot, at any depth, and never claims its bare name', async () => {
    const source = 'class Outer {\n  static class Inner {\n    void deep() {}\n    static class Deeper { int n; }\n  }\n}\n'
    await expect(declared(source, 'Outer.Inner')).resolves.toBe(true)
    await expect(declared(source, 'Outer.Inner.deep')).resolves.toBe(true)
    await expect(declared(source, 'Outer.Inner.Deeper.n')).resolves.toBe(true)
    await expect(declared(source, 'Inner')).resolves.toBe(false)
    await expect(declared(source, 'Outer$Inner')).resolves.toBe(false)
    await expect(declared(source, 'Outer.Inner.missing')).resolves.toBe(false)
  })

  it('folds a nested type and a same-named member into one unit, the overload rule again', async () => {
    const source = 'class Outer {\n  int Inner;\n  static class Inner { int n; }\n}\n'
    await expect(hashOf(source, 'Outer.Inner')).resolves.not.toBe(await hashOf('class Outer {\n  int Inner;\n}\n', 'Outer.Inner'))
    // The nested type's own members stay reachable through the longer path.
    await expect(declared(source, 'Outer.Inner.n')).resolves.toBe(true)
  })

  it('claims nothing from the file\'s non-declarations', async () => {
    const source = 'package org.example;\n\nimport java.util.List;\n\nclass C {}\n'
    await expect(declared(source, 'List')).resolves.toBe(false)
    await expect(declared(source, 'org.example')).resolves.toBe(false)
  })

  it('reports a symbol it cannot find rather than hashing the whole file', async () => {
    await expect(javaEvaluator.lookup('class C { void m() {} }\n', 'C.n')).resolves.toEqual({ declared: false, hash: undefined })
  })

  it('still finds what the parser can reach in a file that no longer parses cleanly', async () => {
    const broken = 'class C {\n  void ok() {}\n}\n\nclass Broken {\n  void bad( {\n'
    await expect(declared(broken, 'C.ok')).resolves.toBe(true)
    await expect(declared(broken, 'Broken.bad')).resolves.toBe(false)
  })

  it('claims .java files through the registry', () => {
    expect(evaluatorFor('src/main/java/org/example/Owner.java')).toBe(javaEvaluator)
  })
})

describe('the spring-petclinic sample', () => {
  // tests/fixtures/Owner.java is a verbatim read-only copy of the sample
  // repository's src/main/java/org/springframework/samples/petclinic/owner/
  // Owner.java (Apache-2.0, header retained). It is here for the shape a
  // hand-written fixture would not force: three real overloads of one name,
  // under Javadoc, beside annotated fields.
  const fixture = readFile(join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/Owner.java'), 'utf8')

  it('declares the class, its annotated fields, and its methods as Type.name', async () => {
    const source = await fixture
    for (const symbol of [
      'Owner',
      'Owner.address',
      'Owner.city',
      'Owner.telephone',
      'Owner.pets',
      'Owner.getAddress',
      'Owner.setAddress',
      'Owner.getPets',
      'Owner.addPet',
      'Owner.getPet',
      'Owner.toString',
      'Owner.addVisit',
    ]) {
      await expect(javaEvaluator.lookup(source, symbol)).resolves
        .toMatchObject({ declared: true, hash: expect.stringMatching(/^sha1:[0-9a-f]{40}$/) as string })
    }
    await expect(declared(source, 'getPet')).resolves.toBe(false)
    // Its three getPet overloads are one unit: dropping the last moves it.
    const withoutLast = source.replace(/\tpublic Pet getPet\(String name, boolean ignoreNew\) \{[\s\S]*?\n\t\}\n/, '')
    expect(withoutLast).not.toBe(source)
    await expect(hashOf(withoutLast, 'Owner.getPet')).resolves.not.toBe(await hashOf(source, 'Owner.getPet'))
  })
})

describe('composed through the store', () => {
  it('reports a document stale once its anchored Java symbol changes', async () => {
    const specRoot = await mkdtemp(join(tmpdir(), 'spec-java-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'spec-java-repo-'))
    try {
      await mkdir(join(repoRoot, 'src/main/java/org/example/owner'), { recursive: true })
      const file = 'src/main/java/org/example/owner/Owner.java'
      await writeFile(join(repoRoot, file), ORIGINAL, 'utf8')
      const ctx = new Context()
      await ctx.plugin(SpecStore, { root: specRoot, repoRoot })
      const store = ctx.get('devflowSpec') as InstanceType<typeof SpecStore>

      const written = await store.write(store.resolveWrite({
        id: 'owner/pet-lookup',
        title: 'Pet lookup by name',
        body: '## Source of truth\n\nThe accessor [[a1]] resolves a pet by name.\n',
        anchors: [{ id: 'a1', kind: 'content-hash', file, symbol: 'Owner.getPet' }],
      }))
      expect(written).toMatchObject({ ok: true, document: { freshness: 'fresh' } })
      expect(await readFile(join(specRoot, 'owner/pet-lookup.md'), 'utf8')).toMatch(/hash: sha1:[0-9a-f]{40}/)

      await writeFile(join(repoRoot, file), ORIGINAL.replace('name.toLowerCase()', 'name'), 'utf8')
      const document = await store.read('owner/pet-lookup')
      expect(document.freshness).toBe('stale')
      expect(document.verdicts[0]).toMatchObject({ status: 'stale', reason: expect.stringContaining(`Owner.getPet in ${file} changed`) as string })
    } finally {
      await rm(specRoot, { recursive: true, force: true })
      await rm(repoRoot, { recursive: true, force: true })
    }
  })
})
