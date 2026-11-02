# Review Prompts Reference

This file contains detailed criteria for each review dimension. The agent should internalize these when analyzing a PR diff.

## Security Review

Look for:

- **Injection**: SQL injection (string concatenation in queries), command injection (unsanitized input in exec/spawn), XSS (unescaped user input in HTML/templates)
- **Secrets**: Hardcoded API keys, tokens, passwords, private keys in source code
- **Auth/AuthZ**: Missing authentication checks, broken access control, privilege escalation paths
- **Dependencies**: Known vulnerable packages being added, typosquatting package names
- **Crypto**: Weak algorithms (MD5/SHA1 for security), hardcoded IVs/salts, insecure random
- **Data exposure**: Sensitive data in logs, error messages leaking internals, PII in URLs

Severity guide:
- Critical: exploitable vulnerability, leaked secret, missing auth on sensitive endpoint
- Warning: potential issue that needs context to confirm
- Suggestion: defense-in-depth improvement

## Performance Review

Look for:

- **N+1 queries**: Loop that makes a DB/API call per iteration instead of batching
- **Unbounded operations**: Missing pagination, loading entire tables, no LIMIT clause
- **Memory**: Large arrays built in memory that could stream, unclosed resources/handles
- **Blocking**: Synchronous I/O in async context, CPU-heavy work on event loop
- **Redundant work**: Repeated computation that could be cached/memoized, unnecessary re-renders
- **Network**: Missing connection pooling, no timeout on external calls, chatty APIs

Severity guide:
- Critical: will cause outage under normal load (unbounded query, memory leak)
- Warning: degrades performance noticeably (N+1, missing cache)
- Suggestion: optimization opportunity (minor inefficiency)

## Quality Review

Look for:

- **Naming**: Unclear variable/function names, inconsistent naming conventions within the file
- **Complexity**: Deeply nested conditionals (>3 levels), functions >50 lines, god objects
- **Duplication**: Copy-pasted logic that should be extracted, repeated patterns
- **Consistency**: Mixed patterns within the same codebase (e.g., callbacks vs promises)
- **Error handling**: Swallowed errors, generic catch-all without logging, missing error types
- **Dead code**: Unreachable branches, commented-out code, unused imports/variables

Severity guide:
- Critical: will cause bugs (swallowed error hiding failures, race condition)
- Warning: maintainability concern (high complexity, significant duplication)
- Suggestion: style/readability improvement

## Test Review

Look for:

- **Missing coverage**: New public functions/endpoints without corresponding tests
- **Edge cases**: Only happy path tested, missing null/empty/boundary checks
- **Test quality**: Tests that always pass (no real assertion), flaky time-dependent tests
- **Mocking**: Over-mocking that hides real integration issues, mocking what you own
- **Regression**: Bug fix without a test that would have caught the original bug

Severity guide:
- Critical: untested critical path (auth, payment, data mutation)
- Warning: missing tests for new logic that could regress
- Suggestion: additional edge case coverage

## Language-Specific Patterns

### TypeScript/JavaScript
- `any` type usage where a proper type exists
- Missing `await` on async calls
- `==` instead of `===`
- Prototype pollution via `Object.assign` from user input

### Java
- Unclosed streams/connections (missing try-with-resources)
- Mutable shared state without synchronization
- `@SuppressWarnings` hiding real issues
- Missing `@Override` annotations

### Python
- Mutable default arguments
- Bare `except:` clauses
- Missing type hints on public API
- `eval()`/`exec()` with user input

### SQL
- String interpolation instead of parameterized queries
- `SELECT *` in production code
- Missing indexes on frequently queried columns
- Transactions not used for multi-step mutations
