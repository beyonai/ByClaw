export class DomainError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
