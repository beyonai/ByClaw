import { describe, expect, it } from 'vitest'

const blockedCommands = [
  'playwright test',
  '  "playwright" test',
  '/usr/local/bin/playwright test',
  'env CI=1 playwright test',
  'command playwright test',
  'exec /usr/bin/chromium --headless',
  'npx --yes playwright test',
  'npx playwright@1.62.1 test',
  'npx @playwright/test@1.62.1 test',
  'npx --yes node -e "require(\'playwright\')"',
  'pnpm dlx playwright test',
  'pnpm exec playwright test',
  'pnpm playwright test',
  'npm exec -- playwright test',
  'browser-use --help',
  'google-chrome-stable --headless https://example.com',
  '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless',
  'node -e "require(\'playwright\').chromium.launch()"',
  'node --eval="require(\'playwright\').chromium.launch()"',
  'node -e"require(\'playwright\').chromium.launch()"',
  'node --eval "import(\'puppeteer\')"',
  'node --require=./safe-hook.js --import=playwright app.js',
  'python -c "from playwright.sync_api import sync_playwright"',
  'python -c"import playwright"',
  'python3 -c "import selenium.webdriver"',
  'python -m playwright open https://example.com',
  'bash -c "chromium --remote-debugging-port=9222"',
  'bash -lc "playwright test"',
  '(playwright test)',
  'echo $(playwright test)',
  'echo "$(playwright test)"',
  'echo "it\'s $(playwright test)"',
  'echo `playwright test`',
  'play\\\nwright test',
  'curl http://127.0.0.1:9222/json/version',
  'echo ready && chromium-browser --remote-debugging-pipe',
  'echo ready\nchromium --headless',
] as const

const allowedCommands = [
  'pnpm test tests/browser.spec.ts',
  'pnpm test tests/playwright-policy.spec.ts',
  'pnpm add -D playwright',
  'npm install @playwright/test',
  'yarn add browser-use',
  'pip install browser-use',
  'playwright install chromium',
  'npx --yes playwright install chromium',
  'npx playwright@1.62.1 install chromium',
  'pnpm exec playwright install-deps chromium',
  'pnpm playwright install-deps chromium',
  'python -m playwright install chromium',
  'rg playwright docs/',
  'grep -R "browser-use" README.md',
  'cat docs/playwright.md',
  'printf "%s\\n" "--remote-debugging-port=9222"',
  'echo "Use chromium in the browser documentation"',
  'echo \'$(playwright test)\'',
  'cp browser.css dist/browser.css',
  'tsc src/browser-app.ts',
  'pnpm run build --filter browser-app',
  'pnpm run build -- --remote-debugging-port=9222',
  'node scripts/build-browser-assets.js',
  'node --eval="console.log(\'playwright documentation\')"',
  '# docs; playwright test\necho ready',
  '# $(playwright test); `chromium --headless`\necho ready',
  'cat <<\'EOF\'\nplaywright test; $(chromium --headless)\nEOF\necho ready',
  'cat <<"DOC"\nnode -e "require(\'playwright\')"\nDOC\necho ready',
] as const

describe('browser command policy', () => {
  it.each(blockedCommands)('rejects model-initiated direct browser access: %s', async (command) => {
    const policy = await import('../src/browser-command-policy.ts').catch(() => undefined)

    let thrown: unknown
    try {
      policy?.assertBrowserCommandAllowed(command)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      code: 'DIRECT_BROWSER_ACCESS_DENIED',
      message: 'Direct browser access is disabled; use the DSH browser tool.',
    })
  })

  it.each(allowedCommands)('allows non-runtime browser references and build/install flows: %s', async (command) => {
    const policy = await import('../src/browser-command-policy.ts').catch(() => undefined)

    expect(() => policy?.assertBrowserCommandAllowed(command)).not.toThrow()
  })

  it('enforces the policy at resolve before sandbox forwarding and RTK wrapping', async () => {
    const plugin = await import('../src/index.ts')
    const executor = Object.create(plugin.ForwardingSandboxBashExecutor.prototype) as plugin.ForwardingSandboxBashExecutor

    let thrown: unknown
    try {
      executor.resolve({ command: 'env TOKEN=do-not-log npx playwright test' })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      code: 'DIRECT_BROWSER_ACCESS_DENIED',
      message: 'Direct browser access is disabled; use the DSH browser tool.',
    })
    expect(String(thrown)).not.toContain('do-not-log')
  })

  it('denies pathological nested package runners without recursion failure or input disclosure', async () => {
    const policy = await import('../src/browser-command-policy.ts')
    const command = `${'npx '.repeat(6_000)}playwright test nested-secret`

    let thrown: unknown
    try {
      policy.assertBrowserCommandAllowed(command)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      code: 'DIRECT_BROWSER_ACCESS_DENIED',
      message: 'Direct browser access is disabled; use the DSH browser tool.',
    })
    expect(thrown).toBeInstanceOf(policy.DirectBrowserAccessDeniedError)
    expect(String(thrown)).not.toContain('nested-secret')
  })
})
