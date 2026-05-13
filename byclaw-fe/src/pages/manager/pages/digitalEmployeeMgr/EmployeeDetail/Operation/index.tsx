// @ts-nocheck
/* eslint-disable max-len */
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Segmented, DatePicker, Rate, Button, Spin, message } from 'antd';
import { DownloadOutlined, UploadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import weekday from 'dayjs/plugin/weekday';
import localeData from 'dayjs/plugin/localeData';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { useIntl } from '@umijs/max';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import * as echarts from 'echarts';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import {
  getOperationsInfo,
  getUsageMetrics,
  getFrequentQuestions,
  uploadTestSet,
  getTestSetResult,
} from '@/pages/manager/service/DigitalEmployeeMgr';
import UploadTestSetModal from './UploadTestSetModal';
import TestSetResultModal from './TestSetResultModal';
import TestSetFailReasonModal from './TestSetFailReasonModal';
import styles from './index.module.less';

// 扩展 dayjs 插件
dayjs.extend(weekday);
dayjs.extend(localeData);
dayjs.extend(weekOfYear);

interface OperationProps {
  agentId?: string;
}

// 常量定义
const POLLING_INTERVAL = 6000; // 轮询间隔（毫秒）
const TEST_SET_TEMPLATE_FILE_NAME = '评测数据集模版.xlsx';

// 格式化token数值，超过1万则用k单位表示
const formatTokenValue = (value: number): string => {
  if (value === 0 || value === null || value === undefined) {
    return '0';
  }

  if (value >= 10000) {
    const kValue = value / 1000;
    return `${kValue.toFixed(2)}k`;
  }

  // 小于1万，如果是整数则显示整数，否则保留2位小数
  if (Number.isInteger(value)) {
    return value.toString();
  }
  return value.toFixed(2);
};

const Operation: React.FC<OperationProps> = ({ agentId }) => {
  const intl = useIntl();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _flag = false;
  // 使用指标相关状态
  const [usagePeriod, setUsagePeriod] = useState('week'); // 周分析/月分析
  const [selectedDate, setSelectedDate] = useState(dayjs()); // 日期选择
  const [selectedWeek, setSelectedWeek] = useState(dayjs()); // 周选择

  // 技术性指标相关状态（独立的时间选择器）
  const [technicalPeriod, setTechnicalPeriod] = useState('week'); // 周分析/月分析
  const [technicalSelectedDate, setTechnicalSelectedDate] = useState(dayjs()); // 日期选择
  const [technicalSelectedWeek, setTechnicalSelectedWeek] = useState(dayjs()); // 周选择

  // 使用指标数据
  const [usageMetrics, setUsageMetrics] = useState({
    totalServiceCount: 0,
    totalServiceUsers: 0,
    avgDialoguesPerPerson: 0,
    likes: 0,
    dislikes: 0,
  });

  // 趋势图数据
  const [serviceTrendData, setServiceTrendData] = useState<any[]>([]);
  const [userTrendData, setUserTrendData] = useState<any[]>([]);
  const [avgDialogTrendData, setAvgDialogTrendData] = useState<any[]>([]);
  const [userSatisfactionTrendData, setUserSatisfactionTrendData] = useState<any[]>([]);

  // 准确性指标数据
  const [accuracyMetrics, setAccuracyMetrics] = useState({
    actualResponseAccuracy: 0, // 实际使用回复准确率
    testResponseAccuracy: 0, // 测试集回复准确率
    testIntentRecognitionAccuracy: 0, // 测试集意图识别准确率
    testSetFileName: '', // 测试集文件名
    fileName: '',
  });

  // 技术性指标数据
  const [technicalMetrics, setTechnicalMetrics] = useState({
    avgFirstTextDuration: 0, // 平均首词响应时长
    avgTaskDueTime: 0, // 平均回复时长
    errorRate: 0, // 对话异常率
    inputTokenTotal: 0, // 输入token消耗量
    outputTokenTotal: 0, // 输出token消耗量
    avgOutPutTokenPerSecondTotal: 0, // 每秒token消耗量
    avgInputTokenTotal: 0, // 平均输入token消耗量
    avgOutputTokenTotal: 0, // 平均输出token消耗量
    outputTokenPerSecondTotal: 0, // 每秒token消耗量
  });

  // 技术性指标趋势图数据
  const [firstTextDurationTrendData, setFirstTextDurationTrendData] = useState<any[]>([]);
  const [errorRateTrendData, setErrorRateTrendData] = useState<any[]>([]);
  const [inputTokenTrendData, setInputTokenTrendData] = useState<any[]>([]);
  const [outputTokenTrendData, setOutputTokenTrendData] = useState<any[]>([]);
  const [tokenPerSecondTrendData, setTokenPerSecondTrendData] = useState<any[]>([]);

  // 图表引用
  const serviceTrendRef = useRef<HTMLDivElement>(null);
  const userTrendRef = useRef<HTMLDivElement>(null);
  const avgDialogTrendRef = useRef<HTMLDivElement>(null);
  const userSatisfactionTrendRef = useRef<HTMLDivElement>(null);
  const firstTextDurationTrendRef = useRef<HTMLDivElement>(null);
  const errorRateTrendRef = useRef<HTMLDivElement>(null);
  const inputTokenTrendRef = useRef<HTMLDivElement>(null);
  const outputTokenTrendRef = useRef<HTMLDivElement>(null);
  const tokenPerSecondTrendRef = useRef<HTMLDivElement>(null);
  const serviceChartRef = useRef<any>(null);
  const userChartRef = useRef<any>(null);
  const avgDialogChartRef = useRef<any>(null);
  const userSatisfactionChartRef = useRef<any>(null);
  const firstTextDurationChartRef = useRef<any>(null);
  const errorRateChartRef = useRef<any>(null);
  const inputTokenChartRef = useRef<any>(null);
  const outputTokenChartRef = useRef<any>(null);
  const tokenPerSecondChartRef = useRef<any>(null);

  // Loading 状态
  const [usageLoading, setUsageLoading] = useState(false);
  const [basicInfoLoading, setBasicInfoLoading] = useState(false);
  const [accuracyLoading, setAccuracyLoading] = useState(false);
  const [technicalLoading, setTechnicalLoading] = useState(false);
  const [frequentQuestionsLoading, setFrequentQuestionsLoading] = useState(false);

  // 高频问题数据
  const [frequentQuestions, setFrequentQuestions] = useState<any[]>([]);

  // 运营信息数据（从接口获取）
  const [operationsInfo, setOperationsInfo] = useState<any>(null);

  // 上传测试集弹窗状态
  const [uploadTestSetVisible, setUploadTestSetVisible] = useState(false);

  // 测试集结果弹窗状态
  const [testSetResultVisible, setTestSetResultVisible] = useState(false);

  // 测试集失败原因弹窗状态
  const [testSetFailReasonVisible, setTestSetFailReasonVisible] = useState(false);

  // 测试集状态管理
  const [testSetStatus, setTestSetStatus] = useState<{
    processStatus: number | null; // 0成功，1进行中，2失败
    batchId: string | null;
    failReason: string | null;
    testSetAccuracy: number | null;
    testSetIntentRecognitionAccuracy: number | null;
  }>({
    processStatus: null,
    batchId: null,
    failReason: null,
    testSetAccuracy: null,
    testSetIntentRecognitionAccuracy: null,
  });

  // 定时轮询的 ref
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 组件卸载标记，防止卸载后仍然触发轮询或状态更新
  const unmountedRef = useRef(false);
  // 存储 startPollingTestSetResult 函数的 ref
  const startPollingTestSetResultRef = useRef<((batchId: string) => void) | null>(null);

  // 规范性指标数据
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [normativeMetrics] = useState({
    abilityMatchDegree: 65, // 能力描述与岗位匹配度
    personaNormativity: 4.5, // 人设描述规范度
  });

  // 从运营信息中解析列表数据
  const knowledgeList = (operationsInfo?.knowledgeList || []) as any[];
  const skillList = (operationsInfo?.skillList || []) as any[];

  // 计算时间范围（使用指标）
  const getTimeRange = useMemo(() => {
    let startTime;
    let endTime;
    let _periodType;

    if (usagePeriod === 'week') {
      const weekStart = selectedWeek.startOf('week');
      const weekEnd = selectedWeek.endOf('week');
      startTime = weekStart.format('YYYY-MM-DD');
      endTime = weekEnd.format('YYYY-MM-DD');
      _periodType = 'week';
    } else {
      const monthStart = selectedDate.startOf('month');
      const monthEnd = selectedDate.endOf('month');
      startTime = monthStart.format('YYYY-MM-DD');
      endTime = monthEnd.format('YYYY-MM-DD');
      _periodType = 'month';
    }

    return { startTime, endTime, _periodType };
  }, [usagePeriod, selectedWeek, selectedDate]);

  // 计算时间范围（技术性指标）
  const getTechnicalTimeRange = useMemo(() => {
    let startTime;
    let endTime;
    let _periodType;

    if (technicalPeriod === 'week') {
      const weekStart = technicalSelectedWeek.startOf('week');
      const weekEnd = technicalSelectedWeek.endOf('week');
      startTime = weekStart.format('YYYY-MM-DD');
      endTime = weekEnd.format('YYYY-MM-DD');
      _periodType = 'week';
    } else {
      const monthStart = technicalSelectedDate.startOf('month');
      const monthEnd = technicalSelectedDate.endOf('month');
      startTime = monthStart.format('YYYY-MM-DD');
      endTime = monthEnd.format('YYYY-MM-DD');
      _periodType = 'month';
    }

    return { startTime, endTime, _periodType };
  }, [technicalPeriod, technicalSelectedWeek, technicalSelectedDate]);

  // 获取使用指标数据
  const fetchUsageMetrics = useCallback(async () => {
    if (!agentId) return;

    try {
      setUsageLoading(true);
      const { startTime, endTime } = getTimeRange;

      const response = await getUsageMetrics({
        queryCode: 'DIG_EMPLOYEE_USAGE_METRICS',
        params: {
          startTime,
          endTime,
          resourceId: Number(agentId),
          resObjType: 'AGENT',
        },
      });

      const data = response?.data || {};

      // 顶部汇总指标
      const totalServiceCount = data.totalServiceCount ?? 0;
      const totalServiceUsers = data.totalUserCount?.distinctUserCount ?? data.totalUserCount?.docCount ?? 0;
      const avgConversationCount = data.avgConversationCount ?? 0;
      const likes = data.praiseCount?.docCount ?? 0;
      const dislikes = data.treadCount?.docCount ?? 0;

      setUsageMetrics({
        totalServiceCount,
        totalServiceUsers,
        avgDialoguesPerPerson: avgConversationCount,
        likes,
        dislikes,
      });

      // 趋势图数据
      const trend: any[] = data.trend || [];

      const serviceTrend = trend.map((item) => ({
        date: dayjs(item.date).format('YYYY.MM.DD'),
        value: item.serviceCount ?? 0,
      }));

      const userTrend = trend.map((item) => {
        const rawUser = item.userCount;
        const userValue =
          typeof rawUser === 'object' ? rawUser?.distinctUserCount ?? rawUser?.docCount ?? 0 : rawUser ?? 0;
        return {
          date: dayjs(item.date).format('YYYY.MM.DD'),
          value: userValue,
        };
      });

      const avgDialogTrend = trend.map((item) => ({
        date: dayjs(item.date).format('YYYY.MM.DD'),
        value: item.avgConversationCount ?? 0,
      }));

      const userSatisfactionTrend = trend.map((item) => ({
        date: dayjs(item.date).format('YYYY.MM.DD'),
        value: item.userSatisfactionRate,
      }));

      setServiceTrendData(serviceTrend);
      setUserTrendData(userTrend);
      setAvgDialogTrendData(avgDialogTrend);
      setUserSatisfactionTrendData(userSatisfactionTrend);
    } catch (error) {
      console.error(intl.formatMessage({ id: 'operation.error.fetchUsageMetrics' }), error);
    } finally {
      setUsageLoading(false);
    }
  }, [agentId, getTimeRange, intl]);

  // 获取准确性指标数据
  const fetchAccuracyMetrics = useCallback(async () => {
    if (!agentId) return;

    try {
      setAccuracyLoading(true);
      const response = await getUsageMetrics({
        queryCode: 'DIG_EMPLOYEE_ACCURACY_METRICS',
        params: {
          resourceId: Number(agentId),
          resObjType: 'AGENT',
        },
      });

      const data = response?.data || {};

      // 提取测试集相关字段
      const processStatus = data.processStatus ?? null;
      const batchId = data.batchId ?? null;
      const failReason = data.failReason ?? null;
      const testSetAccuracy = data.testResponseAccuracy ?? null;
      const testSetIntentRecognitionAccuracy = data.testIntentRecognitionAccuracy ?? null;

      // 更新测试集状态
      setTestSetStatus({
        processStatus,
        batchId,
        failReason,
        testSetAccuracy,
        testSetIntentRecognitionAccuracy,
      });

      // 更新准确性指标数据
      setAccuracyMetrics({
        actualResponseAccuracy: data.actualResponseAccuracy ?? 0,
        testResponseAccuracy: testSetAccuracy ?? 0,
        testIntentRecognitionAccuracy: testSetIntentRecognitionAccuracy ?? 0,
        testSetFileName: data.testSetFileName ?? '',
        fileName: data.fileName ?? '',
      });

      // 如果状态是进行中(1)且有batchId，开始轮询
      if (processStatus === 1 && batchId && startPollingTestSetResultRef.current) {
        startPollingTestSetResultRef.current(batchId);
      }
    } catch (error) {
      console.error(intl.formatMessage({ id: 'operation.error.fetchAccuracyMetrics' }), error);
    } finally {
      setAccuracyLoading(false);
    }
  }, [agentId, intl]);

  // 获取技术性指标数据
  const fetchTechnicalMetrics = useCallback(async () => {
    if (!agentId) return;

    try {
      setTechnicalLoading(true);
      const { startTime, endTime } = getTechnicalTimeRange;

      const response = await getUsageMetrics({
        queryCode: 'DIG_EMPLOYEE_TECHNICAL_METRICS',
        params: {
          startTime,
          endTime,
          resourceId: Number(agentId),
          resObjType: 'AGENT',
        },
      });

      const data = response?.data || {};

      // 设置技术性指标数据
      setTechnicalMetrics({
        avgFirstTextDuration: data.avgFirstTextDuration ?? 0,
        avgTaskDueTime: data.avgTaskDueTime ?? 0,
        errorRate: data.errorRate ?? 0,
        inputTokenTotal: data.inputTokenTotal ?? 0,
        outputTokenTotal: data.outputTokenTotal ?? 0,
        avgOutPutTokenPerSecondTotal: data.avgOutPutTokenPerSecondTotal ?? 0,
        avgInputTokenTotal: data.avgInputTokenTotal ?? 0,
        avgOutputTokenTotal: data.avgOutputTokenTotal ?? 0,
        outputTokenPerSecondTotal: data.outputTokenPerSecondTotal ?? 0,
      });

      // 处理趋势图数据
      const trend: any[] = data.trend || [];

      const firstTextDurationTrend = trend.map((item) => ({
        date: dayjs(item.date).format('YYYY.MM.DD'),
        value: item.avgFirstTextDuration ?? 0,
      }));

      const errorRateTrend = trend.map((item) => ({
        date: dayjs(item.date).format('YYYY.MM.DD'),
        value: (item.errorRate ?? 0) * 100, // 转换为百分比
      }));

      const inputTokenTrend = trend.map((item) => ({
        date: dayjs(item.date).format('YYYY.MM.DD'),
        value: item.dayInputTokenTotal ?? 0,
      }));

      const outputTokenTrend = trend.map((item) => ({
        date: dayjs(item.date).format('YYYY.MM.DD'),
        value: item.dayOutputTokenTotal ?? 0,
      }));

      const tokenPerSecondTrend = trend.map((item) => ({
        date: dayjs(item.date).format('YYYY.MM.DD'),
        value: item.dayOutputTokenPerSecondTotal ?? 0,
      }));

      setFirstTextDurationTrendData(firstTextDurationTrend);
      setErrorRateTrendData(errorRateTrend);
      setInputTokenTrendData(inputTokenTrend);
      setOutputTokenTrendData(outputTokenTrend);
      setTokenPerSecondTrendData(tokenPerSecondTrend);
    } catch (error) {
      console.error(intl.formatMessage({ id: 'operation.error.fetchTechnicalMetrics' }), error);
    } finally {
      setTechnicalLoading(false);
    }
  }, [agentId, getTechnicalTimeRange, intl]);

  // 初始化图表
  useEffect(() => {
    if (
      !serviceTrendRef.current ||
      !userTrendRef.current ||
      !avgDialogTrendRef.current ||
      !userSatisfactionTrendRef.current ||
      !firstTextDurationTrendRef.current ||
      !errorRateTrendRef.current ||
      !inputTokenTrendRef.current ||
      !outputTokenTrendRef.current ||
      !tokenPerSecondTrendRef.current
    ) {
      return () => {};
    }

    // 服务次数趋势图
    if (serviceTrendRef.current && !serviceChartRef.current) {
      serviceChartRef.current = echarts.init(serviceTrendRef.current);
    }

    // 使用人数趋势图
    if (userTrendRef.current && !userChartRef.current) {
      userChartRef.current = echarts.init(userTrendRef.current);
    }

    // 人均对话趋势图
    if (avgDialogTrendRef.current && !avgDialogChartRef.current) {
      avgDialogChartRef.current = echarts.init(avgDialogTrendRef.current);
    }

    // 用户满意度趋势图
    if (userSatisfactionTrendRef.current && !userSatisfactionChartRef.current) {
      userSatisfactionChartRef.current = echarts.init(userSatisfactionTrendRef.current);
    }

    // 平均首词响应时长趋势图
    if (firstTextDurationTrendRef.current && !firstTextDurationChartRef.current) {
      firstTextDurationChartRef.current = echarts.init(firstTextDurationTrendRef.current);
    }

    // 对话异常率趋势图
    if (errorRateTrendRef.current && !errorRateChartRef.current) {
      errorRateChartRef.current = echarts.init(errorRateTrendRef.current);
    }

    // 输入token消耗量趋势图
    if (inputTokenTrendRef.current && !inputTokenChartRef.current) {
      inputTokenChartRef.current = echarts.init(inputTokenTrendRef.current);
    }

    // 输出token消耗量趋势图
    if (outputTokenTrendRef.current && !outputTokenChartRef.current) {
      outputTokenChartRef.current = echarts.init(outputTokenTrendRef.current);
    }

    // 每秒token消耗量趋势图
    if (tokenPerSecondTrendRef.current && !tokenPerSecondChartRef.current) {
      tokenPerSecondChartRef.current = echarts.init(tokenPerSecondTrendRef.current);
    }

    return () => {
      if (serviceChartRef.current) {
        serviceChartRef.current.dispose();
        serviceChartRef.current = null;
      }
      if (userChartRef.current) {
        userChartRef.current.dispose();
        userChartRef.current = null;
      }
      if (avgDialogChartRef.current) {
        avgDialogChartRef.current.dispose();
        avgDialogChartRef.current = null;
      }
      if (userSatisfactionChartRef.current) {
        userSatisfactionChartRef.current.dispose();
        userSatisfactionChartRef.current = null;
      }
      if (firstTextDurationChartRef.current) {
        firstTextDurationChartRef.current.dispose();
        firstTextDurationChartRef.current = null;
      }
      if (errorRateChartRef.current) {
        errorRateChartRef.current.dispose();
        errorRateChartRef.current = null;
      }
      if (inputTokenChartRef.current) {
        inputTokenChartRef.current.dispose();
        inputTokenChartRef.current = null;
      }
      if (outputTokenChartRef.current) {
        outputTokenChartRef.current.dispose();
        outputTokenChartRef.current = null;
      }
      if (tokenPerSecondChartRef.current) {
        tokenPerSecondChartRef.current.dispose();
        tokenPerSecondChartRef.current = null;
      }
    };
  }, []);

  // 更新图表
  useEffect(() => {
    const updateChart = (
      chartRef: any,
      data: any[],
      title: string,
      color: string = '#126DFF',
      hasNegativeYAxis: boolean = false
    ) => {
      if (!chartRef || !data.length) return;

      const dates = data.map((item) => item.date);
      const values = data.map((item) => item.value);

      const option = {
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'cross',
          },
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          top: '10%',
          containLabel: true,
        },
        xAxis: {
          type: 'category',
          boundaryGap: false,
          data: dates,
          axisLine: {
            lineStyle: {
              color: '#e5e6eb',
            },
          },
          axisLabel: {
            color: '#86909c',
            fontSize: 12,
          },
        },
        yAxis: {
          type: 'value',
          axisLine: {
            show: false,
          },
          axisTick: {
            show: false,
          },
          axisLabel: {
            formatter: '{value}',
            color: '#86909c',
            fontSize: 12,
          },
          minInterval: hasNegativeYAxis ? undefined : 1,
          splitLine: {
            lineStyle: {
              color: '#f0f0f0',
            },
          },
          // 如果有负值，添加基线标记
          ...(hasNegativeYAxis && {
            axisLine: {
              show: true,
              lineStyle: {
                color: '#e5e6eb',
              },
            },
          }),
        },
        series: [
          {
            name: title,
            type: 'line',
            data: values,
            smooth: false,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: {
              color,
              width: 2,
            },
            itemStyle: {
              color,
            },
            areaStyle: hasNegativeYAxis
              ? {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: 'rgba(18, 109, 255, 0.1)' },
                    { offset: 0.5, color: 'rgba(18, 109, 255, 0.05)' },
                    { offset: 1, color: 'rgba(18, 109, 255, 0)' },
                  ],
                },
              }
              : {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0.3, color: color === '#126DFF' ? '#D1E2FF' : '#E8D5FF' },
                    { offset: 1, color: 'rgba(248, 251, 255, 0.078)' },
                  ],
                },
              },
          },
        ],
      };

      chartRef.setOption(option);
    };

    if (serviceChartRef.current && serviceTrendData.length) {
      updateChart(
        serviceChartRef.current,
        serviceTrendData,
        intl.formatMessage({ id: 'operation.usageMetrics.serviceTrend' })
      );
    }
    if (userChartRef.current && userTrendData.length) {
      updateChart(userChartRef.current, userTrendData, intl.formatMessage({ id: 'operation.usageMetrics.userTrend' }));
    }
    if (avgDialogChartRef.current && avgDialogTrendData.length) {
      updateChart(
        avgDialogChartRef.current,
        avgDialogTrendData,
        intl.formatMessage({ id: 'operation.usageMetrics.avgDialogTrend' })
      );
    }
    if (userSatisfactionChartRef.current && userSatisfactionTrendData.length) {
      updateChart(
        userSatisfactionChartRef.current,
        userSatisfactionTrendData,
        intl.formatMessage({ id: 'operation.usageMetrics.userSatisfactionTrend' }),
        '#126DFF',
        true // 支持负值Y轴
      );
    }
    if (firstTextDurationChartRef.current && firstTextDurationTrendData.length) {
      updateChart(
        firstTextDurationChartRef.current,
        firstTextDurationTrendData,
        intl.formatMessage({ id: 'operation.technicalMetrics.firstTextDurationTrend' }),
        '#725CFA'
      );
    }
    if (errorRateChartRef.current && errorRateTrendData.length) {
      updateChart(
        errorRateChartRef.current,
        errorRateTrendData,
        intl.formatMessage({ id: 'operation.technicalMetrics.errorRateTrend' }),
        '#725CFA'
      );
    }
    if (inputTokenChartRef.current && inputTokenTrendData.length) {
      updateChart(
        inputTokenChartRef.current,
        inputTokenTrendData,
        intl.formatMessage({ id: 'operation.technicalMetrics.inputTokenTrend' }),
        '#126DFF'
      );
    }
    if (outputTokenChartRef.current && outputTokenTrendData.length) {
      updateChart(
        outputTokenChartRef.current,
        outputTokenTrendData,
        intl.formatMessage({ id: 'operation.technicalMetrics.outputTokenTrend' }),
        '#126DFF'
      );
    }
    if (tokenPerSecondChartRef.current && tokenPerSecondTrendData.length) {
      updateChart(
        tokenPerSecondChartRef.current,
        tokenPerSecondTrendData,
        intl.formatMessage({ id: 'operation.technicalMetrics.tokenPerSecondTrend' }),
        '#725CFA'
      );
    }
  }, [
    serviceTrendData,
    userTrendData,
    avgDialogTrendData,
    userSatisfactionTrendData,
    firstTextDurationTrendData,
    errorRateTrendData,
    inputTokenTrendData,
    outputTokenTrendData,
    tokenPerSecondTrendData,
    intl,
  ]);

  // 获取运营信息（基本信息）
  const fetchOperationsInfo = useCallback(async () => {
    if (!agentId) return;

    try {
      setBasicInfoLoading(true);
      const response = await getOperationsInfo(agentId);
      if (response?.data) {
        setOperationsInfo(response.data);
      }
    } catch (error) {
      console.error(intl.formatMessage({ id: 'operation.error.fetchOperationsInfo' }), error);
    } finally {
      setBasicInfoLoading(false);
    }
  }, [agentId, intl]);

  // 获取高频问题TOP10
  const fetchFrequentQuestions = useCallback(async () => {
    if (!agentId) return;

    try {
      setFrequentQuestionsLoading(true);
      const response = await getFrequentQuestions({
        memSceneId: 110,
        agentId: Number(agentId),
      });

      const data = response?.data || {};
      const workDescription = data.workDescription || [];

      // 处理数据，确保是数组格式
      const questions = Array.isArray(workDescription) ? workDescription : [];
      setFrequentQuestions(questions);
    } catch (error) {
      console.error(intl.formatMessage({ id: 'operation.error.fetchFrequentQuestions' }), error);
      setFrequentQuestions([]);
    } finally {
      setFrequentQuestionsLoading(false);
    }
  }, [agentId, intl]);

  // 停止定时轮询
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // 开始定时轮询测试集结果
  const startPollingTestSetResult = useCallback(
    (batchId: string) => {
      stopPolling(); // 先清除之前的定时器

      const poll = async () => {
        if (unmountedRef.current || !agentId || !batchId) {
          stopPolling();
          return;
        }

        try {
          const response = await getTestSetResult({
            resourceId: agentId,
            batchId,
          });

          if (response?.code === 0 && response?.data) {
            const { processStatus, batchId, failReason, testSetAccuracy, testSetIntentRecognitionAccuracy } =
              response.data;

            setTestSetStatus({
              processStatus,
              batchId,
              failReason,
              testSetAccuracy,
              testSetIntentRecognitionAccuracy,
            });

            // 如果状态不是进行中(1)，停止轮询
            if (processStatus !== 1) {
              stopPolling();
              // 如果成功，更新准确性指标
              if (processStatus === 0) {
                setAccuracyMetrics((prev) => ({
                  ...prev,
                  testResponseAccuracy: testSetAccuracy ?? 0,
                  testIntentRecognitionAccuracy: testSetIntentRecognitionAccuracy ?? 0,
                }));
                message.success(intl.formatMessage({ id: 'operation.testSet.parseSuccess' }));
              } else if (processStatus === 2) {
                message.error(intl.formatMessage({ id: 'operation.testSet.parseFail' }));
              }
            }
          } else {
            stopPolling();
            message.error(response?.msg || intl.formatMessage({ id: 'operation.testSetResult.fetchFail' }));
          }
        } catch (error) {
          stopPolling();
          console.error(intl.formatMessage({ id: 'operation.testSetResult.fetchFail' }), error);
          message.error(intl.formatMessage({ id: 'operation.testSetResult.fetchFail' }));
        }
      };

      // 立即执行一次
      poll();
      // 定时轮询
      pollTimerRef.current = setInterval(poll, POLLING_INTERVAL);
    },
    [agentId, stopPolling, intl]
  );

  // 同步 startPollingTestSetResult 到 ref
  useEffect(() => {
    startPollingTestSetResultRef.current = startPollingTestSetResult;
  }, [startPollingTestSetResult]);

  // 处理测试集上传
  const handleUploadTestSet = useCallback(
    async (file: File) => {
      if (!agentId) {
        message.error(intl.formatMessage({ id: 'operation.testSet.selectEmployeeFirst' }));
        return;
      }

      try {
        const response = await uploadTestSet({
          resourceId: agentId,
          file,
        });

        if (response?.code === 0 && response?.data) {
          const { processStatus, batchId, failReason, testSetAccuracy, testSetIntentRecognitionAccuracy } =
            response.data;

          setTestSetStatus({
            processStatus,
            batchId,
            failReason,
            testSetAccuracy,
            testSetIntentRecognitionAccuracy,
          });

          // 上传文件时，立即保存文件名
          setAccuracyMetrics((prev) => ({
            ...prev,
            fileName: file.name,
            testSetFileName: file.name,
          }));

          // 如果是进行中，开始轮询
          if (processStatus === 1 && batchId) {
            startPollingTestSetResult(batchId);
          } else if (processStatus === 0) {
            // 如果已经成功，更新准确性指标
            setAccuracyMetrics((prev) => ({
              ...prev,
              testResponseAccuracy: testSetAccuracy ?? 0,
              testIntentRecognitionAccuracy: testSetIntentRecognitionAccuracy ?? 0,
            }));
            message.success(intl.formatMessage({ id: 'operation.testSet.uploadSuccess' }));
          } else if (processStatus === 2) {
            message.error(intl.formatMessage({ id: 'operation.testSet.parseFail' }));
          }

          setUploadTestSetVisible(false);
        } else {
          message.error(response?.msg || intl.formatMessage({ id: 'operation.uploadTestSet.uploadFail' }));
        }
      } catch (error) {
        console.error(intl.formatMessage({ id: 'operation.uploadTestSet.uploadFail' }), error);
        message.error(intl.formatMessage({ id: 'operation.uploadTestSet.uploadFail' }));
      }
    },
    [agentId, startPollingTestSetResult, intl]
  );

  // 组件卸载时清除定时器并打标记
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      stopPolling();
    };
  }, [stopPolling]);

  // 当切换员工时，清理之前的轮询，避免残留定时器
  useEffect(() => {
    stopPolling();
  }, [agentId, stopPolling]);

  // 下载测试集模版
  const handleDownloadTemplate = useCallback(async () => {
    try {
      const fileName = TEST_SET_TEMPLATE_FILE_NAME;
      // public 目录下的文件可以直接通过路径访问
      const filePath = `${_PUBLIC_PATH_}download/${encodeURIComponent(fileName)}`;

      // 使用 fetch 获取文件
      const response = await fetch(filePath);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(intl.formatMessage({ id: 'operation.testSet.downloadTemplateFail' }), error);
      message.error(intl.formatMessage({ id: 'operation.testSet.downloadTemplateFail' }));
    }
  }, [intl]);

  // 获取数据
  useEffect(() => {
    if (agentId) {
      fetchOperationsInfo();
      fetchUsageMetrics();
      fetchAccuracyMetrics();
      fetchFrequentQuestions();
    }
  }, [agentId, fetchOperationsInfo, fetchUsageMetrics, fetchAccuracyMetrics, fetchFrequentQuestions]);

  // 技术性指标数据获取（依赖时间范围）
  useEffect(() => {
    if (agentId) {
      fetchTechnicalMetrics();
    }
  }, [agentId, fetchTechnicalMetrics]);

  // 处理窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      if (serviceChartRef.current) {
        serviceChartRef.current.resize();
      }
      if (userChartRef.current) {
        userChartRef.current.resize();
      }
      if (avgDialogChartRef.current) {
        avgDialogChartRef.current.resize();
      }
      if (userSatisfactionChartRef.current) {
        userSatisfactionChartRef.current.resize();
      }
      if (firstTextDurationChartRef.current) {
        firstTextDurationChartRef.current.resize();
      }
      if (errorRateChartRef.current) {
        errorRateChartRef.current.resize();
      }
      if (inputTokenChartRef.current) {
        inputTokenChartRef.current.resize();
      }
      if (outputTokenChartRef.current) {
        outputTokenChartRef.current.resize();
      }
      if (tokenPerSecondChartRef.current) {
        tokenPerSecondChartRef.current.resize();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className={styles.operation}>
      <div className={styles.content}>
        {/* 基本信息区域 */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{intl.formatMessage({ id: 'operation.basicInfo' })}</div>
          <Spin spinning={basicInfoLoading}>
            <div className={styles.basicInfo}>
              <div className={styles.infoGrid}>
                <div className={styles.infoCard}>
                  <div className={styles.infoLabel}>{intl.formatMessage({ id: 'operation.basicInfo.orgName' })}</div>
                  <div className={styles.infoValue}>{operationsInfo?.orgName || '--'}</div>
                </div>
                <div className={styles.infoCard}>
                  <div className={styles.infoLabel}>
                    {intl.formatMessage({ id: 'operation.basicInfo.catalogName' })}
                  </div>
                  <div className={styles.infoValue}>{operationsInfo?.catalogName || '-'}</div>
                </div>
                <div className={`${styles.infoCard} ${styles.tagCard}`}>
                  <div className={styles.infoLabel}>
                    {intl.formatMessage({ id: 'operation.basicInfo.relatedKnowledge' })}
                  </div>
                  <div className={styles.tagList}>
                    <Ellipsis tooltip lines={1}>
                      {knowledgeList.length > 0
                        ? knowledgeList.map((kb: any, index: number) => (
                          <span key={kb.relResourceId || index} className={styles.tag} style={{ color: '#165DFF' }}>
                            <AntdIcon type="icon-a-Book-oneshuji12" style={{ color: '#165DFF', marginRight: 4 }} />
                            {kb.resourceName || '--'}
                          </span>
                        ))
                        : '--'}
                    </Ellipsis>
                  </div>
                </div>
                <div className={styles.infoCard}>
                  <div className={styles.infoLabel}>{intl.formatMessage({ id: 'operation.basicInfo.manager' })}</div>
                  <div className={styles.infoValue}>{operationsInfo?.userName || '--'}</div>
                </div>
                <div className={styles.infoCard}>
                  <div className={styles.infoLabel}>{intl.formatMessage({ id: 'operation.basicInfo.position' })}</div>
                  <div className={styles.infoValue}>{operationsInfo?.positionName || '--'}</div>
                </div>
                <div className={`${styles.infoCard} ${styles.tagCard}`}>
                  <div className={styles.infoLabel}>{intl.formatMessage({ id: 'operation.basicInfo.skillCall' })}</div>
                  <div className={styles.tagList}>
                    <Ellipsis tooltip lines={1}>
                      {skillList.length > 0
                        ? skillList.map((skill: any, index: number) => (
                          <span
                            key={skill.relResourceId || index}
                            className={styles.tag}
                            style={{ color: '#0DA5AA' }}
                          >
                            <AntdIcon
                              type="icon-chuangjianfangshi-chajian"
                              style={{ color: '#0DA5AA', marginRight: 4 }}
                            />
                            {skill.resourceName || '--'}
                          </span>
                        ))
                        : '--'}
                    </Ellipsis>
                  </div>
                </div>
              </div>
            </div>
          </Spin>
        </div>

        {/* 规范性指标区域 */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{intl.formatMessage({ id: 'operation.normativeMetrics' })}</div>
          <div className={styles.normativeMetrics}>
            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>
                {intl.formatMessage({ id: 'operation.normativeMetrics.abilityMatchDegree' })}
              </div>
              <div className={styles.metricValue}>--</div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricLabel}>
                {intl.formatMessage({ id: 'operation.normativeMetrics.personaNormativity' })}
              </div>
              <div className={styles.metricValue}>
                <Rate
                  disabled
                  allowHalf
                  value={parseFloat(operationsInfo?.targetQuality || '0') || 0}
                  style={{ fontSize: 20 }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 高频问题TOP10 */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>{intl.formatMessage({ id: 'operation.frequentQuestions' })}</div>
          <Spin spinning={frequentQuestionsLoading}>
            <div className={styles.frequentQuestionsList}>
              {frequentQuestions.length > 0 ? (
                <div className={styles.questionsScrollContainer}>
                  {frequentQuestions.map((item: any, index: number) => {
                    // 根据索引或问题内容选择图标
                    const iconTypes = [
                      'icon-a-Calendar-rili',
                      'icon-a-Fire-huoyan',
                      'icon-a-Eye-yanjing',
                      'icon-a-Bell-lingdang',
                      'icon-a-Hand-shou',
                    ];
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const iconType = iconTypes[index % iconTypes.length];
                    return (
                      <div key={index} className={styles.questionItem} title={item}>
                        <div className={styles.questionText}>{item}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.emptyQuestions}>
                  {intl.formatMessage({ id: 'operation.frequentQuestions.empty' })}
                </div>
              )}
            </div>
          </Spin>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div className={styles.sectionTitle} style={{ marginRight: 16, marginBottom: 0 }}>
            <span className={styles.sectionTitleText} />
            {intl.formatMessage({ id: 'operation.usageMetrics' })}
          </div>
          <div className={styles.timeSelector} style={{ display: 'flex', gap: 8 }}>
            <Segmented
              value={usagePeriod}
              onChange={(value) => setUsagePeriod(value as string)}
              options={[
                { label: intl.formatMessage({ id: 'operation.usageMetrics.weekAnalysis' }), value: 'week' },
                { label: intl.formatMessage({ id: 'operation.usageMetrics.monthAnalysis' }), value: 'month' },
              ]}
              className={styles.periodTabs}
            />
            {usagePeriod === 'week' ? (
              <DatePicker
                picker="week"
                value={selectedWeek as any}
                onChange={(date: any) => setSelectedWeek(date || dayjs())}
                allowClear={false}
                format={(value) => {
                  if (!value) return '';
                  const start = value.startOf('week');
                  const end = value.endOf('week');
                  const year = start.year();
                  return `${year}-${start.format('MM-DD')}~${end.format('MM-DD')}`;
                }}
                className={styles.datePicker}
              />
            ) : (
              <DatePicker
                picker="month"
                value={selectedDate as any}
                onChange={(date: any) => setSelectedDate(date || dayjs())}
                allowClear={false}
                format="YYYY-MM"
                className={styles.datePicker}
              />
            )}
          </div>
        </div>
        <div className={styles.metricsRow}>
          <div className={styles.metricCard}>
            <div className={styles.metricContent}>
              <div
                className={styles.metricIcon}
                style={{ background: 'var(--Colorful-Gradient-V--, linear-gradient(0deg, #52ACFF 0%, #725CFA 100%))' }}
              >
                <AntdIcon type="icon-huihua" style={{ fontSize: 18, color: '#fff' }} />
              </div>
              <div className={styles.metricInfo}>
                <div className={styles.metricTitle}>
                  {intl.formatMessage({ id: 'operation.usageMetrics.totalServiceCount' })}
                </div>
                <div className={styles.metricValue}>{usageMetrics.totalServiceCount}</div>
              </div>
            </div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.metricContent}>
              <div
                className={styles.metricIcon}
                style={{ background: 'linear-gradient(0deg, #C067FF 0%, #3150FF 100%)' }}
              >
                <AntdIcon type="icon-a-Peoplesrenqun1" style={{ fontSize: 18, color: '#fff' }} />
              </div>
              <div className={styles.metricInfo}>
                <div className={styles.metricTitle}>
                  {intl.formatMessage({ id: 'operation.usageMetrics.totalServiceUsers' })}
                </div>
                <div className={styles.metricValue}>{usageMetrics.totalServiceUsers}</div>
              </div>
            </div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.metricContent}>
              <div
                className={styles.metricIcon}
                style={{ background: 'linear-gradient(0deg, #76DFFF 0%, #3FA3FF 100%)' }}
              >
                <AntdIcon type="icon-a-Messagexinxi" style={{ fontSize: 18, color: '#fff' }} />
              </div>
              <div className={styles.metricInfo}>
                <div className={styles.metricTitle}>
                  {intl.formatMessage({ id: 'operation.usageMetrics.avgDialoguesPerPerson' })}
                </div>
                <div className={styles.metricValue}>{usageMetrics.avgDialoguesPerPerson}</div>
              </div>
            </div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.metricContent}>
              <div
                className={styles.metricIcon}
                style={{ background: 'var(--Colorful-Gradient-V--, linear-gradient(0deg, #52ACFF 0%, #725CFA 100%))' }}
              >
                <AntdIcon type="icon-a-Thumbs-upzan" style={{ fontSize: 18, color: '#fff' }} />
              </div>
              <div className={styles.metricInfo}>
                <div className={styles.metricTitle}>{intl.formatMessage({ id: 'operation.usageMetrics.likes' })}</div>
                <div className={styles.metricValue}>{usageMetrics.likes}</div>
              </div>
            </div>
          </div>
          <div className={styles.metricCard}>
            <div className={styles.metricContent}>
              <div
                className={styles.metricIcon}
                style={{ background: 'linear-gradient(0deg, #FF903E 0%, #FF5A5A 100%)' }}
              >
                <AntdIcon type="icon-a-Thumbs-downcai" style={{ fontSize: 18, color: '#fff' }} />
              </div>
              <div className={styles.metricInfo}>
                <div className={styles.metricTitle}>
                  {intl.formatMessage({ id: 'operation.usageMetrics.dislikes' })}
                </div>
                <div className={styles.metricValue}>{usageMetrics.dislikes}</div>
              </div>
            </div>
          </div>
        </div>
        {/* 使用指标区域 */}
        <div className={styles.section}>
          <div className={styles.usageSection}>
            {/* 趋势图 */}
            <div className={styles.chartsRow4}>
              <div className={styles.chartCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {intl.formatMessage({ id: 'operation.usageMetrics.serviceTrend' })}
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <Spin spinning={usageLoading}>
                    <div ref={serviceTrendRef} className={styles.chartContainer} />
                  </Spin>
                </div>
              </div>
              <div className={styles.chartCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {intl.formatMessage({ id: 'operation.usageMetrics.userTrend' })}
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <Spin spinning={usageLoading}>
                    <div ref={userTrendRef} className={styles.chartContainer} />
                  </Spin>
                </div>
              </div>
              <div className={styles.chartCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {intl.formatMessage({ id: 'operation.usageMetrics.avgDialogTrend' })}
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <Spin spinning={usageLoading}>
                    <div ref={avgDialogTrendRef} className={styles.chartContainer} />
                  </Spin>
                </div>
              </div>
              <div className={styles.chartCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {intl.formatMessage({ id: 'operation.usageMetrics.userSatisfactionTrend' })}
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <Spin spinning={usageLoading}>
                    <div ref={userSatisfactionTrendRef} className={styles.chartContainer} />
                  </Spin>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className={styles.sectionTitle} style={{ marginRight: 16, marginBottom: 0 }}>
            <span className={styles.sectionTitleText} />
            {intl.formatMessage({ id: 'operation.accuracyMetrics' })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* 产品助理测试集按钮 */}
            {accuracyMetrics.testResponseAccuracy > 0 && (
              <div className={styles.accuracyMetricsBtn} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AntdIcon type="icon-Excel" style={{ fontSize: 14 }} />
                {accuracyMetrics.fileName}
                <Button
                  type="link"
                  style={{ padding: 0, color: '#165DFF' }}
                  onClick={() => {
                    setTestSetResultVisible(true);
                  }}
                >
                  {intl.formatMessage({ id: 'operation.accuracyMetrics.viewResults' })}
                </Button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
                {intl.formatMessage({ id: 'operation.accuracyMetrics.downloadTemplate' })}
              </Button>
              <Button
                icon={<UploadOutlined />}
                onClick={() => {
                  setUploadTestSetVisible(true);
                }}
              >
                {intl.formatMessage({ id: 'operation.accuracyMetrics.uploadTestSet' })}
              </Button>
            </div>
          </div>
        </div>
        {/* 准确性指标区域 */}
        <Spin spinning={accuracyLoading}>
          <div className={styles.accuracyMetrics}>
            <div className={styles.metricCard}>
              <div className={styles.metricContent}>
                <div
                  className={styles.metricIcon}
                  style={{
                    background: 'var(--Colorful-Gradient-V--, linear-gradient(0deg, #52ACFF 0%, #725CFA 100%))',
                  }}
                >
                  <AntdIcon type="icon-a-Tipstishi" style={{ fontSize: 18, color: '#fff' }} />
                </div>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>
                    {intl.formatMessage({ id: 'operation.accuracyMetrics.actualResponseAccuracy' })}
                  </div>
                  <div className={styles.metricValue}>
                    {accuracyMetrics.actualResponseAccuracy > 0
                      ? `${accuracyMetrics.actualResponseAccuracy.toFixed(2)}`
                      : '0'}
                    <span className={styles.metricValueUnit}>
                      {intl.formatMessage({ id: 'operation.unit.percent' })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.metricCard} style={{ display: 'flex' }}>
              <div className={styles.metricContent} style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div
                    className={styles.metricIcon}
                    style={{
                      background: 'linear-gradient(0deg, #C067FF 0%, #3150FF 100%)',
                    }}
                  >
                    <AntdIcon type="icon-a-Circle-fouryuanquan" style={{ fontSize: 18, color: '#fff' }} />
                  </div>
                  <div className={styles.metricInfo}>
                    {/* 只有在显示准确率时才显示标题 */}
                    {accuracyMetrics.testResponseAccuracy > 0 &&
                      testSetStatus.processStatus !== 1 &&
                      testSetStatus.processStatus !== 2 && (
                      <div className={styles.metricTitle}>
                        {intl.formatMessage({ id: 'operation.accuracyMetrics.testResponseAccuracy' })}
                      </div>
                    )}
                    {/* 优先判断处理状态 */}
                    {testSetStatus.processStatus === 1 ? (
                      <div className={styles.metricValue} style={{ color: '#40454D', fontSize: 12 }}>
                        {intl.formatMessage(
                          { id: 'operation.testSet.parsing' },
                          { fileName: accuracyMetrics.fileName || accuracyMetrics.testSetFileName || '测试集' }
                        )}
                        <span className={styles.loadingDots}>
                          <span>.</span>
                          <span>.</span>
                          <span>.</span>
                        </span>
                      </div>
                    ) : testSetStatus.processStatus === 2 ? (
                      <div className={styles.metricValue} style={{ color: '#40454D', fontSize: 12 }}>
                        {intl.formatMessage({ id: 'operation.testSet.parseFailedRetry' })}
                        <Button
                          type="link"
                          style={{ padding: 0, color: '#FF7D00', marginLeft: 4 }}
                          onClick={() => {
                            setTestSetFailReasonVisible(true);
                          }}
                        >
                          {intl.formatMessage({ id: 'operation.testSet.viewFailReason' })}
                        </Button>
                      </div>
                    ) : accuracyMetrics.testResponseAccuracy > 0 ? (
                      <div className={styles.metricValue}>
                        {`${accuracyMetrics.testResponseAccuracy.toFixed(2)}`}
                        <span className={styles.metricValueUnit}>%</span>
                      </div>
                    ) : (
                      <Button
                        type="link"
                        style={{ padding: 0, color: '#165DFF' }}
                        onClick={() => {
                          setUploadTestSetVisible(true);
                        }}
                      >
                        {intl.formatMessage({ id: 'operation.testSet.clickToUpload' })}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricContent}>
                <div
                  className={styles.metricIcon}
                  style={{
                    background: 'linear-gradient(0deg, #76DFFF 0%, #3FA3FF 100%)',
                  }}
                >
                  <AntdIcon type="icon-a-Cross-ringjiaochahuan" style={{ fontSize: 18, color: '#fff' }} />
                </div>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>
                    {intl.formatMessage({ id: 'operation.accuracyMetrics.testIntentRecognitionAccuracy' })}
                  </div>
                  <div className={styles.metricValue}>
                    {accuracyMetrics.testIntentRecognitionAccuracy > 0
                      ? `${accuracyMetrics.testIntentRecognitionAccuracy.toFixed(2)}`
                      : '--'}
                    <span
                      className={styles.metricValueUnit}
                      style={{ display: accuracyMetrics.testIntentRecognitionAccuracy > 0 ? '' : 'none' }}
                    >
                      %
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Spin>

        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <div className={styles.sectionTitle} style={{ marginRight: 16, marginBottom: 0 }}>
            <span className={styles.sectionTitleText} />
            {intl.formatMessage({ id: 'operation.technicalMetrics' })}
          </div>
          <div className={styles.timeSelector} style={{ display: 'flex', gap: 8 }}>
            <Segmented
              value={technicalPeriod}
              onChange={(value) => setTechnicalPeriod(value as string)}
              options={[
                { label: intl.formatMessage({ id: 'operation.usageMetrics.weekAnalysis' }), value: 'week' },
                { label: intl.formatMessage({ id: 'operation.usageMetrics.monthAnalysis' }), value: 'month' },
              ]}
              className={styles.periodTabs}
            />
            {technicalPeriod === 'week' ? (
              <DatePicker
                picker="week"
                value={technicalSelectedWeek as any}
                onChange={(date: any) => setTechnicalSelectedWeek(date || dayjs())}
                allowClear={false}
                format={(value) => {
                  if (!value) return '';
                  const start = value.startOf('week');
                  const end = value.endOf('week');
                  const year = start.year();
                  return `${year}-${start.format('MM-DD')}~${end.format('MM-DD')}`;
                }}
                className={styles.datePicker}
              />
            ) : (
              <DatePicker
                picker="month"
                value={technicalSelectedDate as any}
                onChange={(date: any) => setTechnicalSelectedDate(date || dayjs())}
                allowClear={false}
                format="YYYY-MM"
                className={styles.datePicker}
              />
            )}
          </div>
        </div>

        {/* 技术性指标区域 */}
        <Spin spinning={technicalLoading}>
          <div className={styles.technicalMetrics}>
            <div className={styles.metricCard}>
              <div className={styles.metricContent}>
                <div
                  className={styles.metricIcon}
                  style={{
                    background: 'var(--Colorful-Gradient-V--, linear-gradient(0deg, #52ACFF 0%, #725CFA 100%))',
                  }}
                >
                  <ThunderboltOutlined style={{ fontSize: 18, color: '#fff' }} />
                </div>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.avgFirstTextDuration' })}
                  </div>
                  <div className={styles.metricValue}>
                    {technicalMetrics.avgFirstTextDuration > 0
                      ? `${technicalMetrics.avgFirstTextDuration.toFixed(2)}`
                      : '0'}
                    <span className={styles.metricValueUnit}>{intl.formatMessage({ id: 'operation.unit.ms' })}</span>
                  </div>
                </div>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.avgTaskDueTime' })}
                  </div>
                  <div className={styles.metricValue}>
                    {technicalMetrics.avgTaskDueTime > 0 ? `${technicalMetrics.avgTaskDueTime.toFixed(2)}` : '0'}
                    <span className={styles.metricValueUnit}>{intl.formatMessage({ id: 'operation.unit.ms' })}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricContent}>
                <div
                  className={styles.metricIcon}
                  style={{ background: 'linear-gradient(0deg, #76DFFF 0%, #3FA3FF 100%)' }}
                >
                  <AntdIcon type="icon-a-Tips-onetishi" style={{ fontSize: 18, color: '#fff' }} />
                </div>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.errorRate' })}
                  </div>
                  <div className={styles.metricValue}>
                    {technicalMetrics.errorRate > 0 ? `${technicalMetrics.errorRate.toFixed(2)}` : '0'}
                    <span className={styles.metricValueUnit}>
                      {intl.formatMessage({ id: 'operation.unit.percent' })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Spin>

        {/* 平均首词响应时长/对话异常率的折线图 */}
        <div className={styles.section}>
          <div className={styles.usageSection}>
            <div className={styles.chartsRow2}>
              <div className={styles.chartCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.firstTextDurationTrend' })}
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <Spin spinning={technicalLoading}>
                    <div ref={firstTextDurationTrendRef} className={styles.chartContainer} />
                  </Spin>
                </div>
              </div>
              <div className={styles.chartCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.errorRateTrend' })}
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <Spin spinning={technicalLoading}>
                    <div ref={errorRateTrendRef} className={styles.chartContainer} />
                  </Spin>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Token消耗指标区域 */}
        <Spin spinning={technicalLoading}>
          <div className={styles.accuracyMetrics}>
            <div className={styles.metricCard}>
              <div className={styles.metricContent}>
                <div
                  className={styles.metricIcon}
                  style={{
                    background: 'var(--Colorful-Gradient-V--, linear-gradient(0deg, #52ACFF 0%, #725CFA 100%))',
                  }}
                >
                  <AntdIcon type="icon-a-Downloadxiazai" style={{ fontSize: 18, color: '#fff' }} />
                </div>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.inputTokenTotal' })}
                  </div>
                  <div className={styles.metricValue}>{formatTokenValue(technicalMetrics.inputTokenTotal)}</div>
                </div>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.avgValue' })}
                  </div>
                  <div className={styles.metricValue}>{formatTokenValue(technicalMetrics.avgInputTokenTotal)}</div>
                </div>
              </div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricContent}>
                <div
                  className={styles.metricIcon}
                  style={{
                    background: 'var(--Colorful-Gradient-V--, linear-gradient(0deg, #52ACFF 0%, #725CFA 100%))',
                  }}
                >
                  <AntdIcon type="icon-a-Uploadshangchuan" style={{ fontSize: 18, color: '#fff' }} />
                </div>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.outputTokenTotal' })}
                  </div>
                  <div className={styles.metricValue}>{formatTokenValue(technicalMetrics.outputTokenTotal)}</div>
                </div>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.avgValue' })}
                  </div>
                  <div className={styles.metricValue}>{formatTokenValue(technicalMetrics.avgOutputTokenTotal)}</div>
                </div>
              </div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricContent}>
                <div
                  className={styles.metricIcon}
                  style={{
                    background: 'var(--Colorful-Gradient-V--, linear-gradient(0deg, #52ACFF 0%, #725CFA 100%))',
                  }}
                >
                  <AntdIcon type="icon-a-Application-oneyingyong3" style={{ fontSize: 18, color: '#fff' }} />
                </div>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.tokenPerSecondTotal' })}
                  </div>
                  <div className={styles.metricValue}>
                    {formatTokenValue(technicalMetrics.outputTokenPerSecondTotal)}
                  </div>
                </div>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.avgValue' })}
                  </div>
                  <div className={styles.metricValue}>
                    {formatTokenValue(technicalMetrics.avgOutPutTokenPerSecondTotal)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Spin>

        {/* 输入token消耗量/输出token消耗量/每秒token消耗量的折线图 */}
        <div className={styles.section}>
          <div className={styles.usageSection}>
            <div className={styles.chartsRow}>
              <div className={styles.chartCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.inputTokenTrend' })}
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <Spin spinning={technicalLoading}>
                    <div ref={inputTokenTrendRef} className={styles.chartContainer} />
                  </Spin>
                </div>
              </div>
              <div className={styles.chartCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.outputTokenTrend' })}
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <Spin spinning={technicalLoading}>
                    <div ref={outputTokenTrendRef} className={styles.chartContainer} />
                  </Spin>
                </div>
              </div>
              <div className={styles.chartCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {intl.formatMessage({ id: 'operation.technicalMetrics.tokenPerSecondTrend' })}
                  </div>
                </div>
                <div className={styles.cardBody}>
                  <Spin spinning={technicalLoading}>
                    <div ref={tokenPerSecondTrendRef} className={styles.chartContainer} />
                  </Spin>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 上传测试集弹窗 */}
      <UploadTestSetModal
        visible={uploadTestSetVisible}
        onCancel={() => setUploadTestSetVisible(false)}
        agentId={agentId}
        onOk={handleUploadTestSet}
      />

      {/* 测试集结果弹窗 */}
      <TestSetResultModal
        visible={testSetResultVisible}
        onCancel={() => setTestSetResultVisible(false)}
        agentId={agentId}
      />

      {/* 测试集失败原因弹窗 */}
      <TestSetFailReasonModal
        visible={testSetFailReasonVisible}
        onCancel={() => setTestSetFailReasonVisible(false)}
        failReason={testSetStatus.failReason}
      />
    </div>
  );
};

export default Operation;
