import fs from 'fs';
import path from 'path';

describe('enterprise skill dropdown motion styles', () => {
  it('fades the menu without moving or clipping the positioned popup', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../index.module.less'), 'utf8');
    const motionStart = styles.indexOf('.enterprise-skill-dropdown-motion-enter');
    const motionEnd = styles.indexOf('@media (prefers-reduced-motion: reduce)');
    const motionStyles = styles.slice(motionStart, motionEnd);

    expect(motionStyles).toContain('transition: opacity');
    expect(motionStyles).not.toContain('clip-path');
    expect(motionStyles).not.toMatch(/\btransform(?:-origin)?:/);
  });
});
