import { IFormStatus } from '@/hooks/useSseSender/agent/typescript';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import useGlobal from '@/hooks/useGlobal';
import classnames from 'classnames';
import { get } from 'lodash';
import { useIntl } from '@umijs/max';
import { Button, Checkbox, Input, Radio } from 'antd';
import type { InputRef } from 'antd';
import { useRef, useState } from 'react';
import {
  CheckCircleOutlined,
  EditOutlined,
  LeftOutlined,
  QuestionCircleOutlined,
  RightOutlined,
} from '@ant-design/icons';
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
  presentation?: 'dock' | 'transcript';
};

/** 是否视为「有有效 metadata」：空串不应挡住助手消息上的完整 JSON */
function isUsableRawMetadata(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') {
    return v.trim() !== '';
  }
  return true;
}

/** 提取 Super 用于识别 askUserQuestion ResumeCommand 的两个路由字段。 */
function getUserInteractionResumeRoute(v: unknown): { parentRunId?: string; interactionId?: string } {
  let metadata = v;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};

  const entries = Object.entries(metadata as Record<string, unknown>);
  const getNonEmptyString = (key: string) => {
    const entry = entries.find(
      ([candidate, value]) => candidate.toLowerCase() === key && typeof value === 'string' && value.trim()
    );
    return typeof entry?.[1] === 'string' ? entry[1].trim() : undefined;
  };
  return {
    parentRunId: getNonEmptyString('parent_run_id'),
    interactionId: getNonEmptyString('interaction_id'),
  };
}

/** 用户交互恢复必须同时具备 Run 与 Interaction 路由，避免可解析但不完整的 metadata 抢占完整卡片 metadata。 */
function hasUserInteractionResumeRoute(v: unknown): boolean {
  const { parentRunId, interactionId } = getUserInteractionResumeRoute(v);
  return Boolean(parentRunId && interactionId);
}

/**
 * 原样透传、不做 JSON 解析。优先本条助手回答上的 metadata（含 LangGraph checkpoint 全量）；
 * 但 askUserQuestion 恢复必须优先选择路由字段完整的候选，防止后发 reasoningLogEnd 的
 * `{ parent_run_id }` 覆盖消息级 metadata 后挡住卡片上的完整 interaction metadata。
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
  const routedMetadata = candidates.find(hasUserInteractionResumeRoute);
  if (routedMetadata !== undefined) {
    return routedMetadata;
  }
  for (const v of candidates) {
    if (isUsableRawMetadata(v)) {
      return v;
    }
  }
  return undefined;
}

/** 仅解析 JSON 对象，解析失败时保持原有恢复提交链路不受影响。 */
function parseResumeMetadata(resumeMetadata: unknown): Record<string, unknown> | undefined {
  if (typeof resumeMetadata !== 'string') return undefined;

  try {
    const parsedMetadata = JSON.parse(resumeMetadata);
    if (parsedMetadata && typeof parsedMetadata === 'object' && !Array.isArray(parsedMetadata)) {
      return parsedMetadata;
    }
  } catch {
    return undefined;
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
  const {
    questions = [],
    answers: savedAnswers,
    formStatus: substanceFormStatus,
  } = get(messageListItemContent, 'substance') || {};
  const answers = normalizeAnswers(questions, savedAnswers);
  const effectiveFormStatus = formStatus ?? substanceFormStatus;
  const isFinished = effectiveFormStatus === IFormStatus.FINISH;
  const isAskUserQuestion = questions.length > 0;
  const allQuestionsAnswered =
    isAskUserQuestion && answers.every((answer) => getEffectiveSelectedOptions(answer).length > 0);

  const { uuid, orginContent, resumeMessageId } = props.messageListItem || props.thinkListItem || {};

  const intl = useIntl();
  const { EventEmitter, layoutMode } = useGlobal();
  const otherInputRefs = useRef<Record<number, InputRef | null>>({});
  const getQuestionKey = (question: IAskUserQuestion, index: number) => `${question.header}-${index}`;
  const [activeQuestionKey, setActiveQuestionKey] = useState(() =>
    questions[0] ? getQuestionKey(questions[0], 0) : undefined
  );
  const activeQuestionIndex = Math.max(
    questions.findIndex((question, index) => getQuestionKey(question, index) === activeQuestionKey),
    0
  );

  const isPreviewMode = layoutMode === LayoutMode.preview;
  const isThinkingProcess = !!props.thinkListItem;
  const updateField = isThinkingProcess ? 'inferLog' : 'messageStruct';
  const isDisabled = messageInfo.isHistoryMsg || isFinished || isPreviewMode || submitting;

  if (props.presentation !== 'dock') {
    if (!isFinished) return null;

    return (
      <section className={styles.answerSummary} aria-label={intl.formatMessage({ id: 'messageList.askUser.answered' })}>
        <span className={styles.summaryIcon} aria-hidden="true">
          <CheckCircleOutlined />
        </span>
        <div className={styles.summaryBody}>
          {questions.map((question, index) => (
            <div className={styles.summaryRow} key={getQuestionKey(question, index)}>
              <span className={styles.summaryQuestion}>{question.question}</span>
              <span className={styles.summaryAnswer}>{getEffectiveSelectedOptions(answers[index]).join('、')}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

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
        {question.options.map((option, optionIndex) => {
          const isSelected = selectedOptions.includes(option.label);
          const optionContent = (
            <div className={styles.optionContent}>
              <div className={styles.optionHeading}>
                <span className={styles.optionIndex}>{optionIndex + 1}</span>
                <span className={styles.optionLabel}>{option.label}</span>
              </div>
              {option.description ? <div className={styles.optionDescription}>{option.description}</div> : null}
            </div>
          );

          if (question.multiSelect) {
            return (
              <label
                className={classnames(styles.optionItem, { [styles.optionSelected]: isSelected })}
                key={option.label}
              >
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
            <label
              className={classnames(styles.optionItem, { [styles.optionSelected]: isSelected })}
              key={option.label}
            >
              <Radio
                checked={selectedOptions[0] === option.label}
                disabled={isDisabled}
                onChange={() => {
                  updateAnswer(questionIndex, {
                    selectedOptions: [option.label],
                    otherSelected: false,
                  });
                  const nextQuestion = questions[questionIndex + 1];
                  if (nextQuestion) {
                    setActiveQuestionKey(getQuestionKey(nextQuestion, questionIndex + 1));
                  }
                }}
              />
              {optionContent}
            </label>
          );
        })}
        <div
          className={classnames(styles.optionItem, styles.otherOption, {
            [styles.optionSelected]: otherSelected,
          })}
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
            <div className={styles.optionHeading}>
              <span className={classnames(styles.optionIndex, styles.otherIndex)}>
                <EditOutlined />
              </span>
              <span className={styles.optionLabel}>{intl.formatMessage({ id: 'resource.other' })}</span>
            </div>
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

  const activeQuestion = questions[activeQuestionIndex];
  const activeAnswer = answers[activeQuestionIndex];
  const activeQuestionAnswered = activeAnswer && getEffectiveSelectedOptions(activeAnswer).length > 0;

  return (
    <section className={styles.questionDock} aria-label={intl.formatMessage({ id: 'messageList.askUser.title' })}>
      <header className={styles.dockHeader}>
        <span className={styles.eyebrow}>
          <QuestionCircleOutlined />
          {intl.formatMessage({ id: 'messageList.askUser.title' })}
        </span>
        {questions.length > 1 ? (
          <span className={styles.questionProgress}>
            {activeQuestionIndex + 1} / {questions.length}
          </span>
        ) : null}
      </header>
      <div className={styles.questionForm}>
        {activeQuestion ? (
          <div className={styles.singleQuestion}>
            <div className={classnames(styles.questionTitle, styles.questionMarkdown)}>
              <Md content={activeQuestion.question} />
            </div>
            {renderQuestionOptions(activeQuestion, activeQuestionIndex)}
          </div>
        ) : null}
        <footer className={styles.formFooter}>
          <div className={styles.questionNav}>
            {questions.length > 1 ? (
              <>
                <Button
                  type="text"
                  icon={<LeftOutlined />}
                  aria-label={intl.formatMessage({ id: 'messageList.askUser.previous' })}
                  disabled={activeQuestionIndex === 0}
                  onClick={() => {
                    const previousIndex = activeQuestionIndex - 1;
                    setActiveQuestionKey(getQuestionKey(questions[previousIndex], previousIndex));
                  }}
                />
                <Button
                  type="text"
                  icon={<RightOutlined />}
                  aria-label={intl.formatMessage({ id: 'messageList.askUser.next' })}
                  disabled={activeQuestionIndex === questions.length - 1 || !activeQuestionAnswered}
                  onClick={() => {
                    const nextIndex = activeQuestionIndex + 1;
                    setActiveQuestionKey(getQuestionKey(questions[nextIndex], nextIndex));
                  }}
                />
              </>
            ) : null}
          </div>
          <Button
            type="primary"
            className={styles.confirmButton}
            loading={submitting}
            disabled={isDisabled || (isAskUserQuestion && !allQuestionsAnswered)}
            onClick={async () => {
              const resumeMetadata = pickRawResumeMetadata(messageInfo, messageListItemContent);
              const resumeRoute = getUserInteractionResumeRoute(resumeMetadata);
              const missingRouteFields = [
                !resumeRoute.interactionId ? 'interaction_id' : undefined,
                !resumeRoute.parentRunId ? 'parent_run_id' : undefined,
              ].filter(Boolean);
              if (missingRouteFields.length > 0) {
                console.error('[ASK_USER_QUESTION_RESUME_TRACE] FE_SUBMIT_UNROUTABLE', {
                  traceId: messageInfo.traceId,
                  sessionId: messageInfo.sessionId,
                  messageId: messageInfo.messageId,
                  resumeMessageId,
                  missingRouteFields,
                  resumeRoute: {
                    interaction_id: resumeRoute.interactionId,
                    parent_run_id: resumeRoute.parentRunId,
                  },
                  metadataCandidateRoutes: {
                    message: getUserInteractionResumeRoute(messageInfo.metadata),
                    substance: getUserInteractionResumeRoute(get(messageListItemContent, 'substance.metadata')),
                    card: getUserInteractionResumeRoute(get(messageListItemContent, 'metadata')),
                  },
                });
              }
              const parsedResumeMetadata = parseResumeMetadata(resumeMetadata);
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
              if (parsedResumeMetadata && Object.prototype.hasOwnProperty.call(parsedResumeMetadata, 'agentId')) {
                payload.agentId = parsedResumeMetadata.agentId;
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
            {isFinished ? intl.formatMessage({ id: 'form.completed' }) : intl.formatMessage({ id: 'form.confirm' })}
          </Button>
        </footer>
      </div>
    </section>
  );
}

export default withEasyConfirm(AskUserQuestions);
