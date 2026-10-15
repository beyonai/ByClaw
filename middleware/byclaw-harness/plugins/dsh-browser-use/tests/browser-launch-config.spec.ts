import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatBrowserdStartupError,
  PlaywrightBrowserDriver,
  resolveBrowserLaunchConfiguration,
} from '../src/browserd.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('resolveBrowserLaunchConfiguration', () => {
  it('preserves bounded original startup error detail in browserd logs', () => {
    expect(formatBrowserdStartupError(
      new Error('Chromium profile appears in use\nSingletonLock refused'),
    )).toBe(
      'browserd-start-failed: Chromium profile appears in use SingletonLock refused',
    )
  })

  it('loads only valid unpacked extensions and defaults the persistent profile under DSH_HOME', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-launch-config-'))
    directories.push(directory)
    const extension = join(directory, 'bycli-extension')
    await mkdir(extension)
    await writeFile(join(extension, 'manifest.json'), '{}')
    const missing = join(directory, 'missing-extension')

    await expect(resolveBrowserLaunchConfiguration({
      DSH_HOME: join(directory, 'dsh-home'),
      BYCLAW_BROWSER_EXTENSIONS: [extension, missing].join(delimiter),
    })).resolves.toEqual({
      userDataDir: join(directory, 'dsh-home', 'browser', 'user-data'),
      args: [
        '--disable-dev-shm-usage',
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
      ignoreDefaultArgs: ['--disable-extensions', '--no-startup-window'],
      invalidExtensionPaths: [missing],
    })
  })

  it('supports an explicit user data directory without changing arguments when no extension is configured', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-user-data-'))
    directories.push(directory)
    const userDataDir = join(directory, 'custom-profile')

    await expect(resolveBrowserLaunchConfiguration({
      DSH_HOME: join(directory, 'dsh-home'),
      BYCLAW_BROWSER_USER_DATA_DIR: userDataDir,
    })).resolves.toEqual({
      userDataDir,
      args: ['--disable-dev-shm-usage'],
      invalidExtensionPaths: [],
    })
  })

  it('starts an extension-enabled fallback browser with a real startup window', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-window-'))
    directories.push(directory)
    const extension = join(directory, 'bycli-extension')
    await mkdir(extension)
    await writeFile(join(extension, 'manifest.json'), '{}')
    const executablePath = join(directory, 'record-browser-arguments')
    const capturedArgumentsPath = join(directory, 'browser-arguments.txt')
    await writeFile(
      executablePath,
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$BYCLAW_CAPTURE_ARGS"\nexit 1\n',
    )
    await chmod(executablePath, 0o700)
    const configuration = await resolveBrowserLaunchConfiguration({
      DSH_HOME: join(directory, 'dsh-home'),
      BYCLAW_BROWSER_EXTENSIONS: extension,
    })
    const driver = new PlaywrightBrowserDriver(join(directory, 'downloads'))

    await expect(driver.launch({
      executablePath,
      headless: true,
      args: configuration.args,
      ignoreDefaultArgs: configuration.ignoreDefaultArgs,
      environment: { BYCLAW_CAPTURE_ARGS: capturedArgumentsPath },
    })).rejects.toThrow()

    const childArguments = (await readFile(capturedArgumentsPath, 'utf8')).trim().split('\n')
    expect(childArguments).toContain(`--load-extension=${extension}`)
    expect(childArguments).not.toContain('--disable-extensions')
    expect(childArguments).not.toContain('--no-startup-window')
  })

  it('enables developer mode in the persistent profile before launching unpacked extensions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-developer-mode-'))
    directories.push(directory)
    const extension = join(directory, 'bycli-extension')
    const userDataDir = join(directory, 'user-data')
    const defaultProfile = join(userDataDir, 'Default')
    const preferencesPath = join(defaultProfile, 'Preferences')
    await mkdir(extension)
    await writeFile(join(extension, 'manifest.json'), '{}')
    await mkdir(defaultProfile, { recursive: true })
    await writeFile(preferencesPath, JSON.stringify({
      extensions: { ui: { developer_mode: false } },
      byclawTestMarker: 'preserved',
    }))
    const executablePath = join(directory, 'exit-browser')
    await writeFile(executablePath, '#!/bin/sh\nexit 1\n')
    await chmod(executablePath, 0o700)
    const configuration = await resolveBrowserLaunchConfiguration({
      DSH_HOME: join(directory, 'dsh-home'),
      BYCLAW_BROWSER_EXTENSIONS: extension,
      BYCLAW_BROWSER_USER_DATA_DIR: userDataDir,
    })
    const driver = new PlaywrightBrowserDriver(join(directory, 'downloads'))

    await expect(driver.launch({
      executablePath,
      headless: true,
      userDataDir,
      args: configuration.args,
      ignoreDefaultArgs: configuration.ignoreDefaultArgs,
    })).rejects.toThrow()

    const preferences = JSON.parse(await readFile(preferencesPath, 'utf8'))
    expect(preferences.extensions.ui.developer_mode).toBe(true)
    expect(preferences.byclawTestMarker).toBe('preserved')
  })

  it('clears stale Chromium singleton files while the persistent profile is exclusively owned', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-stale-profile-'))
    directories.push(directory)
    const userDataDir = join(directory, 'user-data')
    await mkdir(userDataDir)
    await symlink('dead-container-490', join(userDataDir, 'SingletonLock'))
    await symlink('stale-cookie', join(userDataDir, 'SingletonCookie'))
    await symlink('/tmp/missing-chromium-socket', join(userDataDir, 'SingletonSocket'))
    const executablePath = join(directory, 'exit-browser')
    await writeFile(executablePath, '#!/bin/sh\nexit 1\n')
    await chmod(executablePath, 0o700)
    const driver = new PlaywrightBrowserDriver(join(directory, 'downloads'), true)

    await expect(driver.launch({
      executablePath,
      headless: true,
      userDataDir,
    })).rejects.toThrow()

    await Promise.all(['SingletonLock', 'SingletonCookie', 'SingletonSocket'].map(async name => {
      await expect(lstat(join(userDataDir, name))).rejects.toMatchObject({ code: 'ENOENT' })
    }))
  })
})
