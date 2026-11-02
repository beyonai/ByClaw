/**
 * Narrow-viewport breakpoint tests: the boundary the mobile sidebar layout
 * keys off (paired with the CSS @media (max-width: 767px) gates in
 * sidebar.module.css — 767px ≡ widths strictly below NARROW_MAX_WIDTH).
 * Deliberately NOT aligned to the DSH app shell's 1024px breakpoint: the
 * mobile layout is for real narrow screens (phones / portrait tablets).
 */
import { describe, expect, it } from 'vitest'
import { isNarrowWidth, NARROW_MAX_WIDTH } from '../src/client/breakpoints.ts'

describe('narrow-viewport breakpoint', () => {
  it('treats widths below NARROW_MAX_WIDTH as narrow (mobile)', () => {
    expect(NARROW_MAX_WIDTH).toBe(768)
    expect(isNarrowWidth(320)).toBe(true)
    expect(isNarrowWidth(390)).toBe(true)
    expect(isNarrowWidth(600)).toBe(true)
    expect(isNarrowWidth(767)).toBe(true)
  })

  it('treats NARROW_MAX_WIDTH and above as wide (desktop)', () => {
    expect(isNarrowWidth(768)).toBe(false)
    expect(isNarrowWidth(1024)).toBe(false)
    expect(isNarrowWidth(1280)).toBe(false)
    expect(isNarrowWidth(1920)).toBe(false)
  })
})
