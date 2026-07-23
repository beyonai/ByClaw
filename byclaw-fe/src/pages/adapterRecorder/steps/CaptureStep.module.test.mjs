import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('./CaptureStep.module.less', import.meta.url), 'utf8');

assert.match(
  styles,
  /\.recordingCard\s*\{[\s\S]*?:global\(\.beyond-card-body\)/,
  'recording cards must make the Beyond card body a flex container',
);

const workbenchStyles = readFileSync(new URL('../index.module.less', import.meta.url), 'utf8');

assert.match(
  workbenchStyles,
  /\.workbench\s*\{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*hidden;/,
  'the workbench must constrain the shell rather than scroll itself',
);

assert.match(
  workbenchStyles,
  />\s*:global\(\.beyond-card\)\s*>\s*:global\(\.beyond-card-body\)\s*\{[\s\S]*?overflow-y:\s*auto;/,
  'the primary Beyond card body must be the scroll container',
);

assert.match(
  workbenchStyles,
  /\.body\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\);[\s\S]*?overflow:\s*hidden;/,
  'the grid row must be constrained so its content cannot expand the stage height',
);

assert.match(
  workbenchStyles,
  /\.shell\s*\{[\s\S]*?gap:\s*10px;[\s\S]*?\.body\s*\{[\s\S]*?grid-template-columns:\s*180px minmax\(0, 1fr\);[\s\S]*?gap:\s*18px;/,
  'the workspace chrome must leave more room for the active content',
);

assert.match(
  workbenchStyles,
  /\.nextStep\s*\{[\s\S]*?:global\(\.beyond-card-head\)\s*\{[\s\S]*?padding:\s*10px 14px;[\s\S]*?:global\(\.beyond-card-body\)\s*\{[\s\S]*?padding:\s*12px 14px;/,
  'the next-step card must use compact chrome',
);
