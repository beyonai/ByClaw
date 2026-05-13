/* eslint-disable */
import * as katex from 'katex';
import 'katex/dist/katex.min.css';

export interface ShowdownKatexOptions {
  throwOnError?: boolean;
  errorColor?: string;
  displayMode?: boolean;
}

/**
 * Showdown extension to render KaTeX formulas.
 * Supports inline $...$, block $$...$$, and TeX delimiters \(...\), \[...\].
 * Avoids processing formulas inside fenced code blocks and inline code.
 */
export default function showdownKatex(options: ShowdownKatexOptions = {}) {
  const { throwOnError = true, errorColor = '#cc0000' } = options;

  function renderWithKatex(tex: string, displayMode: boolean) {
    try {
      return katex.renderToString(tex, {
        throwOnError,
        errorColor,
        displayMode,
        output: 'html',
      });
    } catch (err) {
      // When throwOnError is false, katex returns error HTML; otherwise, show raw content
      if (!throwOnError) {
        try {
          return katex.renderToString(tex, {
            throwOnError: false,
            errorColor,
            displayMode,
            output: 'html',
          });
        } catch (_) {
          // fallthrough
        }
      }
      return tex;
    }
  }

  // Utility to store and restore placeholders
  function createPlaceholderStore(placeholderPrefix: string) {
    const bucket: string[] = [];
    const token = (index: number) => `${placeholderPrefix}${index}${placeholderPrefix}`;
    return {
      take(content: string) {
        const index = bucket.push(content) - 1;
        return token(index);
      },
      restore(input: string) {
        return input.replace(new RegExp(`${placeholderPrefix}(\\d+)${placeholderPrefix}`, 'g'), (_m, g1) => {
          const i = Number(g1);
          return bucket[i] ?? '';
        });
      },
    };
  }

  // (legacy path removed) Replace inline $...$ logic now handled with placeholder-aware impl

  return [
    {
      type: 'lang',
      filter: (inputText: string) => {
        if (!inputText) return inputText;

        // Showdown replaces all '$' with the placeholder '¨D' BEFORE running lang extensions.
        // So we must look for '¨D' tokens instead of literal '$'.
        const D = '¨D';
        const DD = D + D; // represents '$$'

        // 1) Extract fenced code blocks and inline code to avoid processing math inside code
        const fencedStore = createPlaceholderStore('@@FENCED@@');
        const inlineCodeStore = createPlaceholderStore('@@INLINECODE@@');

        // Fenced blocks ```lang?\n...```
        let working = inputText.replace(/```[\s\S]*?```/g, (m) => fencedStore.take(m));

        // Inline code `...`
        working = working.replace(/`([^`]*?)`/g, (m) => inlineCodeStore.take(m));

        // 2) Render block math: $$...$$ (multi-line allowed) -> uses '¨D¨D' placeholder
        working = working.replace(new RegExp(`${DD}([\\s\\S]+?)${DD}`, 'g'), (_m, g1) =>
          renderWithKatex(g1.trim(), true)
        );

        // 3) Render TeX display delimiters: \[ ... \]
        working = working.replace(/\\\[([\s\S]+?)\\\]/g, (_m, g1) => renderWithKatex(g1.trim(), true));

        // 4) Render TeX inline delimiters: \( ... \)
        working = working.replace(/\\\(([\s\S]+?)\\\)/g, (_m, g1) => renderWithKatex(g1.trim(), false));

        // 5) Render inline $...$ using placeholder '¨D' (no newline)
        function replaceInlineWithPlaceholder(src: string): string {
          let result = '';
          let pos = 0;
          while (pos < src.length) {
            const start = src.indexOf(D, pos);
            if (start === -1) {
              result += src.slice(pos);
              break;
            }
            // copy text before delimiter
            result += src.slice(pos, start);
            // If starts with '$$' placeholder, skip here (already handled as block)
            if (src.startsWith(DD, start)) {
              result += DD;
              pos = start + DD.length;
            } else {
              // find the closing single '¨D'
              const cursorStart = start + D.length;
              let foundAt = -1;
              let cursor = cursorStart; // eslint-disable-line prefer-const
              while (cursor < src.length) {
                const next = src.indexOf(D, cursor);
                if (next === -1) break;
                // prevent newline inside inline math
                const segment = src.slice(start + D.length, next);
                if (segment.indexOf('\n') !== -1 || segment.indexOf('\r') !== -1) {
                  break;
                }
                foundAt = next;
                break;
              }
              if (foundAt !== -1) {
                const tex = src.slice(start + D.length, foundAt);
                const rendered = renderWithKatex(tex, false);
                result += rendered;
                pos = foundAt + D.length;
              } else {
                // no closing delimiter, keep as-is
                result += D;
                pos = start + D.length;
              }
            }
          }
          return result;
        }
        working = replaceInlineWithPlaceholder(working);

        // 6) Restore placeholders
        working = inlineCodeStore.restore(working);
        working = fencedStore.restore(working);

        return working;
      },
    },
  ];
}
