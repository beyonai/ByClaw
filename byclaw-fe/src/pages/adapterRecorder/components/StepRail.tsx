// 录制流程进度轨 —— 单一可视化(替代旧的 FlowGraph 画布 + antd Steps 重复)。
// 纯自定义 DOM + Workbench CSS Module 青色样式;带 aria 语义供 AT。
interface Step {
  key: string;
  title: string;
}

interface Props {
  steps: Step[];

  /** 当前活动 step 序号(0-based);done 时 = steps.length */
  current: number;
  failed?: boolean;
}

export type StepStatus = 'done' | 'active' | 'pending' | 'failed';

const STATUS_LABEL: Record<StepStatus, string> = {
  done: '已完成',
  active: '当前步骤',
  pending: '未开始',
  failed: '失败',
};

/** 单步状态推导(纯函数,便于单测):current=已到达步序;done 态 current=步数 → 全 done。 */
export function stepStatus(index: number, current: number, failed?: boolean): StepStatus {
  if (failed && index === current) return 'failed';
  if (index < current) return 'done';
  if (index === current) return 'active';
  return 'pending';
}

export default function StepRail({ steps, current, failed }: Props) {
  return (
    <ol className="wb-rail" aria-label="录制流程进度">
      {steps.map((s, i) => {
        const status = stepStatus(i, current, failed);
        return (
          <li
            key={s.key}
            className={`wb-step wb-step--${status}`}
            aria-label={`${s.title},${STATUS_LABEL[status]}`}
            aria-current={status === 'active' ? 'step' : undefined}
          >
            <span className="wb-step__dot" aria-hidden>
              {status === 'done' ? '✓' : i + 1}
            </span>
            <span className="wb-step__label">{s.title}</span>
          </li>
        );
      })}
    </ol>
  );
}
