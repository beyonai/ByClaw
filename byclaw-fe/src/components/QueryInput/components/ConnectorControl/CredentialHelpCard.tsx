import { useState } from 'react';
import styles from './CredentialHelpCard.module.less';

interface CredentialHelpCardProps {
  helpText: string;
}

interface HelpSection {
  body: string;
  steps?: string[];
  title?: string;
  warning: boolean;
}

const SECTION_HEADING_PATTERN = /^([^：:\n]{1,20})[：:]\s*(.*)$/;
const STEP_PATTERN = /^\d+[.、]\s*(.+)$/;
const WARNING_HEADING_PATTERN = /安全|注意|警告/;

const parseHelpSections = (helpText: string): HelpSection[] =>
  helpText
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const headingMatch = lines[0]?.match(SECTION_HEADING_PATTERN);
      if (!headingMatch) {
        return { body: lines.join('\n'), warning: false };
      }

      const title = headingMatch[1].trim();
      const contentLines = [headingMatch[2], ...lines.slice(1)].map((line) => line.trim()).filter(Boolean);
      const stepMatches = contentLines.map((line) => line.match(STEP_PATTERN));
      const steps =
        stepMatches.length > 0 && stepMatches.every(Boolean)
          ? stepMatches.map((match) => match?.[1].trim() ?? '')
          : undefined;

      return {
        body: steps ? '' : contentLines.join('\n'),
        steps,
        title,
        warning: WARNING_HEADING_PATTERN.test(title),
      };
    });

const CredentialHelpCard = ({ helpText }: CredentialHelpCardProps) => {
  const sections = parseHelpSections(helpText);
  const hasStructuredSection = sections.some((section) => section.title);
  const [expandedStepSections, setExpandedStepSections] = useState<Set<number>>(() => new Set());

  const toggleStepSection = (index: number) => {
    setExpandedStepSections((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (!hasStructuredSection) {
    return (
      <section aria-label="凭据获取说明" className={styles.credentialHelpCard}>
        <p className={styles.fallbackText}>{helpText.trim()}</p>
      </section>
    );
  }

  return (
    <section aria-label="凭据获取说明" className={styles.credentialHelpCard}>
      {sections.map((section, index) => (
        <div
          className={`${styles.helpSection}${section.warning ? ` ${styles.warningSection}` : ''}`}
          key={`${section.title ?? '说明'}-${index}`}
        >
          {section.title &&
            (section.steps ? (
              <h3>
                <button
                  aria-controls={`credential-help-steps-${index}`}
                  aria-expanded={expandedStepSections.has(index)}
                  className={styles.stepToggle}
                  type="button"
                  onClick={() => toggleStepSection(index)}
                >
                  <span>{section.title}</span>
                  <span
                    aria-hidden="true"
                    className={`${styles.stepToggleIcon}${
                      expandedStepSections.has(index) ? ` ${styles.stepToggleIconExpanded}` : ''
                    }`}
                  >
                    ›
                  </span>
                </button>
              </h3>
            ) : (
              <h3>{section.title}</h3>
            ))}
          {section.steps
            ? expandedStepSections.has(index) && (
              <ol id={`credential-help-steps-${index}`}>
                {section.steps.map((step, stepIndex) => (
                  <li key={`${stepIndex}-${step}`}>{step}</li>
                ))}
              </ol>
            )
            : section.body && <p>{section.body}</p>}
        </div>
      ))}
    </section>
  );
};

export default CredentialHelpCard;
