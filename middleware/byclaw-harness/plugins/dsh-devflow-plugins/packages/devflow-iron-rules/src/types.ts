/**
 * Vocabulary types of the iron-rules plugin: the rule shape on disk, the
 * recording input, and the optional `devflowIronRules` service another plugin
 * forwards an obligation to.
 *
 * The vocabulary restates `@byclaw/dsh-iron-rules`, which this package was
 * ported from; a semantic divergence from it is a defect in this package.
 * @module @zhchxiao123/dsh-devflow-iron-rules/types
 */

import type {} from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Optional obligation-recording seam published by this plugin. Same
     * validation, same zero-write-on-rejection guarantee, and same immediate
     * context injection as `devflow_record_iron_rule` — this IS that tool's
     * write path, published as a service. Consumers read it with
     * `ctx.get('devflowIronRules')`; a deployment without the plugin simply
     * has nowhere to forward an obligation, and must say so rather than
     * dropping it.
     */
    devflowIronRules: DevflowIronRules
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'devflow-iron-rules': DevflowIronRulesSource
  }
}

/**
 * The typed source stamped on every resident rule message.
 *
 * A dedicated source kind rather than the generic `{ kind: 'plugin' }`: the
 * digest has to survive into durable history so a later pre-step can decide
 * whether the visible context already carries the current rules, and a plugin
 * source has nowhere to put it. Model-visible text therefore holds no hidden
 * state marker.
 */
export interface DevflowIronRulesSource {
  readonly kind: 'devflow-iron-rules'
  /** Rules are read out of files, like other workspace instructions. */
  readonly form: 'instructions'
  /** Marks the complete rule set rather than a single recorded addition. */
  readonly baseline?: true
  /** Identity of the rules this message published. */
  readonly digest: string
  /** The rule ids this message published, in rule order. */
  readonly ids: readonly string[]
}

/** Who owns a rule, which decides how it is presented to the model. */
export type RuleOwner = 'admin' | 'local'

/**
 * Which layer enforces a rule — the triage decision, recorded rather than
 * inferred. `script` means a check script decides violations; `judgement`
 * means only a reader can.
 */
export type RuleEnforcement = 'script' | 'judgement'

/** One parsed rule directory. */
export interface IronRule {
  /** The directory name — the authoritative id. */
  readonly id: string
  /** One-line statement from the frontmatter. */
  readonly title: string
  /** `admin` rules are presented as non-negotiable; `local` is the default. */
  readonly owner: RuleOwner
  /** The Markdown body below the frontmatter, trimmed. */
  readonly body: string
  /** Absolute path of the rule directory. */
  readonly dir: string
  /** Absolute path of `check.sh` when the rule ships one. */
  readonly checkScript?: string
  /**
   * The recorded triage. A rule written before this field existed has it
   * INFERRED from whether a check script is present, so an older directory
   * keeps working rather than being skipped.
   */
  readonly enforcement: RuleEnforcement
  /**
   * Workspace-relative path prefixes the check script watches.
   *
   * `undefined` means the rule never declared any — which is NOT the same as
   * declaring none. Staleness cannot be judged without a declaration, so an
   * undeclared rule is skipped rather than reported either way.
   */
  readonly watches?: readonly string[]
}

/** Everything one discovery pass found, including what it refused. */
export interface RuleSet {
  /** Absolute workspace root the check scripts run in and watches resolve against. */
  readonly projectRoot: string
  /** Absolute path of the rule root, whether or not it exists. */
  readonly rulesDir: string
  /** Parsed rules in directory-name order. */
  readonly rules: readonly IronRule[]
  /** Human-readable reasons individual directories were skipped or corrected. */
  readonly warnings: readonly string[]
}

/** The parsed halves of a `RULE.md`. */
export interface ParsedRuleFile {
  readonly frontmatter: Readonly<Record<string, string>>
  readonly body: string
}

/** How much of a rule's declared watch set still exists on disk. */
export interface WatchStatus {
  /** Paths the rule declared. */
  readonly declared: number
  /** Of those, how many are gone. */
  readonly missing: number
  /**
   * Every declared path is gone, so the check script can only ever pass.
   * Reported as rot; a partial miss is not.
   */
  readonly stale: boolean
}

/** What either entry point supplies to the shared write path. */
export interface RecordInput {
  readonly id: string
  readonly title: string
  readonly body: string
  /**
   * The triage decision, required rather than inferred. Skipping the question
   * "can a script decide this?" is the default way a rule set ends up all
   * prose, so the answer has to be stated.
   */
  readonly enforcement: RuleEnforcement
  /** Check script contents; required by, and only valid for, `enforcement: 'script'`. */
  readonly check?: string
  /** Workspace-relative prefixes the check watches; required for `script`. */
  readonly watches?: readonly string[]
  /**
   * Ids this rule replaces. One id is a revision; several is a cluster merge —
   * the move that lets a rule set shrink instead of only growing.
   */
  readonly replaces?: readonly string[]
}

/** The settled outcome, phrased for whichever surface asked. */
export interface RecordOutcome {
  readonly ok: boolean
  readonly text: string
}

/** The recording surface another plugin may forward an obligation to. */
export interface DevflowIronRules {
  /**
   * Write one rule into the calling agent's workspace and make it effective
   * immediately. Every rejection happens before the first write, so a refused
   * request leaves the rule set exactly as it was.
   * @param agent - the agent whose workspace and context receive the rule.
   * @param input - the rule to write, including any ids it replaces.
   * @returns whether the rule was written, with text for the calling surface.
   */
  record(agent: Agent, input: RecordInput): Promise<RecordOutcome>
}
