/* eslint-disable no-nested-ternary */
/* eslint-disable react/jsx-indent-props */
/* eslint-disable react/jsx-indent */
/* eslint-disable no-else-return */
/* eslint-disable indent */
import React, { useEffect, useState, useCallback } from 'react';
import { Popover, Button, Empty, Spin, message, Popconfirm } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import { getScheduleTaskList, deleteScheduleTask } from '@/service/task';
import type { IAgentCache } from '@/typescript/agent';

interface ScheduleTaskListProps {
  agentInfo?: IAgentCache;
  onAddTask: () => void;
  onEditTask?: (task: any) => void;
  onRefresh?: () => void;
  refreshKey?: number; // 用于触发刷新
}

interface ScheduleTask {
  taskId: number;
  taskName: string;
  statusCd: '00A' | '00X';
  executionCycle: 'DAY' | 'WEEK' | 'MONTH' | 'CUSTOM';
  executionFrequencys: string[];
  executionTime: string;
  executionContent: string;
}

const ScheduleTaskList: React.FC<ScheduleTaskListProps> = ({
  agentInfo,
  onAddTask,
  onEditTask,
  onRefresh,
  refreshKey,
}) => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [taskList, setTaskList] = useState<ScheduleTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<number | null>(null);

  // 获取定时任务列表
  const fetchTaskList = useCallback(async () => {
    if (!agentInfo?.agentId) return;
    setLoading(true);
    try {
      const res = await getScheduleTaskList({ resourceId: agentInfo.agentId });
      setTaskList(res || []);
    } catch (error: any) {
      console.error('获取定时任务列表失败:', error);
      message.error(error?.message || intl.formatMessage({ id: 'employees.scheduleTaskList.fetchFailed' }));
    } finally {
      setLoading(false);
    }
  }, [agentInfo?.agentId]);

  useEffect(() => {
    if (open && agentInfo?.agentId) {
      fetchTaskList();
    }
  }, [open, agentInfo?.agentId, refreshKey, fetchTaskList]);

  // 格式化执行时间显示
  const formatExecutionTime = (task: ScheduleTask) => {
    const { executionCycle, executionFrequencys, executionTime } = task;
    const timeStr = executionTime;

    if (executionCycle === 'CUSTOM') {
      // 固定时间：显示完整日期时间
      return timeStr;
    } else if (executionCycle === 'DAY') {
      // 每天：显示时间
      return intl.formatMessage({ id: 'employees.scheduleTaskList.everyDay' }, { time: timeStr });
    } else if (executionCycle === 'WEEK') {
      // 每周：显示星期几和时间
      const weekDayIdMap: Record<string, string> = {
        MON: 'common.weekMon',
        TUE: 'common.weekTue',
        WED: 'common.weekWed',
        THU: 'common.weekThu',
        FRI: 'common.weekFri',
        SAT: 'common.weekSat',
        SUN: 'common.weekSun',
        // 兼容旧数据格式（完整单词）
        MONDAY: 'common.weekMon',
        TUESDAY: 'common.weekTue',
        WEDNESDAY: 'common.weekWed',
        THURSDAY: 'common.weekThu',
        FRIDAY: 'common.weekFri',
        SATURDAY: 'common.weekSat',
        SUNDAY: 'common.weekSun',
      };
      const weekDays = executionFrequencys
        ?.map((day) => intl.formatMessage({ id: weekDayIdMap[day] || 'common.weekUnknown' }, { day }))
        .join(', ');
      return intl.formatMessage({ id: 'employees.scheduleTaskList.everyWeek' }, { days: weekDays, time: timeStr });
    } else if (executionCycle === 'MONTH') {
      // 每月：显示日期和时间
      const days = executionFrequencys.join(', ');
      return intl.formatMessage({ id: 'employees.scheduleTaskList.everyMonth' }, { days, time: timeStr });
    }
    return timeStr;
  };

  // 删除任务
  const handleDelete = async (taskId: number) => {
    setDeletingTaskId(taskId);
    try {
      await deleteScheduleTask(taskId);
      message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
      fetchTaskList();
      onRefresh?.();
    } catch (error: any) {
      console.error('删除定时任务失败:', error);
      message.error(error?.message || intl.formatMessage({ id: 'employees.scheduleTaskList.deleteFailed' }));
    } finally {
      setDeletingTaskId(null);
    }
  };

  // 编辑任务
  const handleEdit = (task: ScheduleTask, e: React.MouseEvent) => {
    e.stopPropagation();
    onEditTask?.(task);
    setOpen(false);
  };

  const content = (
    <div style={{ width: '400px', maxHeight: '500px', overflow: 'auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <span style={{ fontSize: '16px', fontWeight: 500 }}>
          {intl.formatMessage({ id: 'employees.scheduleTaskList.title' })}
        </span>
        <Button
          type="link"
          style={{ padding: 0, height: 'auto' }}
          onClick={(e) => {
            e.stopPropagation();
            onAddTask();
            setOpen(false);
          }}
        >
          + {intl.formatMessage({ id: 'employees.scheduleTaskList.addTask' })}
        </Button>
      </div>
      <div style={{ padding: '8px 0' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <Spin />
          </div>
        ) : taskList.length === 0 ? (
          <Empty
            description={intl.formatMessage({ id: 'employees.scheduleTaskList.empty' })}
            style={{ padding: '20px 0' }}
          />
        ) : (
          taskList.map((task) => (
            <div
              key={task.taskId}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: '1px solid #f5f5f5',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#fafafa';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <AntdIcon
                type="icon-a-Alarm-clocknaozhong"
                style={{ fontSize: '16px', color: '#1677ff', marginRight: '12px' }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '4px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '14px',
                      color: '#333',
                      marginRight: '8px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {task.taskName}
                  </span>
                  {task.statusCd === '00A' && (
                    <span
                      style={{
                        fontSize: '12px',
                        color: '#52c41a',
                        padding: '2px 8px',
                        background: '#f6ffed',
                        borderRadius: '4px',
                      }}
                    >
                      {intl.formatMessage({ id: 'employees.scheduleTaskList.active' })}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: '#8c8c8c',
                  }}
                >
                  {formatExecutionTime(task)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginLeft: '8px' }}>
                <AntdIcon type="icon-a-Editbianji" className="pointer" onClick={(e) => handleEdit(task, e)} />
                <Popconfirm
                  title={intl.formatMessage({ id: 'employees.scheduleTaskList.deleteConfirm' })}
                  onConfirm={(e) => {
                    e?.stopPropagation();
                    handleDelete(task.taskId);
                  }}
                  onCancel={(e) => {
                    e?.stopPropagation();
                  }}
                  okText={intl.formatMessage({ id: 'common.confirm' })}
                  cancelText={intl.formatMessage({ id: 'common.cancel' })}
                  okButtonProps={{
                    loading: deletingTaskId === task.taskId,
                  }}
                >
                  <AntdIcon
                    type="icon-a-Deleteshanchu"
                    className="pointer"
                    style={{
                      opacity: deletingTaskId === task.taskId ? 0.6 : 1,
                      cursor: deletingTaskId === task.taskId ? 'not-allowed' : 'pointer',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  />
                </Popconfirm>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="bottomRight" arrow={false}>
      <AntdIcon
        type="icon-a-Alarm-clocknaozhong"
        className="pointer"
        title={intl.formatMessage({ id: 'employees.scheduleTaskList.title' })}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      />
    </Popover>
  );
};

export default ScheduleTaskList;
