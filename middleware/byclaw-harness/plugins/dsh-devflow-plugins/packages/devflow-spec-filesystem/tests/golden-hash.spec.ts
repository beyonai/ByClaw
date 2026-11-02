// The hash-domain invariance lines, one per language. Every TypeScript digest
// literal was computed from the implementation as it stood BEFORE the
// evaluator seam existed (recorded
// independently in the task research, so the baseline is auditable outside
// this file). The relational specs in normalize.spec.ts would stay green
// through a refactor that shifted every hash in lockstep; these literals are
// what catch that. A failure here is a regression in the hash domain — every
// published content-hash anchor would go stale at once — so fix the code.
// Never update a literal to match new output.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateAnchor, hashSymbol } from '@zhchxiao123/dsh-devflow-spec-filesystem'
import type { SpecAnchor } from '@zhchxiao123/dsh-devflow-spec'
import { goEvaluator } from '../src/evaluators/go.ts'
import { javaEvaluator } from '../src/evaluators/java.ts'
import { pythonEvaluator } from '../src/evaluators/python.ts'
import { rustEvaluator } from '../src/evaluators/rust.ts'

// Byte-for-byte the ORIGINAL fixture of normalize.spec.ts, frozen here so an
// edit over there cannot silently move this baseline's input.
const FUNCTION_FIXTURE = `export function isLegalTransition(from: string, to: string): boolean {
  // Main flow follows the pipeline order.
  if (from === to) return false
  return FLOW[from].includes(to)
}`
const FUNCTION_DIGEST = 'sha1:206cf39712893058ae086b891047a5a3a37908ea'

describe('golden hashes', () => {
  it('hashes a function declaration to its recorded digest', () => {
    expect(hashSymbol(FUNCTION_FIXTURE, 'isLegalTransition')).toBe(FUNCTION_DIGEST)
  })

  it('hashes a type alias to its recorded digest', () => {
    expect(hashSymbol('export type DevStage = "draft" | "done"', 'DevStage')).toBe('sha1:837d17709511cc2fd9b1b71cd1094f43fbc2bfe4')
  })

  it('hashes a const assertion to its recorded digest', () => {
    expect(hashSymbol('export const DEV_STAGES = ["draft"] as const', 'DEV_STAGES')).toBe('sha1:1b39a3e98aba2d2992f1745c0b9b8053829b8c48')
  })

  it('hashes either name of a multi-declarator statement to the whole statement\'s recorded digest', () => {
    expect(hashSymbol('const first = 1, second = 2', 'first')).toBe('sha1:b49f5e7ea7c137a313d1b9043333533adf047f17')
    expect(hashSymbol('const first = 1, second = 2', 'second')).toBe('sha1:b49f5e7ea7c137a313d1b9043333533adf047f17')
  })

  // The Python and Go invariance lines. Each digest literal was computed from
  // the evaluator at the moment its normalization rules were frozen (step 2/3
  // of the multilang task); the rules and the grammar wasm version are the
  // hash domain, so a failure here means that domain moved — every published
  // content-hash anchor of the language would go stale at once. Fix the code.
  // Never update a literal to match new output.
  it('hashes a Python function, assignment, and decorated class to their recorded digests', async () => {
    const functionFixture = `def is_legal_transition(source: str, target: str) -> bool:
    # Main flow follows the pipeline order.
    if source == target:
        return False
    return target in FLOW[source]
`
    await expect(pythonEvaluator.lookup(functionFixture, 'is_legal_transition')).resolves
      .toEqual({ declared: true, hash: 'sha1:f099caeac1ad47dba24a6be230619b60fcf85e81' })
    await expect(pythonEvaluator.lookup('DEV_STAGES = ["draft", "done"]\n', 'DEV_STAGES')).resolves
      .toEqual({ declared: true, hash: 'sha1:d99e8d4ab19dedec57a1900bf940ea94a016af6e' })
    const decoratedFixture = `@dataclass
class EmailData:
    html_content: str
    subject: str
`
    await expect(pythonEvaluator.lookup(decoratedFixture, 'EmailData')).resolves
      .toEqual({ declared: true, hash: 'sha1:1b3f4d153d26eca1c94f476413bd1ab9d1c3f57c' })
  })

  it('hashes a Go function, const group, and method to their recorded digests', async () => {
    const functionFixture = `package model

func NewEntry(status string) *Entry {
	// Callers own the timestamps.
	return &Entry{Status: status}
}
`
    await expect(goEvaluator.lookup(functionFixture, 'NewEntry')).resolves
      .toEqual({ declared: true, hash: 'sha1:978efe612b56603b56cd91c982d7a9042662e4c4' })
    const groupFixture = `package model

const (
	EntryStatusUnread = "unread"
	EntryStatusRead   = "read"
)
`
    await expect(goEvaluator.lookup(groupFixture, 'EntryStatusUnread')).resolves
      .toEqual({ declared: true, hash: 'sha1:f18c54249e8bf1977c7b92432af210a311b5df4a' })
    await expect(goEvaluator.lookup(groupFixture, 'EntryStatusRead')).resolves
      .toEqual({ declared: true, hash: 'sha1:f18c54249e8bf1977c7b92432af210a311b5df4a' })
    const methodFixture = `package model

func (e *Entry) IsRead() bool {
	return e.Status == EntryStatusRead
}
`
    await expect(goEvaluator.lookup(methodFixture, 'Entry.IsRead')).resolves
      .toEqual({ declared: true, hash: 'sha1:cf67037dc73346742836801b6d0de2944315de56' })
  })

  // The Rust and Java invariance lines, frozen the same way one phase later:
  // each literal was computed from the evaluator at the moment its
  // normalization rules and its naming rules were decided. Every rule the two
  // module docs record is inside these digests — Rust's dropped doc comment
  // and hashed attribute, Java's overload group and hashed annotations — so a
  // failure here means one of those decisions changed and every published
  // content-hash anchor of the language would go stale at once. Fix the code.
  // Never update a literal to match new output.
  it('hashes a Rust function, inherent method, and generic trait impl member to their recorded digests', async () => {
    const functionFixture = `use std::net::IpAddr;

/// Reports whether the address may reach an internal service.
#[inline]
pub fn is_internal(ip: &IpAddr) -> bool {
    // Loopback is always ours.
    ip.is_loopback()
}
`
    await expect(rustEvaluator.lookup(functionFixture, 'is_internal')).resolves
      .toEqual({ declared: true, hash: 'sha1:65db364715f682691c375dc198329547013a7849' })
    const implFixture = `impl VerdictRecord {
    pub async fn is_current(&self, clock: &SystemClock) -> bool {
        clock.now().await.duration_since(self.observed_at).is_ok()
    }
}
`
    await expect(rustEvaluator.lookup(implFixture, 'VerdictRecord.is_current')).resolves
      .toEqual({ declared: true, hash: 'sha1:54e63e3cf1e2ffe49b85f0d65197b2c7eb2c6260' })
    const traitImplFixture = `#[async_trait]
impl<'a> VerdictSource<'a> for SessionStore {
    type Error = EvictionError;

    async fn verdict(&self, key: &'a VerdictKey) -> Result<Freshness, Self::Error> {
        Ok(self.freshness(key, SystemTime::now()))
    }
}
`
    await expect(rustEvaluator.lookup(traitImplFixture, 'SessionStore.verdict')).resolves
      .toEqual({ declared: true, hash: 'sha1:d1a6fd0f02498555f105a5eb8f9d4f9f0fa386b9' })
    await expect(rustEvaluator.lookup(traitImplFixture, 'SessionStore.Error')).resolves
      .toEqual({ declared: true, hash: 'sha1:fd8042d2a3cbb7595d24290fff1678a45742dc46' })
  })

  // The three Java fixtures below are condensed from spring-petclinic's
  // Owner.java (Apache-2.0); tests/fixtures/Owner.java is the verbatim copy
  // that retains the upstream header.
  it('hashes a Java annotated field, overload group, and nested class method to their recorded digests', async () => {
    const fieldFixture = `public class Owner extends Person {

	@Column
	@NotBlank
	@Pattern(regexp = "[0-9]{10}", message = "{telephone.invalid}")
	private String telephone;

}
`
    await expect(javaEvaluator.lookup(fieldFixture, 'Owner.telephone')).resolves
      .toEqual({ declared: true, hash: 'sha1:df2eb07d73b4a20961005f04773830859d7990b7' })
    const overloadFixture = `public class Owner {

	/** By name. */
	public Pet getPet(String name) {
		return getPet(name, false);
	}

	/** By id. */
	public Pet getPet(Integer id) {
		return byId(id);
	}

}
`
    await expect(javaEvaluator.lookup(overloadFixture, 'Owner.getPet')).resolves
      .toEqual({ declared: true, hash: 'sha1:d175a340376976409d1863a52eb9a61265cc80b8' })
    const nestedFixture = `public class Owner {

	static class Pets {
		void add(Pet pet) {
			items.add(pet);
		}
	}

}
`
    await expect(javaEvaluator.lookup(nestedFixture, 'Owner.Pets.add')).resolves
      .toEqual({ declared: true, hash: 'sha1:f5c0f194bf835f38c3341f08b998bc32b19047e9' })
  })

  // End to end through evaluateAnchor: proves the dispatch layer in front of
  // the TypeScript evaluator still reaches the implementation that produced
  // the recorded digest, not a lookalike.
  it('reports fresh for a content-hash anchor carrying the recorded digest', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'spec-golden-'))
    try {
      await mkdir(join(repoRoot, 'src'), { recursive: true })
      await writeFile(join(repoRoot, 'src/stages.ts'), FUNCTION_FIXTURE, 'utf8')
      const anchor: SpecAnchor = { id: 'a1', kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegalTransition', hash: FUNCTION_DIGEST }
      const verdict = await evaluateAnchor(anchor, { repoRoot, updatedAt: '2026-09-13T00:00:00.000Z' })
      expect(verdict).toEqual({ id: 'a1', status: 'fresh' })
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })
})
