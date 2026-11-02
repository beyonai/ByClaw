#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYCLAW_UPLOAD_BYTES = 20 * 1024 * 1024;
const fileOptionIndex = process.argv.indexOf('--file');
const fileEqualsOption = process.argv.find((value) => value.startsWith('--file='));
const fileOption = fileOptionIndex >= 0 && fileOptionIndex + 1 < process.argv.length
  ? process.argv[fileOptionIndex + 1]
  : fileEqualsOption?.slice('--file='.length);
if (fileOption) {
  const filePath = path.resolve(fileOption);
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_BYCLAW_UPLOAD_BYTES) {
      console.log(JSON.stringify({
        pass: false,
        file_path: filePath,
        file_name: path.basename(filePath),
        file_size: stat.size,
        reason: 'File exceeds the 20.0 MB ByClaw runtime upload limit.',
      }));
      process.exit(1);
    }
  } catch {
    // The verified upstream preflight prints the canonical file access error.
  }
}

require('./knowledge-base/scripts/preflight-check.cjs');
