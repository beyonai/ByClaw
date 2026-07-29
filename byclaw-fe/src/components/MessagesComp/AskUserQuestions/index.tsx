import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import useGlobal from '@/hooks/useGlobal';
import classnames from 'classnames';
import { get } from 'lodash';
import { useIntl } from '@umijs/max';
import { Button, Checkbox, Input, Radio, Tabs } from 'antd';
import type { InputRef } from 'antd';
import { useRef } from 'react';
import { LayoutMode } from '@/constants/system';
import withEasyConfirm from '@/components/MessagesComp/withEasyConfirm';
import Md from '@/components/Preview/Md';
import { updateMessageStructById } from '@/service/message';
import styles from './index.module.less';
import { IMessageState } from '@/constants/message';

type IAskUserQuestion = {
  question: string;
  header: string;
  options: {
    label: string;
    description: string;
  }[];
  multiSelect?: boolean;
};

export type IAskUserQuestionAnswer = {
  question: string;
  header: string;
  selectedOptions: string[];
  otherSelected: boolean;
  otherText: string;
};

export type FormContent = {
  formStatus: IFormStatus;
  questions?: IAskUserQuestion[];
  answers?: IAskUserQuestionAnswer[];
};

export type IMessageListItemContent = {
  substance: FormContent;
  sourceAgentType?: string;
  formStatus?: IFormStatus;
  submitting?: boolean;
};

export type IProps = {
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  messageListItemContent: IMessageListItemContent;
  messageListItem?: IMessageListItem;
  thinkListItem?: IMessageListItem;
};

/** 是否视为「有有效 metadata」：空串不应挡住助手消息上的完整 JSON */
function isUsableRawMetadata(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') {
    return v.trim() !== '';
  }
  return true;
}

/**
 * 原样透传、不做 JSON 解析。优先本条助手回答上的 metadata（含 LangGraph checkpoint 全量）；
 * 卡片级多为空串或片段，放后面且空串不占优。
 */
function pickRawResumeMetadata(
  messageInfo: IMessage | undefined,
  messageListItemContent: IMessageListItemContent | undefined
): unknown {
  const candidates = [
    messageInfo?.metadata,
    get(messageListItemContent, 'substance.metadata'),
    get(messageListItemContent, 'metadata'),
  ];
  for (const v of candidates) {
    if (isUsableRawMetadata(v)) {
      return v;
    }
  }
  return undefined;
}

/** 将持久化结果与当前问题对齐，避免问题更新后误用旧选项。 */
function normalizeAnswers(
  questions: IAskUserQuestion[],
  answers: IAskUserQuestionAnswer[] | undefined
): IAskUserQuestionAnswer[] {
  return questions.map((item, index) => {
    const savedAnswer = answers?.[index];
    const isMatchingAnswer = savedAnswer?.question === item.question && savedAnswer?.header === item.header;
    const availableLabels = new Set(item.options.map((option) => option.label));
    const selectedOptions = isMatchingAnswer
      ? savedAnswer.selectedOptions.filter((label) => availableLabels.has(label))
      : [];
    const otherSelected = isMatchingAnswer && savedAnswer.otherSelected === true;
    let normalizedSelectedOptions = selectedOptions;
    if (!item.multiSelect) {
      normalizedSelectedOptions = otherSelected ? [] : selectedOptions.slice(0, 1);
    }

    return {
      question: item.question,
      header: item.header,
      selectedOptions: normalizedSelectedOptions,
      otherSelected,
      otherText: isMatchingAnswer && typeof savedAnswer.otherText === 'string' ? savedAnswer.otherText : '',
    };
  });
}

/** 自由填写项只有在被选择且包含有效文本时才作为答案提交。 */
function getEffectiveSelectedOptions(answer: IAskUserQuestionAnswer): string[] {
  const otherText = answer.otherText.trim();
  if (answer.otherSelected && otherText) {
    return [...answer.selectedOptions, otherText];
  }
  return answer.selectedOptions;
}

/** 提交前移除无效的自由填写状态，并清理有效文本两端的空白。 */
function prepareAnswersForSubmit(answers: IAskUserQuestionAnswer[]): IAskUserQuestionAnswer[] {
  return answers.map((answer) => {
    const otherText = answer.otherText.trim();
    return {
      ...answer,
      otherSelected: answer.otherSelected && otherText.length > 0,
      otherText: answer.otherSelected && otherText ? otherText : '',
    };
  });
}

/** 将结构化选项整理为可直接提交给 LLM 的自然语言问答。 */
export function buildQueryQuestion(answers: IAskUserQuestionAnswer[]): string {
  return answers
    .map((answer) => {
      return `${answer.header}: ${getEffectiveSelectedOptions(answer).join(',')}`;
    })
    .join('\n');
}

export function AskUserQuestions(props: IProps) {
  const { updateMessageListItemContent, messageListItemContent, message: messageInfo } = props;

  const { sourceAgentType, submitting, formStatus } = messageListItemContent || {};
  const { questions = [], answers: savedAnswers } = get(messageListItemContent, 'substance') || {};
  const answers = normalizeAnswers(questions, savedAnswers);
  const isAskUserQuestion = questions.length > 0;
  const allQuestionsAnswered =
    isAskUserQuestion && answers.every((answer) => getEffectiveSelectedOptions(answer).length > 0);

  const { uuid, orginContent, resumeMessageId } = props.messageListItem || props.thinkListItem || {};

  const intl = useIntl();
  const { EventEmitter, layoutMode } = useGlobal();
  const otherInputRefs = useRef<Record<number, InputRef | null>>({});

  const isPreviewMode = layoutMode === LayoutMode.preview;
  const isThinkingProcess = !!props.thinkListItem;
  const updateField = isThinkingProcess ? 'inferLog' : 'messageStruct';
  const isDisabled = formStatus === IFormStatus.FINISH || isPreviewMode || submitting;

  const updateAnswer = (questionIndex: number, answerPatch: Partial<IAskUserQuestionAnswer>) => {
    const nextAnswers = answers.map((answer, index) => {
      return index === questionIndex ? { ...answer, ...answerPatch } : answer;
    });

    updateMessageListItemContent({
      ...messageListItemContent,
      substance: {
        ...messageListItemContent.substance,
        answers: nextAnswers,
      },
    });
  };

  const renderQuestionOptions = (question: IAskUserQuestion, questionIndex: number) => {
    const answer = answers[questionIndex];
    const selectedOptions = answer?.selectedOptions || [];
    const otherSelected = answer?.otherSelected || false;
    const selectOther = () => {
      if (isDisabled) return;

      if (!otherSelected) {
        updateAnswer(questionIndex, {
          selectedOptions: question.multiSelect ? selectedOptions : [],
          otherSelected: true,
        });
      }
      otherInputRefs.current[questionIndex]?.focus();
    };

    return (
      <div className={styles.optionList}>
        {question.options.map((option) => {
          const optionContent = (
            <div className={styles.optionContent}>
              <div className={styles.optionLabel}>{option.label}</div>
              {option.description ? <div className={styles.optionDescription}>{option.description}</div> : null}
            </div>
          );

          if (question.multiSelect) {
            return (
              <label className={styles.optionItem} key={option.label}>
                <Checkbox
                  checked={selectedOptions.includes(option.label)}
                  disabled={isDisabled}
                  onChange={(event) => {
                    const nextSelectedOptions = event.target.checked
                      ? [...selectedOptions, option.label]
                      : selectedOptions.filter((label) => label !== option.label);
                    updateAnswer(questionIndex, { selectedOptions: nextSelectedOptions });
                  }}
                />
                {optionContent}
              </label>
            );
          }

          return (
            <label className={styles.optionItem} key={option.label}>
              <Radio
                checked={selectedOptions[0] === option.label}
                disabled={isDisabled}
                onChange={() => {
                  updateAnswer(questionIndex, {
                    selectedOptions: [option.label],
                    otherSelected: false,
                  });
                }}
              />
              {optionContent}
            </label>
          );
        })}
        <div
          className={classnames(styles.optionItem, styles.otherOption)}
          role="button"
          tabIndex={isDisabled ? -1 : 0}
          onClick={selectOther}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            selectOther();
          }}
        >
          {question.multiSelect ? (
            <Checkbox
              aria-label={intl.formatMessage({ id: 'resource.other' })}
              checked={otherSelected}
              disabled={isDisabled}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                if (event.target.checked) {
                  selectOther();
                  return;
                }
                updateAnswer(questionIndex, { otherSelected: false });
              }}
            />
          ) : (
            <Radio
              aria-label={intl.formatMessage({ id: 'resource.other' })}
              checked={otherSelected}
              disabled={isDisabled}
              onClick={(event) => event.stopPropagation()}
              onChange={selectOther}
            />
          )}
          <div className={styles.optionContent}>
            <div className={styles.optionLabel}>{intl.formatMessage({ id: 'resource.other' })}</div>
            <Input
              ref={(input) => {
                otherInputRefs.current[questionIndex] = input;
              }}
              aria-label={intl.formatMessage({ id: 'form.inputPlaceholder' }, { content: question.header })}
              placeholder={intl.formatMessage({ id: 'form.inputPlaceholder' }, { content: question.header })}
              className={styles.otherInput}
              value={answer?.otherText || ''}
              disabled={isDisabled}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => {
                event.stopPropagation();
                selectOther();
              }}
              onChange={(event) => updateAnswer(questionIndex, { otherText: event.target.value })}
            />
          </div>
        </div>
      </div>
    );
  };

  let questionContent = null;
  if (questions.length > 1) {
    questionContent = (
      <Tabs
        items={questions.map((question, index) => ({
          key: `${question.header}-${index}`,
          label: (
            <div className={styles.questionMarkdown}>
              <Md content={question.question} />
            </div>
          ),
          children: renderQuestionOptions(question, index),
        }))}
      />
    );
  } else if (questions[0]) {
    questionContent = (
      <div className={styles.singleQuestion}>
        <div className={classnames(styles.questionTitle, styles.questionMarkdown)}>
          <Md content={questions[0].question} />
        </div>
        {renderQuestionOptions(questions[0], 0)}
      </div>
    );
  }

  return (
    <div className={classnames(styles.thinkTaskUserInput, 'ub ub-ac')}>
      <div className={classnames('ub-f1', styles.questionForm)}>
        {questionContent}
        <div className="ub ub-pe ub-ac">
          <Button
            type="primary"
            loading={submitting}
            disabled={isDisabled || (isAskUserQuestion && !allQuestionsAnswered)}
            onClick={async () => {
              const resumeMetadata = pickRawResumeMetadata(messageInfo, messageListItemContent);
              const submittedAnswers = prepareAnswersForSubmit(answers);
              const finishedContent: IMessageListItemContent = {
                ...messageListItemContent,
                formStatus: IFormStatus.FINISH,
                submitting: false,
                substance: {
                  ...messageListItemContent.substance,
                  answers: submittedAnswers,
                  formStatus: IFormStatus.FINISH,
                },
              };

              let persistedContent: Record<string, unknown> = {};
              try {
                const parsedContent = JSON.parse(orginContent || '{}');
                if (parsedContent && typeof parsedContent === 'object' && !Array.isArray(parsedContent)) {
                  persistedContent = parsedContent;
                }
              } catch (error) {
                console.error(error);
              }
              persistedContent = {
                ...persistedContent,
                answers: submittedAnswers,
                formStatus: IFormStatus.FINISH,
              };

              const queryQuestion = buildQueryQuestion(submittedAnswers);

              const payload: Record<string, unknown> = {
                actionType: 'RESUME',
                llmMessageId: messageInfo.messageId,
                traceId: messageInfo.traceId,
                sourceAgentType,
                resumeMessageId,
              };
              if (resumeMetadata !== undefined) {
                payload.metadata = resumeMetadata;
              }

              try {
                updateMessageListItemContent({
                  ...messageListItemContent,
                  submitting: true,
                });
                await updateMessageStructById({
                  id: uuid,
                  messageId: messageInfo.messageId,
                  content: JSON.stringify(persistedContent),
                  updateField,
                  sessionId: messageInfo.sessionId,
                  traceId: messageInfo.traceId,
                });

                updateMessageListItemContent(finishedContent);
                EventEmitter.emit('beyond-chat-on-send-msg', {
                  sendProps: {
                    queryQuestion,
                    payload,
                    inheritQryMsgId: messageInfo.queryMsgId,
                    msgOpt: {
                      answerMsg: {
                        messageState: IMessageState.Query,
                      },
                    },
                  },
                  sendConf: {
                    onlyQuery: true,
                  },
                });
              } catch (error) {
                console.error(error);
                updateMessageListItemContent({
                  ...messageListItemContent,
                  submitting: false,
                });
              }
            }}
          >
            {formStatus === IFormStatus.FINISH
              ? intl.formatMessage({ id: 'form.completed' })
              : intl.formatMessage({ id: 'form.confirm' })}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default withEasyConfirm(AskUserQuestions);
