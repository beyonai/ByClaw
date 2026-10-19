// The Rust evaluator: what counts as a declaration — including the naming
// questions an `impl` block forces, which the module doc decides — and which
// formatting dimensions must not move a content hash. rustfmt's dimensions are
// line rewrapping, indentation, attribute placement, and the trailing comma it
// adds when it explodes a container; unlike Go there is no semicolon insertion,
// so removing newlines is a legal reformat here too.
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SpecStore from '@zhchxiao123/dsh-devflow-spec-filesystem'
import { evaluatorFor } from '../src/evaluators/registry.ts'
import { rustEvaluator } from '../src/evaluators/rust.ts'

async function hashOf(source: string, symbol: string): Promise<string | undefined> {
  return (await rustEvaluator.lookup(source, symbol)).hash
}

async function declared(source: string, symbol: string): Promise<boolean> {
  return (await rustEvaluator.lookup(source, symbol)).declared
}

const ORIGINAL = `use std::net::IpAddr;

/// Reports whether the address may reach an internal service.
pub fn is_internal(ip: &IpAddr) -> bool {
    // Loopback is always ours.
    ip.is_loopback() || ip.to_string().starts_with("10.")
}
`

describe('normalization', () => {
  it('survives a comment rewrite, and does not mistake // inside a string for one', async () => {
    const uncommented = ORIGINAL.replace('    // Loopback is always ours.\n', '')
    await expect(hashOf(uncommented, 'is_internal')).resolves.toBe(await hashOf(ORIGINAL, 'is_internal'))
    const otherPrefix = ORIGINAL.replace('"10."', '"//10."')
    await expect(hashOf(otherPrefix, 'is_internal')).resolves.not.toBe(await hashOf(ORIGINAL, 'is_internal'))
  })

  it('drops doc comments too: rustdoc is not a running program, unlike Python\'s __doc__', async () => {
    const reworded = ORIGINAL.replace('may reach an internal service', 'is on the private side')
    await expect(hashOf(reworded, 'is_internal')).resolves.toBe(await hashOf(ORIGINAL, 'is_internal'))
    const inner = 'fn f() {\n    //! inner doc\n    1\n}\n'
    await expect(hashOf(inner, 'f')).resolves.toBe(await hashOf('fn f() {\n    1\n}\n', 'f'))
    const block = '/** block doc */\nfn g() {}\n'
    await expect(hashOf(block, 'g')).resolves.toBe(await hashOf('fn g() {}\n', 'g'))
  })

  it('hashes the #[doc] attribute /// desugars to, the asymmetry the module doc accepts', async () => {
    const bare = 'fn f() {}\n'
    const desugared = '#[doc = "What f does."]\nfn f() {}\n'
    await expect(hashOf(desugared, 'f')).resolves.not.toBe(await hashOf(bare, 'f'))
    await expect(hashOf(desugared, 'f')).resolves.not.toBe(await hashOf('/// What f does.\nfn f() {}\n', 'f'))
    // Its prose is inside the hash, which is what hand-writing the attribute costs.
    await expect(hashOf('#[doc = "Something else."]\nfn f() {}\n', 'f')).resolves.not.toBe(await hashOf(desugared, 'f'))
  })

  it('hashes attributes with the item they modify, across an intervening doc comment', async () => {
    const derived = '#[derive(Serialize)]\npub struct S {\n    pub n: u32,\n}\n'
    const plain = 'pub struct S {\n    pub n: u32,\n}\n'
    await expect(hashOf(derived, 'S')).resolves.not.toBe(await hashOf(plain, 'S'))
    const other = derived.replace('Serialize', 'Deserialize')
    await expect(hashOf(other, 'S')).resolves.not.toBe(await hashOf(derived, 'S'))
    const documented = '#[derive(Serialize)]\n/// What S is.\npub struct S {\n    pub n: u32,\n}\n'
    await expect(hashOf(documented, 'S')).resolves.toBe(await hashOf(derived, 'S'))
  })

  it('does not carry a previous item\'s attributes into the next declaration', async () => {
    const both = '#[derive(Debug)]\nstruct A {}\n\nstruct B {}\n'
    await expect(hashOf(both, 'B')).resolves.toBe(await hashOf('struct B {}\n', 'B'))
  })

  it('survives a rustfmt rewrap, newlines included, and the trailing commas it explodes with', async () => {
    const formatted = 'pub fn f(\n    a: u32,\n    b: u32,\n) -> u32 {\n    call(\n        a,\n        b,\n    )\n}\n'
    await expect(hashOf(formatted, 'f')).resolves.toBe(await hashOf('pub fn f(a: u32, b: u32) -> u32 { call(a, b) }\n', 'f'))
    await expect(hashOf('struct S {\n    a: u32,\n    b: u32,\n}\n', 'S')).resolves.toBe(await hashOf('struct S { a: u32, b: u32 }\n', 'S'))
    await expect(hashOf('enum E {\n    A,\n    B,\n}\n', 'E')).resolves.toBe(await hashOf('enum E { A, B }\n', 'E'))
  })

  it('keeps a one-element tuple\'s comma, which is meaning rather than formatting', async () => {
    await expect(hashOf('const X: (u32,) = (1,);\n', 'X')).resolves.not.toBe(await hashOf('const X: (u32) = (1);\n', 'X'))
  })

  it('keeps semicolons: one turns the block\'s trailing expression into a statement', async () => {
    await expect(hashOf('fn f() -> u32 {\n    1\n}\n', 'f')).resolves.not.toBe(await hashOf('fn f() -> u32 {\n    1;\n}\n', 'f'))
  })

  it('moves when a statement changes blocks: the braces are tokens in the stream', async () => {
    const guarded = 'fn f(o: &mut O) {\n    if o.a {\n        o.b = 1;\n    }\n    o.c = 2;\n}\n'
    const moved = 'fn f(o: &mut O) {\n    if o.a {\n        o.b = 1;\n        o.c = 2;\n    }\n}\n'
    await expect(hashOf(guarded, 'f')).resolves.not.toBe(await hashOf(moved, 'f'))
  })
})

describe('symbol lookup', () => {
  it('finds each of the item forms a spec cites', async () => {
    await expect(declared('fn f() {}\n', 'f')).resolves.toBe(true)
    await expect(declared('pub struct S { n: u32 }\n', 'S')).resolves.toBe(true)
    await expect(declared('enum E { A }\n', 'E')).resolves.toBe(true)
    await expect(declared('union U { a: u32 }\n', 'U')).resolves.toBe(true)
    await expect(declared('trait T { fn m(&self); }\n', 'T')).resolves.toBe(true)
    await expect(declared('type Alias = u32;\n', 'Alias')).resolves.toBe(true)
    await expect(declared('const C: u32 = 1;\n', 'C')).resolves.toBe(true)
    await expect(declared('static S: u32 = 2;\n', 'S')).resolves.toBe(true)
    await expect(declared('mod inner { pub fn q() {} }\n', 'inner')).resolves.toBe(true)
  })

  it('claims macro_rules! by name, comments in its body normalized away like any other', async () => {
    const documented = 'macro_rules! shout {\n    // The only rule.\n    ($a:expr) => { $a };\n}\n'
    await expect(declared(documented, 'shout')).resolves.toBe(true)
    await expect(hashOf(documented, 'shout')).resolves.toBe(await hashOf('macro_rules! shout {\n    ($a:expr) => { $a };\n}\n', 'shout'))
  })

  it('anchors an inline mod whole rather than offering a path to what is inside it', async () => {
    const module = 'mod inner {\n    pub fn q() {}\n}\n'
    await expect(declared(module, 'q')).resolves.toBe(false)
    await expect(declared(module, 'inner::q')).resolves.toBe(false)
    await expect(hashOf(module, 'inner')).resolves.not.toBe(await hashOf('mod inner {\n    pub fn q() { work(); }\n}\n', 'inner'))
  })

  it('cites an inherent method as Type.name, never as its bare name', async () => {
    const source = 'impl VerdictRecord {\n    pub fn is_current(&self) -> bool { true }\n}\n'
    await expect(declared(source, 'VerdictRecord.is_current')).resolves.toBe(true)
    await expect(declared(source, 'is_current')).resolves.toBe(false)
  })

  it('strips the impl block\'s generics from the cited name', async () => {
    await expect(declared('impl<T> Foo<T> {\n    fn bar(&self) {}\n}\n', 'Foo.bar')).resolves.toBe(true)
    await expect(declared('impl<T> Foo<T> {\n    fn bar(&self) {}\n}\n', 'Foo<T>.bar')).resolves.toBe(false)
    // Adding a parameter to the impl is not a rename of what the anchor cites.
    await expect(declared('impl<T, U> Foo<T, U> {\n    fn bar(&self) {}\n}\n', 'Foo.bar')).resolves.toBe(true)
    await expect(declared('impl foo::Bar {\n    fn q(&self) {}\n}\n', 'Bar.q')).resolves.toBe(true)
    await expect(declared('impl &Foo {\n    fn r(&self) {}\n}\n', 'Foo.r')).resolves.toBe(true)
  })

  it('cites a trait impl by the type that behaves, not by the trait', async () => {
    const source = 'impl Display for Foo {\n    fn fmt(&self) {}\n}\n'
    await expect(declared(source, 'Foo.fmt')).resolves.toBe(true)
    await expect(declared(source, 'Display.fmt')).resolves.toBe(false)
    // Two trait impls can therefore offer one name; the first in the file wins.
    const twice = 'impl From<A> for Foo {\n    fn from(a: A) -> Self { one() }\n}\nimpl From<B> for Foo {\n    fn from(b: B) -> Self { two() }\n}\n'
    await expect(hashOf(twice, 'Foo.from')).resolves.toBe(await hashOf('impl From<A> for Foo {\n    fn from(a: A) -> Self { one() }\n}\n', 'Foo.from'))
  })

  it('claims the associated consts and types beside the methods', async () => {
    await expect(declared('impl Foo {\n    const LIMIT: u32 = 3;\n}\n', 'Foo.LIMIT')).resolves.toBe(true)
    await expect(declared('impl VerdictSource for Foo {\n    type Error = &\'static str;\n}\n', 'Foo.Error')).resolves.toBe(true)
  })

  it('cites a trait\'s own required items under the trait name', async () => {
    const source = 'trait Store {\n    type Key;\n    fn get(&self, k: Self::Key);\n}\n'
    await expect(declared(source, 'Store.get')).resolves.toBe(true)
    await expect(declared(source, 'Store.Key')).resolves.toBe(true)
    // The signature is the unit: changing it moves the hash.
    await expect(hashOf(source, 'Store.get')).resolves.not.toBe(await hashOf('trait Store {\n    type Key;\n    fn get(&self, k: &Self::Key);\n}\n', 'Store.get'))
  })

  it('claims nothing from an impl whose self type has no name to cite', async () => {
    await expect(declared('impl [u8] {\n    fn s(&self) {}\n}\n', 's')).resolves.toBe(false)
    await expect(declared('impl (A, B) {\n    fn t(&self) {}\n}\n', 't')).resolves.toBe(false)
  })

  it('leaves a struct\'s fields to the struct, which is the declaration they live in', async () => {
    const source = 'pub struct VerdictRecord {\n    pub anchor_id: AnchorId,\n}\n'
    await expect(declared(source, 'VerdictRecord.anchor_id')).resolves.toBe(false)
    await expect(hashOf(source, 'VerdictRecord')).resolves.not.toBe(await hashOf('pub struct VerdictRecord {\n    pub anchor_id: DocumentId,\n}\n', 'VerdictRecord'))
  })

  it('resolves a re-declared name to its first declaration', async () => {
    await expect(hashOf('const A: u32 = 1;\nmod m { pub const A: u32 = 2; }\n', 'A')).resolves.toBe(await hashOf('const A: u32 = 1;\n', 'A'))
  })

  it('reports a symbol it cannot find rather than hashing the whole file', async () => {
    await expect(rustEvaluator.lookup('fn f() {}\n', 'g')).resolves.toEqual({ declared: false, hash: undefined })
    await expect(rustEvaluator.lookup('impl Foo {\n    fn bar(&self) {}\n}\n', 'Foo.baz')).resolves.toEqual({ declared: false, hash: undefined })
  })

  it('still finds what the parser can reach in a file that no longer parses cleanly', async () => {
    const broken = 'fn ok() {}\n\nfn broken( {\n'
    await expect(declared(broken, 'ok')).resolves.toBe(true)
    await expect(declared(broken, 'broken')).resolves.toBe(false)
  })

  it('claims .rs files through the registry', () => {
    expect(evaluatorFor('src/store/session_store.rs')).toBe(rustEvaluator)
  })
})

describe('a whole file', () => {
  // tests/fixtures/session_store.rs is original test data written here rather
  // than copied from anywhere, carrying in one file the shapes the units above
  // exercise a line at a time: free fns, a derived struct, an enum, a type
  // alias, a const and a static, a macro_rules!, an inline mod, an inherent
  // impl with an associated const, a trait, and two trait impls cited by their
  // self type — one of them lifetime-generic with associated types.
  const fixture = readFile(join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/session_store.rs'), 'utf8')

  it('declares the file\'s items, associated items as Type.name with the impl generics stripped', async () => {
    const source = await fixture
    for (const symbol of [
      'VERDICT_TTL',
      'STORES_OPENED',
      'VerdictKey',
      'stale',
      'Freshness',
      'VerdictRecord',
      'Clock',
      'Clock.Instant',
      'Clock.now',
      'SystemClock',
      'SystemClock.Instant',
      'SystemClock.now',
      'SessionStore',
      'is_current',
      'key_for',
      'SessionStore.CAPACITY_HINT',
      'SessionStore.new',
      'SessionStore.record',
      'SessionStore.freshness',
      'SessionStore.evict_expired',
      'SessionStore.evictions',
      'Freshness.fmt',
      'SessionStore.Item',
      'SessionStore.IntoIter',
      'SessionStore.into_iter',
      'trust_window',
    ]) {
      await expect(rustEvaluator.lookup(source, symbol)).resolves
        .toMatchObject({ declared: true, hash: expect.stringMatching(/^sha1:[0-9a-f]{40}$/) as string })
    }
    // The bare method name is nothing, and a struct field belongs to its struct.
    await expect(declared(source, 'into_iter')).resolves.toBe(false)
    await expect(declared(source, 'VerdictRecord.observed_at')).resolves.toBe(false)
  })
})

describe('composed through the store', () => {
  it('reports a document stale once its anchored Rust symbol changes', async () => {
    const specRoot = await mkdtemp(join(tmpdir(), 'spec-rust-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'spec-rust-repo-'))
    try {
      await mkdir(join(repoRoot, 'src'), { recursive: true })
      await writeFile(join(repoRoot, 'src/net.rs'), ORIGINAL, 'utf8')
      const ctx = new Context()
      await ctx.plugin(SpecStore, { root: specRoot, repoRoot })
      const store = ctx.get('devflowSpec') as InstanceType<typeof SpecStore>

      const written = await store.write(store.resolveWrite({
        id: 'src/internal-addresses',
        title: 'Internal address detection',
        body: '## Source of truth\n\nThe predicate [[a1]] decides what counts as internal.\n',
        anchors: [{ id: 'a1', kind: 'content-hash', file: 'src/net.rs', symbol: 'is_internal' }],
      }))
      expect(written).toMatchObject({ ok: true, document: { freshness: 'fresh' } })
      expect(await readFile(join(specRoot, 'src/internal-addresses.md'), 'utf8')).toMatch(/hash: sha1:[0-9a-f]{40}/)

      await writeFile(join(repoRoot, 'src/net.rs'), ORIGINAL.replace('starts_with("10.")', 'starts_with("192.168.")'), 'utf8')
      const document = await store.read('src/internal-addresses')
      expect(document.freshness).toBe('stale')
      expect(document.verdicts[0]).toMatchObject({ status: 'stale', reason: expect.stringContaining('is_internal in src/net.rs changed') as string })
    } finally {
      await rm(specRoot, { recursive: true, force: true })
      await rm(repoRoot, { recursive: true, force: true })
    }
  })
})
