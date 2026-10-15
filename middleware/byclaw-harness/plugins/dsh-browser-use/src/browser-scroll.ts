/** Shared boundary validation; scrolling is bounded and never accepts script/selectors. */
export function validScrollFields(value: Record<string, unknown>): boolean {
  const delta = (number: unknown) => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 10_000
  return delta(value.deltaY) && (value.deltaX === undefined || delta(value.deltaX))
    && (value.element === undefined || (Number.isSafeInteger(value.element) && (value.element as number) > 0))
    && (value.observationId === undefined || (typeof value.observationId === 'string'
      && value.observationId.length > 0 && value.observationId.length <= 128))
}
