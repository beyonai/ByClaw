import { describe, expect, it } from 'vitest'
import { wrapWithRtk } from '../src/rtk-wrap.ts'

describe('wrapWithRtk', () => {
  describe('rtk unavailable', () => {
    it('passes every command through unchanged', () => {
      expect(wrapWithRtk('git status', false)).toBe('git status')
      expect(wrapWithRtk('cargo build --release', false)).toBe('cargo build --release')
    })
  })

  describe('complex shell commands pass through unchanged', () => {
    it('pipes', () => {
      expect(wrapWithRtk('git status | grep modified', true)).toBe('git status | grep modified')
    })
    it('logical lists', () => {
      expect(wrapWithRtk('npm install && npm run build', true)).toBe('npm install && npm run build')
      expect(wrapWithRtk('cargo test || cargo check', true)).toBe('cargo test || cargo check')
    })
    it('semicolon lists', () => {
      expect(wrapWithRtk('cd src; git status', true)).toBe('cd src; git status')
    })
    it('redirections', () => {
      expect(wrapWithRtk('git log > /tmp/log.txt', true)).toBe('git log > /tmp/log.txt')
    })
    it('command substitution and variables', () => {
      expect(wrapWithRtk('echo $(git rev-parse HEAD)', true)).toBe('echo $(git rev-parse HEAD)')
      expect(wrapWithRtk('git commit -m "$MSG"', true)).toBe('git commit -m "$MSG"')
    })
  })

  describe('non-whitelisted commands pass through unchanged', () => {
    it('unknown executable', () => {
      expect(wrapWithRtk('ls -la', true)).toBe('ls -la')
      expect(wrapWithRtk('python script.py', true)).toBe('python script.py')
    })
    it('sudo-prefixed commands are not wrapped', () => {
      expect(wrapWithRtk('sudo git status', true)).toBe('sudo git status')
    })
    it('env-assigned commands are not wrapped', () => {
      expect(wrapWithRtk('FOO=bar git status', true)).toBe('FOO=bar git status')
    })
  })

  describe('whitelisted simple commands are wrapped', () => {
    it('git', () => {
      expect(wrapWithRtk('git status', true)).toBe('rtk git status')
    })
    it('cargo', () => {
      expect(wrapWithRtk('cargo build --release', true)).toBe('rtk cargo build --release')
    })
    it('npm', () => {
      expect(wrapWithRtk('npm install', true)).toBe('rtk npm install')
    })
    it('golangci-lint maps to its rtk subcommand', () => {
      expect(wrapWithRtk('golangci-lint run', true)).toBe('rtk golangci-lint run')
    })
    it('preserves arguments verbatim', () => {
      expect(wrapWithRtk('git log --oneline -10', true)).toBe('rtk git log --oneline -10')
    })
    it('matches the first token case-insensitively', () => {
      expect(wrapWithRtk('GIT status', true)).toBe('rtk git status')
    })
    it('wraps a bare command with no arguments', () => {
      expect(wrapWithRtk('git', true)).toBe('rtk git')
    })
  })

  describe('edge cases', () => {
    it('empty command passes through', () => {
      expect(wrapWithRtk('', true)).toBe('')
    })
    it('whitespace-only command passes through', () => {
      expect(wrapWithRtk('   ', true)).toBe('   ')
    })
    it('preserves leading whitespace', () => {
      expect(wrapWithRtk('  git status', true)).toBe('rtk git status')
    })
  })
})
