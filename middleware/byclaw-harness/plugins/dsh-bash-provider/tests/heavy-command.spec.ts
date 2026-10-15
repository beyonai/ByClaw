import { describe, expect, it } from 'vitest'
import { isHeavyCommand } from '../src/heavy-command.ts'

describe('isHeavyCommand', () => {
  describe('bare build tools are heavy', () => {
    it('make and friends', () => {
      expect(isHeavyCommand('make')).toBe(true)
      expect(isHeavyCommand('make -j8 all')).toBe(true)
      expect(isHeavyCommand('gmake install')).toBe(true)
      expect(isHeavyCommand('ninja')).toBe(true)
      expect(isHeavyCommand('cmake --build .')).toBe(true)
      expect(isHeavyCommand('bazel build //...')).toBe(true)
    })

    it('compilers', () => {
      expect(isHeavyCommand('gcc -O2 main.c')).toBe(true)
      expect(isHeavyCommand('g++ -std=c++20 a.cc')).toBe(true)
      expect(isHeavyCommand('clang++ -c x.cpp')).toBe(true)
      expect(isHeavyCommand('rustc main.rs')).toBe(true)
      expect(isHeavyCommand('javac Main.java')).toBe(true)
    })

    it('an absolute or relative path to a build tool', () => {
      expect(isHeavyCommand('/usr/bin/make all')).toBe(true)
      expect(isHeavyCommand('./make')).toBe(true)
    })
  })

  describe('subcommand tools are heavy only in build modes', () => {
    it('cargo', () => {
      expect(isHeavyCommand('cargo build --release')).toBe(true)
      expect(isHeavyCommand('cargo test')).toBe(true)
      expect(isHeavyCommand('cargo clippy')).toBe(true)
      expect(isHeavyCommand('cargo fmt')).toBe(false)
      expect(isHeavyCommand('cargo tree')).toBe(false)
    })

    it('go', () => {
      expect(isHeavyCommand('go build ./...')).toBe(true)
      expect(isHeavyCommand('go test ./pkg')).toBe(true)
      expect(isHeavyCommand('go vet ./...')).toBe(false)
      expect(isHeavyCommand('go mod tidy')).toBe(false)
    })

    it('docker', () => {
      expect(isHeavyCommand('docker build -t app .')).toBe(true)
      expect(isHeavyCommand('docker ps')).toBe(false)
      expect(isHeavyCommand('docker logs web')).toBe(false)
    })

    it('flags between the tool and its subcommand', () => {
      expect(isHeavyCommand('cargo -q build')).toBe(true)
      expect(isHeavyCommand('cargo --offline fmt')).toBe(false)
    })

    it('a bare subcommand tool with no subcommand is not heavy', () => {
      expect(isHeavyCommand('cargo')).toBe(false)
      expect(isHeavyCommand('docker')).toBe(false)
    })
  })

  describe('substring false positives are rejected', () => {
    it('a tool name inside a quoted string', () => {
      expect(isHeavyCommand('echo "make dinner"')).toBe(false)
      expect(isHeavyCommand("echo 'cargo build'")).toBe(false)
    })

    it('a tool name as an argument', () => {
      expect(isHeavyCommand('cat Makefile')).toBe(false)
      expect(isHeavyCommand('ls -la')).toBe(false)
      expect(isHeavyCommand('rm -rf build')).toBe(false)
      expect(isHeavyCommand('grep make README.md')).toBe(false)
    })

    it('a tool name inside a path argument', () => {
      expect(isHeavyCommand('cat /src/cmake/toolchain.txt')).toBe(false)
      expect(isHeavyCommand('cd /home/user/go/src')).toBe(false)
    })

    it('a quoted executable token', () => {
      expect(isHeavyCommand('"make"')).toBe(false)
    })
  })

  describe('leading environment assignments are skipped', () => {
    it('plain assignments', () => {
      expect(isHeavyCommand('CC=clang make')).toBe(true)
      expect(isHeavyCommand('CC=clang CXX=clang++ make -j4')).toBe(true)
      expect(isHeavyCommand('RUSTFLAGS=-C0 cargo build')).toBe(true)
    })

    it('env with assignments', () => {
      expect(isHeavyCommand('env CC=clang make')).toBe(true)
      expect(isHeavyCommand('/usr/bin/env RUSTFLAGS=x cargo build')).toBe(true)
    })

    it('an assignment in front of a light command stays light', () => {
      expect(isHeavyCommand('FOO=bar ls')).toBe(false)
      expect(isHeavyCommand('env FOO=bar echo hi')).toBe(false)
    })
  })

  describe('compound commands classify on the leading segment only', () => {
    it('a build at the head is heavy', () => {
      expect(isHeavyCommand('make && ls')).toBe(true)
      expect(isHeavyCommand('make | tee log.txt')).toBe(true)
      expect(isHeavyCommand('make; echo done')).toBe(true)
    })

    it('a build after the head is a deliberate conservative miss', () => {
      expect(isHeavyCommand('ls && make')).toBe(false)
      expect(isHeavyCommand('cd src && cargo build')).toBe(false)
    })
  })

  describe('degenerate input', () => {
    it('empty and whitespace-only commands are not heavy', () => {
      expect(isHeavyCommand('')).toBe(false)
      expect(isHeavyCommand('   ')).toBe(false)
      expect(isHeavyCommand('\n')).toBe(false)
    })

    it('only assignments, with no command, is not heavy', () => {
      expect(isHeavyCommand('CC=clang')).toBe(false)
    })
  })
})
