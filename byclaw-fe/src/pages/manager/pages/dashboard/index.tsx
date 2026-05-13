// @ts-nocheck
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Segmented, DatePicker, Table, Avatar, Pagination, Rate, Spin } from 'antd';
import { history, useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import weekday from 'dayjs/plugin/weekday';
import localeData from 'dayjs/plugin/localeData';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import * as echarts from 'echarts';
import Ellipsis from '@/pages/manager/components/Ellipsis';
import { getAvatarUrl, getAgentChatAvatar } from '@/pages/manager/utils/agent';
import star from '@/pages/manager/assets/star.svg';
import styles from './index.module.less';
import number1 from '@/pages/manager/assets/number1.svg';
import number2 from '@/pages/manager/assets/number2.svg';
import number3 from '@/pages/manager/assets/number3.svg';
import currentServiceCnt from '@/pages/manager/assets/currentServiceCnt.svg';
import currentLoginUser from '@/pages/manager/assets/currentLoginUser.svg';
import currentAgentActivityRate from '@/pages/manager/assets/currentAgentActivityRate.svg';
import currentShelfAgent from '@/pages/manager/assets/currentShelfAgent.svg';
import { getDashboardConfigList, queryDashboardData } from '@/pages/manager/service/dashboard';

// 扩展 dayjs 插件
dayjs.extend(weekday);
dayjs.extend(localeData);
dayjs.extend(weekOfYear);

const Dashboard = () => {
  const intl = useIntl();
  const showNormativeAnalysis = false;
  const [activeTab, setActiveTab] = useState('week');
  const [selectedDate, setSelectedDate] = useState(dayjs()); // 默认当前日期（本月）
  const [selectedWeek, setSelectedWeek] = useState(dayjs()); // 默认当前日期（本周）
  const [employeeRankTab, setEmployeeRankTab] = useState('DIG_EMPLOYEE_SERVICE_TOP');
  const [activityRankTab, setActivityRankTab] = useState('ACTIVITY_TOP_ORG_LEVEL4');
  const [normativePage, setNormativePage] = useState(1);
  const [normativePageSize] = useState(10);
  const [employeeRankData, setEmployeeRankData] = useState([]); // 数字员工榜单数据
  const [activityRankData, setActivityRankData] = useState([]); // 活跃度榜单数据
  const [employeeTrendData, setEmployeeTrendData] = useState([]); // 数字员工趋势数据
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_userTrendData, setUserTrendData] = useState([]); // 用户趋势数据
  const [normativeData, setNormativeData] = useState([]); // 规范校验质量明细数据
  const [normativeTotal, setNormativeTotal] = useState(0); // 规范校验质量明细总数
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_configList, setConfigList] = useState([]); // 看板配置列表

  // 独立的 loading 状态
  const [metricsLoading, setMetricsLoading] = useState(false); // 关键指标加载状态
  const [employeeRankLoading, setEmployeeRankLoading] = useState(false); // 数字员工榜单加载状态
  const [employeeTrendLoading, setEmployeeTrendLoading] = useState(false); // 数字员工趋势加载状态
  const [userTrendLoading, setUserTrendLoading] = useState(false); // 用户趋势加载状态
  const [activityRankLoading, setActivityRankLoading] = useState(false); // 活跃度榜单加载状态
  const [normativeLoading, setNormativeLoading] = useState(false); // 规范校验质量明细加载状态
  // 关键指标数据 - 使用 useMemo 根据国际化动态生成
  const initialMetricsData = useMemo(
    () => [
      {
        title: intl.formatMessage({ id: 'dashboard.metric.shelfAgent' }),
        value: '0',
        unit: intl.formatMessage({ id: 'dashboard.unit.count' }),
        trend: 0,
        trendType: 'up',
        icon: 'purple',
      },
      {
        title: intl.formatMessage({ id: 'dashboard.metric.activityRate' }),
        value: '0',
        unit: intl.formatMessage({ id: 'dashboard.unit.percent' }),
        trend: 0,
        trendType: 'up',
        icon: 'purple',
      },
      {
        title: intl.formatMessage({ id: 'dashboard.metric.loginUser' }),
        value: '0',
        unit: intl.formatMessage({ id: 'dashboard.unit.count' }),
        trend: 0,
        trendType: 'up',
        icon: 'blue',
      },
      {
        title: intl.formatMessage({ id: 'dashboard.metric.serviceCount' }),
        value: '0',
        unit: intl.formatMessage({ id: 'dashboard.unit.times' }),
        trend: 0,
        trendType: 'up',
        icon: 'orange',
      },
    ],
    [intl]
  );
  const [metricsData, setMetricsData] = useState(initialMetricsData);

  const employeeTrendRef = useRef(null);
  const userTrendRef = useRef(null);
  const employeeChartRef = useRef(null); // 数字员工趋势图实例
  const userChartRef = useRef(null); // 用户趋势图实例

  // 获取看板配置列表
  useEffect(() => {
    const fetchDashboardConfig = async () => {
      try {
        const response = await getDashboardConfigList();
        if (response?.success && response?.data && Array.isArray(response.data)) {
          setConfigList(response.data);
        } else if (response?.data && Array.isArray(response.data)) {
          // 兼容可能的其他返回结构
          setConfigList(response.data);
        }
      } catch (error) {
        console.error('获取看板配置列表失败:', error);
      }
    };
    fetchDashboardConfig();
  }, []);

  // 计算时间范围

  const getTimeRange = useMemo(() => {
    let startTime;
    let endTime;
    let periodType;

    if (activeTab === 'week') {
      // 周分析：获取选中周的开始和结束日期
      const weekStart = selectedWeek.startOf('week');
      const weekEnd = selectedWeek.endOf('week');
      startTime = weekStart.format('YYYY-MM-DD');
      endTime = weekEnd.format('YYYY-MM-DD');
      periodType = 'week';
    } else if (activeTab === 'month') {
      // 月分析：获取选中月的开始和结束日期
      const monthStart = selectedDate.startOf('month');
      const monthEnd = selectedDate.endOf('month');
      startTime = monthStart.format('YYYY-MM-DD');
      endTime = monthEnd.format('YYYY-MM-DD');
      periodType = 'month';
    } else {
      // 日分析（如果后续需要）
      startTime = selectedDate.format('YYYY-MM-DD');
      endTime = selectedDate.format('YYYY-MM-DD');
      periodType = 'day';
    }

    return { startTime, endTime, periodType };
  }, [activeTab, selectedWeek, selectedDate]);

  // 获取关键指标数据
  const fetchMetricsData = useCallback(async () => {
    try {
      setMetricsLoading(true);
      const { periodType, startTime, endTime } = getTimeRange;
      const response = await queryDashboardData({
        queryCode: 'INDEX_TAB',
        params: {
          periodType,
          startTime,
          endTime,
        },
      });

      // 处理返回数据，更新关键指标
      if (response?.success && response?.data) {
        const data = response.data?.list[0];
        // 根据配置，返回的数据应该包含以下字段：
        // current_shelf_agent, shelf_agent_growth_rate (数字员工已上架总数)
        // current_agent_activity_rate, activity_rate_growth (数字员工活跃度)
        // current_login_user, login_user_growth_rate (上线用户)
        // current_service_cnt, service_cnt_growth_rate (数字员工服务总次数)

        setMetricsData([
          {
            title: intl.formatMessage({ id: 'dashboard.metric.shelfAgent' }),
            value: data.current_shelf_agent?.toString() || '0',
            unit: intl.formatMessage({ id: 'dashboard.unit.count' }),
            trend: Math.abs(data.shelf_agent_growth_rate || 0),
            trendType: (data.shelf_agent_growth_rate || 0) >= 0 ? 'up' : 'down',
            icon: 'purple',
          },
          {
            title: intl.formatMessage({ id: 'dashboard.metric.activityRate' }),
            value: data.current_agent_activity_rate?.toString() || '0',
            unit: intl.formatMessage({ id: 'dashboard.unit.percent' }),
            trend: Math.abs(data.activity_rate_growth || 0),
            trendType: (data.activity_rate_growth || 0) >= 0 ? 'up' : 'down',
            icon: 'purple',
          },
          {
            title: intl.formatMessage({ id: 'dashboard.metric.loginUser' }),
            value: data.current_login_user?.toString() || '0',
            unit: intl.formatMessage({ id: 'dashboard.unit.count' }),
            trend: Math.abs(data.login_user_growth_rate || 0),
            trendType: (data.login_user_growth_rate || 0) >= 0 ? 'up' : 'down',
            icon: 'blue',
          },
          {
            title: intl.formatMessage({ id: 'dashboard.metric.serviceCount' }),
            value: data.current_service_cnt?.toString() || '0',
            unit: intl.formatMessage({ id: 'dashboard.unit.times' }),
            trend: Math.abs(data.service_cnt_growth_rate || 0),
            trendType: (data.service_cnt_growth_rate || 0) >= 0 ? 'up' : 'down',
            icon: 'orange',
          },
        ]);
      }
    } catch (error) {
      console.error('获取关键指标数据失败:', error);
    } finally {
      setMetricsLoading(false);
    }
  }, [getTimeRange]);
  // 获取数字员工榜单数据
  const fetchEmployeeRankData = useCallback(async () => {
    try {
      setEmployeeRankLoading(true);
      const timeRange = getTimeRange;
      const response = await queryDashboardData({
        queryCode: employeeRankTab,
        params: {
          periodType: timeRange.periodType,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
        },
      });

      // 处理返回数据，转换为表格需要的格式
      if (response?.success && response?.data) {
        const data = Array.isArray(response.data?.list) ? response.data?.list : [];
        // 根据接口返回的数据结构进行转换
        const formattedData = data.map((item, index) => {
          // 根据 resource_name 设置默认 avatar
          const getDefaultAvatar = (resourceName) => {
            if (!resourceName) return '';
            const nameMap = {
              慧笔: 'beyond/avatar/headWrite.png',
              问数: 'beyond/avatar/headChatBI.png',
              鲸灵: 'beyond/avatar/headVideo.png',
            };
            return nameMap[resourceName] || '';
          };

          const baseData = {
            rank: index + 1,
            name: item.resource_name || '',
            trend: item.growth_rate || undefined,
            trendType: (item.growth_rate || 0) >= 0 ? 'up' : 'down',
            avatar: getDefaultAvatar(item.resource_name) || item.avatar || '',
            resourceId: item.resource_id || item.resourceId || '',
          };

          if (employeeRankTab === 'DIG_EMPLOYEE_QUALITY') {
            // 服务质量数据
            return {
              ...baseData,
              quality: item.target_quality || item.quality || 0,
            };
          } else {
            // 服务次数或订阅总数数据
            const count = item.current_service_count || item.focus_count || 0;
            // 计算最大值用于进度条显示
            const maxCount = 10 ** Math.abs(data[0].current_service_count || data[0].focus_count).toString().length;
            return {
              ...baseData,
              count,
              maxCount,
            };
          }
        });
        setEmployeeRankData(formattedData);
      }
    } catch (error) {
      console.error('获取数字员工榜单数据失败:', error);
    } finally {
      setEmployeeRankLoading(false);
    }
  }, [employeeRankTab, getTimeRange]);

  // 获取数字员工趋势数据
  const fetchEmployeeTrendData = useCallback(async () => {
    try {
      setEmployeeTrendLoading(true);
      const { startTime, endTime } = getTimeRange;
      const response = await queryDashboardData({
        queryCode: 'DIG_EMPLOYEE_TREND_STATISTICS',
        params: {
          startTime,
          endTime,
        },
      });

      // 处理返回数据
      if (response?.success && response?.data) {
        const data = Array.isArray(response.data?.list) ? response.data?.list : [];
        // 根据配置，返回的数据应该包含 stat_date, chat_cnt, activity 字段
        const formattedData = data.map((item) => ({
          date: item.stat_date || '',
          chatCnt: item.chat_cnt || 0,
          activity: item.activity || 0,
        }));
        setEmployeeTrendData(formattedData);

        // 更新图表
        if (employeeChartRef.current) {
          const dates = formattedData.map((item) => item.date);
          const chatCnts = formattedData.map((item) => item.chatCnt);
          const activities = formattedData.map((item) => item.activity);

          // 计算最大值用于设置 yAxis 范围
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _maxChatCnt = Math.max(...chatCnts, 1);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _maxActivity = Math.max(...activities, 1);

          employeeChartRef.current.setOption({
            tooltip: {
              formatter: (params) => {
                // 获取当前 hover 的日期
                const dateIndex = params[0]?.dataIndex;
                const date = dateIndex !== undefined && formattedData[dateIndex] ? formattedData[dateIndex].date : '';
                let result = date ? `${date}<br/>` : '';
                params.forEach((param) => {
                  const serviceCountLabel = intl.formatMessage({ id: 'dashboard.chart.series.serviceCount' });
                  const activityRateLabel = intl.formatMessage({ id: 'dashboard.chart.series.activityRate' });
                  if (param.seriesName === serviceCountLabel) {
                    result += `${param.seriesName}: ${param.value}<br/>`;
                  } else if (param.seriesName === activityRateLabel) {
                    result += `${param.seriesName}: ${param.value}%<br/>`;
                  } else {
                    result += `${param.seriesName}: ${param.value}<br/>`;
                  }
                });
                return result;
              },
            },
            xAxis: {
              data: dates,
            },
            yAxis: [],
            series: [
              {
                name: intl.formatMessage({ id: 'dashboard.chart.series.serviceCount' }),
                data: chatCnts,
                smooth: false,
                lineStyle: {
                  color: '#1CE4E4',
                  width: 2,
                },
                itemStyle: {
                  color: '#1CE4E4',
                },
                areaStyle: {
                  color: {
                    type: 'linear',
                    x: 0,
                    y: 0,
                    x2: 0,
                    y2: 1,
                    colorStops: [
                      { offset: 0.2037, color: '#ADF0FF' },
                      { offset: 1, color: 'rgba(243, 252, 255, 0.078)' },
                    ],
                  },
                },
              },
              {
                name: intl.formatMessage({ id: 'dashboard.chart.series.activityRate' }),
                data: activities,
                smooth: false,
                lineStyle: {
                  color: '#126DFF',
                  width: 2,
                },
                itemStyle: {
                  color: '#126DFF',
                },
                areaStyle: {
                  color: {
                    type: 'linear',
                    x: 0,
                    y: 0,
                    x2: 0,
                    y2: 1,
                    colorStops: [
                      { offset: 0.3075, color: '#D1E2FF' },
                      { offset: 0.9664, color: 'rgba(248, 251, 255, 0.078)' },
                    ],
                  },
                },
              },
            ],
          });
        }
      }
    } catch (error) {
      console.error('获取数字员工趋势数据失败:', error);
    } finally {
      setEmployeeTrendLoading(false);
    }
  }, [getTimeRange, intl]);

  // 获取用户趋势数据
  const fetchUserTrendData = useCallback(async () => {
    try {
      setUserTrendLoading(true);
      const { startTime, endTime } = getTimeRange;
      const response = await queryDashboardData({
        queryCode: 'USER_STATICS',
        params: {
          startTime,
          endTime,
        },
      });

      // 处理返回数据
      if (response?.success && response?.data) {
        const data = Array.isArray(response.data?.list) ? response.data?.list : [];
        // 根据配置，返回的数据应该包含 time, login_count, chat_count 字段
        const formattedData = data.map((item) => ({
          time: item.time || '',
          loginCount: item.login_count || 0,
          chatCount: item.chat_count || 0,
        }));
        setUserTrendData(formattedData);

        // 更新图表
        if (userChartRef.current) {
          const times = formattedData.map((item) => item.time);
          const loginCounts = formattedData.map((item) => item.loginCount);
          const chatCounts = formattedData.map((item) => item.chatCount);

          // 计算最大值用于设置 yAxis 范围
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _maxValue = Math.max(...loginCounts, ...chatCounts, 1);

          userChartRef.current.setOption({
            tooltip: {
              formatter: (params) => {
                // 获取当前 hover 的时间
                const timeIndex = params[0]?.dataIndex;
                const time = timeIndex !== undefined && formattedData[timeIndex] ? formattedData[timeIndex].time : '';
                let result = time ? `${time}<br/>` : '';
                params.forEach((param) => {
                  result += `${param.seriesName}: ${param.value}<br/>`;
                });
                return result;
              },
            },
            xAxis: {
              data: times,
            },
            yAxis: {},
            series: [
              {
                name: intl.formatMessage({ id: 'dashboard.chart.series.loginUser' }),
                data: loginCounts,
                smooth: false,
                lineStyle: {
                  color: '#1CE4E4',
                  width: 2,
                },
                itemStyle: {
                  color: '#1CE4E4',
                },
                areaStyle: {
                  color: {
                    type: 'linear',
                    x: 0,
                    y: 0,
                    x2: 0,
                    y2: 1,
                    colorStops: [
                      { offset: 0.2037, color: '#ADF0FF' },
                      { offset: 1, color: 'rgba(243, 252, 255, 0.078)' },
                    ],
                  },
                },
              },
              {
                name: intl.formatMessage({ id: 'dashboard.chart.series.totalConversation' }),
                data: chatCounts,
                smooth: false,
                lineStyle: {
                  color: '#126DFF',
                  width: 2,
                },
                itemStyle: {
                  color: '#126DFF',
                },
                areaStyle: {
                  color: {
                    type: 'linear',
                    x: 0,
                    y: 0,
                    x2: 0,
                    y2: 1,
                    colorStops: [
                      { offset: 0.3075, color: '#D1E2FF' },
                      { offset: 0.9664, color: 'rgba(248, 251, 255, 0.078)' },
                    ],
                  },
                },
              },
            ],
          });
        }
      }
    } catch (error) {
      console.error('获取用户趋势数据失败:', error);
    } finally {
      setUserTrendLoading(false);
    }
  }, [getTimeRange]);

  // 获取规范校验质量明细数据
  const fetchNormativeData = useCallback(async () => {
    try {
      setNormativeLoading(true);
      const response = await queryDashboardData({
        queryCode: 'DIG_EMPLOYEE_QUALITY_DETAIL',
        params: {
          pageIndex: normativePage,
          pageSize: normativePageSize,
        },
      });

      // 处理返回数据，转换为表格需要的格式
      if (response?.success && response?.data) {
        const data = Array.isArray(response.data?.list) ? response.data?.list : [];
        // 根据配置，返回的数据应该包含 resource_name, user_name, score, desc 字段
        const formattedData = data.map((item, index) => ({
          id: (normativePage - 1) * normativePageSize + index + 1,
          name: item.resource_name || '',
          creator: item.user_name || '',
          manager: item.man_user_name || '--', // 如果没有管理员字段，使用创建人
          score: item.score || 0,
          reason: item.desc || '',
          avatar: item.avatar || '',
        }));
        setNormativeData(formattedData);

        // 设置总数
        if (response.data?.total !== undefined) {
          setNormativeTotal(response.data.total);
        } else if (response.data?.totalCount !== undefined) {
          setNormativeTotal(response.data.totalCount);
        } else {
          // 如果没有总数，使用当前数据长度
          setNormativeTotal(formattedData.length);
        }
      }
    } catch (error) {
      console.error('获取规范校验质量明细数据失败:', error);
    } finally {
      setNormativeLoading(false);
    }
  }, [normativePage, normativePageSize]);

  // 获取活跃度榜单数据
  const fetchActivityRankData = useCallback(async () => {
    try {
      setActivityRankLoading(true);
      const timeRange = getTimeRange;
      const response = await queryDashboardData({
        queryCode: activityRankTab,
        params: {
          periodType: timeRange.periodType,
          startTime: timeRange.startTime,
          endTime: timeRange.endTime,
        },
      });

      // 处理返回数据，转换为表格需要的格式
      if (response?.success && response?.data) {
        const data = Array.isArray(response.data?.list) ? response.data?.list : [];
        //根据不同的 queryCode 处理不同的数据结构
        const formattedData = data.map((item, index) => {
          return {
            rank: index + 1,
            orgName: item.four_level_org_name || item.three_level_org_name || item.user_name || '',
            users: item.current_active_user_cnt || item.current_chat_cnt || 0,
            conversations: item.current_total_chat_cnt || item.current_chat_cnt || 0,
            trend: item.active_user_growth_rate || item.growth_rate || undefined,
            trendType: (item.active_user_growth_rate || item.growth_rate || 0) >= 0 ? 'up' : 'down',
            avatar: item.avatar || '',
          };
        });
        setActivityRankData(formattedData);
      }
    } catch (error) {
      console.error('获取活跃度榜单数据失败:', error);
    } finally {
      setActivityRankLoading(false);
    }
  }, [activityRankTab, getTimeRange]);

  // 当时间范围或选中的tab变化时，重新获取数据
  useEffect(() => {
    if (getTimeRange.startTime && getTimeRange.endTime) {
      fetchEmployeeRankData();
    }
  }, [fetchEmployeeRankData, getTimeRange]);
  useEffect(() => {
    if (getTimeRange.startTime && getTimeRange.endTime) {
      fetchEmployeeTrendData();
    }
  }, [fetchEmployeeTrendData, getTimeRange]);
  useEffect(() => {
    if (getTimeRange.startTime && getTimeRange.endTime) {
      fetchUserTrendData();
    }
  }, [fetchUserTrendData, getTimeRange]);
  useEffect(() => {
    if (getTimeRange.startTime && getTimeRange.endTime) {
      fetchMetricsData();
    }
  }, [fetchMetricsData, getTimeRange]);
  useEffect(() => {
    if (getTimeRange.startTime && getTimeRange.endTime) {
      fetchActivityRankData();
    }
  }, [fetchActivityRankData, getTimeRange]);

  // 当分页变化时，重新获取规范校验质量明细数据
  useEffect(() => {
    fetchNormativeData();
  }, [fetchNormativeData]);

  // 初始化图表
  useEffect(() => {
    let employeeChart = null;
    let userChart = null;

    if (echarts) {
      // 数字员工趋势图
      if (employeeTrendRef.current) {
        employeeChart = echarts.init(employeeTrendRef.current);
        employeeChartRef.current = employeeChart; // 保存图表实例
        const employeeOption = {
          tooltip: {
            trigger: 'axis',
            axisPointer: {
              type: 'cross',
            },
            formatter: (params) => {
              // 获取当前 hover 的日期
              const dateIndex = params[0]?.dataIndex;
              const date =
                dateIndex !== undefined && employeeTrendData[dateIndex] ? employeeTrendData[dateIndex].date : '';
              let result = date ? `${date}<br/>` : '';
              const serviceCountLabel = intl.formatMessage({ id: 'dashboard.chart.series.serviceCount' });
              const activityRateLabel = intl.formatMessage({ id: 'dashboard.chart.series.activityRate' });
              params.forEach((param) => {
                if (param.seriesName === serviceCountLabel) {
                  result += `${param.seriesName}: ${param.value}<br/>`;
                } else if (param.seriesName === activityRateLabel) {
                  result += `${param.seriesName}: ${param.value}%<br/>`;
                } else {
                  result += `${param.seriesName}: ${param.value}<br/>`;
                }
              });
              return result;
            },
          },
          legend: {
            data: [
              intl.formatMessage({ id: 'dashboard.chart.series.serviceCount' }),
              intl.formatMessage({ id: 'dashboard.chart.series.activityRate' }),
            ],
            top: 0,
            right: 20,
            textStyle: {
              color: '#191D23', // 字体颜色
              fontSize: 12, // 字体大小
            },
          },
          grid: {
            left: '3%',
            right: '4%',
            bottom: '3%',
            top: '15%',
            containLabel: true,
          },
          xAxis: {
            type: 'category',
            boundaryGap: false,
            data: [],
            axisLine: {
              lineStyle: {
                color: '#e5e6eb',
              },
            },
            axisLabel: {
              color: '#86909c',
            },
          },
          yAxis: [
            {
              type: 'value',
              position: 'left',
              axisLine: {
                show: false,
                lineStyle: {
                  color: '#1CE4E4',
                },
              },
              axisTick: {
                show: false,
              },
              axisLabel: {
                formatter: '{value}',
                color: '#86909c',
              },
              splitLine: {
                lineStyle: {
                  color: '#f0f0f0',
                },
              },
            },
            {
              type: 'value',
              min: 0,
              max: 100,
              position: 'right',
              axisLine: {
                show: false,
                lineStyle: {
                  color: '#126DFF',
                },
              },
              axisTick: {
                show: false,
              },
              axisLabel: {
                formatter: '{value}%',
                color: '#86909c',
              },
              splitLine: {
                show: false,
              },
            },
          ],
          series: [
            {
              name: intl.formatMessage({ id: 'dashboard.chart.series.serviceCount' }),
              type: 'line',
              yAxisIndex: 0,
              data: [],
              smooth: false,
              symbol: 'circle',
              symbolSize: 6,
              lineStyle: {
                color: '#1CE4E4',
                width: 2,
              },
              itemStyle: {
                color: '#1CE4E4',
              },
              areaStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0.2037, color: '#ADF0FF' },
                    { offset: 1, color: 'rgba(243, 252, 255, 0.078)' },
                  ],
                },
              },
            },
            {
              name: intl.formatMessage({ id: 'dashboard.chart.series.activityRate' }),
              type: 'line',
              yAxisIndex: 1,
              data: [],
              smooth: false,
              symbol: 'circle',
              symbolSize: 6,
              lineStyle: {
                color: '#126DFF',
                width: 2,
              },
              itemStyle: {
                color: '#126DFF',
              },
              areaStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0.3075, color: '#D1E2FF' },
                    { offset: 0.9664, color: 'rgba(248, 251, 255, 0.078)' },
                  ],
                },
              },
            },
          ],
        };
        employeeChart.setOption(employeeOption);
      }

      // 用户趋势图
      if (userTrendRef.current) {
        userChart = echarts.init(userTrendRef.current);
        userChartRef.current = userChart; // 保存图表实例
        const userOption = {
          tooltip: {
            trigger: 'axis',
            axisPointer: {
              type: 'cross',
            },
            formatter: (params) => {
              const date = params?.[0]?.axisValue || '';
              let result = `${date}<br/>`;
              params.forEach((param) => {
                result += `${param.seriesName} ${param.value}<br/>`;
              });
              return result;
            },
          },
          legend: {
            data: [
              intl.formatMessage({ id: 'dashboard.chart.series.loginUser' }),
              intl.formatMessage({ id: 'dashboard.chart.series.totalConversation' }),
            ],
            top: 0,
            right: 20,
          },
          grid: {
            left: '3%',
            right: '4%',
            bottom: '3%',
            top: '15%',
            containLabel: true,
          },
          xAxis: {
            type: 'category',
            boundaryGap: false,
            data: [],
            axisLine: {
              lineStyle: {
                color: '#e5e6eb',
              },
            },
            axisLabel: {
              color: '#86909c',
            },
          },
          yAxis: {
            type: 'value',
            axisLine: {
              show: false,
              lineStyle: {
                color: '#e5e6eb',
              },
            },
            axisLabel: {
              formatter: '{value}',
              color: '#86909c',
            },
            axisTick: {
              show: false,
            },
            splitLine: {
              lineStyle: {
                color: '#f0f0f0',
              },
            },
          },
          series: [
            {
              name: intl.formatMessage({ id: 'dashboard.chart.series.loginUser' }),
              type: 'line',
              data: [],
              smooth: false,
              symbol: 'circle',
              symbolSize: 6,
              lineStyle: {
                color: '#1CE4E4',
                width: 2,
              },
              itemStyle: {
                color: '#1CE4E4',
              },
              areaStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0.2037, color: '#ADF0FF' },
                    { offset: 1, color: 'rgba(243, 252, 255, 0.078)' },
                  ],
                },
              },
            },
            {
              name: intl.formatMessage({ id: 'dashboard.chart.series.totalConversation' }),
              type: 'line',
              data: [],
              smooth: false,
              symbol: 'circle',
              symbolSize: 6,
              lineStyle: {
                color: '#126DFF',
                width: 2,
              },
              itemStyle: {
                color: '#126DFF',
              },
              areaStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0.3075, color: '#D1E2FF' },
                    { offset: 0.9664, color: 'rgba(248, 251, 255, 0.078)' },
                  ],
                },
              },
            },
          ],
        };
        userChart.setOption(userOption);
      }

      // 响应式调整
      const handleResize = () => {
        if (employeeChart) employeeChart.resize();
        if (userChart) userChart.resize();
      };
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        if (employeeChart) employeeChart.dispose();
        if (userChart) userChart.dispose();
      };
    }
  }, [activeTab, intl]);

  // 数字员工榜单表格列（根据选中的tab动态生成）
  const employeeColumns = useMemo(() => {
    const columns = [
      {
        title: intl.formatMessage({ id: 'dashboard.table.rank' }),
        dataIndex: 'rank',
        key: 'rank',
        width: 80,
        render: (rank) => {
          if (rank === 1) {
            return <img src={number1} alt="1" className={styles.rankImage} />;
          } else if (rank === 2) {
            return <img src={number2} alt="2" className={styles.rankImage} />;
          } else if (rank === 3) {
            return <img src={number3} alt="3" className={styles.rankImage} />;
          }
          return <span className={styles.rankNumber}>{rank}</span>;
        },
      },
      {
        title: intl.formatMessage({ id: 'dashboard.table.employeeName' }),
        dataIndex: 'name',
        key: 'name',
        render: (name, record) => (
          <div
            className={styles.employeeCell}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              if (record.resourceId) {
                try {
                  sessionStorage.setItem(
                    'EmployeeDetail_prevRoute',
                    `${window.location.pathname}${window.location.search}`
                  );
                } catch (e) {}
                history.push(
                  `/manager/resource/employeeDetail?digitalType=FROM_MANUALLY&appId=${record.resourceId}&operation=true`
                );
              }
            }}
          >
            <Avatar size={24} src={getAgentChatAvatar(record.avatar)}></Avatar>
            <Ellipsis tooltip lines={1}>
              <span>{name}</span>
            </Ellipsis>
          </div>
        ),
      },
    ];

    // 根据选中的tab添加不同的列
    if (employeeRankTab === 'DIG_EMPLOYEE_QUALITY') {
      // 服务质量：显示 Rate 组件
      columns.push({
        title: intl.formatMessage({ id: 'dashboard.table.quality' }),
        dataIndex: 'quality',
        key: 'quality',
        render: (quality) => <Rate disabled style={{ fontSize: '14px' }} value={quality || 0} allowHalf count={5} />,
      });
    } else {
      // 服务次数或订阅总数：进度条和数值分开两列
      // 进度条列（无表头）
      columns.push({
        title: '',
        dataIndex: 'count',
        key: 'progress',
        width: 100,
        render: (count, record) => (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${(count / record.maxCount) * 100}%` }} />
          </div>
        ),
      });
      // 数值列（有表头）
      columns.push({
        title:
          employeeRankTab === 'DIG_EMPLOYEE_SERVICE_TOP'
            ? intl.formatMessage({ id: 'dashboard.table.serviceCount' })
            : intl.formatMessage({ id: 'dashboard.table.subscribeCount' }),
        dataIndex: 'count',
        key: 'count',
        render: (count, record) => (
          <span className={styles.countText}>
            {count}
            <span
              style={{ visibility: record.trend === undefined ? 'hidden' : 'visible' }}
              className={record.trendType === 'up' ? styles.trendUp : styles.trendDown}
            >
              {record.trend}%{record.trendType === 'up' ? '↑' : '↓'}
            </span>
          </span>
        ),
      });
    }

    return columns;
  }, [employeeRankTab, intl]);

  // 活跃度榜单表格列（根据选中的tab动态生成）
  const activityColumns = useMemo(() => {
    const columns = [
      {
        title: intl.formatMessage({ id: 'dashboard.table.rank' }),
        dataIndex: 'rank',
        key: 'rank',
        width: 80,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        render: (rank, _record, _index) => {
          if (rank === 1) {
            return <img src={number1} alt="1" className={styles.rankImage} />;
          } else if (rank === 2) {
            return <img src={number2} alt="2" className={styles.rankImage} />;
          } else if (rank === 3) {
            return <img src={number3} alt="3" className={styles.rankImage} />;
          }
          return <span className={styles.rankNumber}>{rank}</span>;
        },
      },
      {
        title:
          activityRankTab === 'ACTIVITY_TOP_USER'
            ? intl.formatMessage({ id: 'dashboard.table.userName' })
            : intl.formatMessage({ id: 'dashboard.table.orgName' }),
        dataIndex: 'orgName',
        key: 'orgName',
      },
    ];

    // 当选择"按员工"时，不显示"使用人数"列
    if (activityRankTab !== 'ACTIVITY_TOP_USER') {
      columns.push({
        title: intl.formatMessage({ id: 'dashboard.table.userCount' }),
        dataIndex: 'users',
        key: 'users',
        render: (users, record) => (
          <span>
            {users.toLocaleString()}{' '}
            <span
              style={{ display: record.trend === undefined ? 'none' : 'inline-block' }}
              className={record.trendType === 'up' ? styles.trendUp : styles.trendDown}
            >
              {record.trend}%{record.trendType === 'up' ? '↑' : '↓'}
            </span>
          </span>
        ),
      });
    }

    columns.push({
      title: intl.formatMessage({ id: 'dashboard.table.conversationCount' }),
      dataIndex: 'conversations',
      key: 'conversations',
      render: (conversations, record) => (
        <span>
          {conversations.toLocaleString()}
          {activityRankTab === 'ACTIVITY_TOP_USER' && (
            <span
              style={{ display: record.trend === undefined ? 'none' : 'inline-block' }}
              className={record.trendType === 'up' ? styles.trendUp : styles.trendDown}
            >
              {' '}
              {record.trend}%{record.trendType === 'up' ? '↑' : '↓'}
            </span>
          )}
        </span>
      ),
    });

    return columns;
  }, [activityRankTab, intl]);

  // 规范性分析表格列
  const normativeColumns = useMemo(
    () => [
      {
        title: intl.formatMessage({ id: 'dashboard.table.serialNumber' }),
        dataIndex: 'id',
        key: 'id',
        width: 80,
        render: (id, record, index) => (normativePage - 1) * normativePageSize + index + 1,
      },
      {
        title: intl.formatMessage({ id: 'dashboard.table.employeeName' }),
        dataIndex: 'name',
        key: 'name',
        render: (text, record) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img width={24} height={24} style={{ borderRadius: '24px' }} src={getAvatarUrl(record.avatar)} alt="logo" />
            <Ellipsis tooltip lines={1}>
              {text || '-'}
            </Ellipsis>
          </div>
        ),
      },
      {
        title: intl.formatMessage({ id: 'dashboard.table.creator' }),
        dataIndex: 'creator',
        key: 'creator',
        render: (text) => (
          <Ellipsis tooltip lines={1}>
            {text || '-'}
          </Ellipsis>
        ),
      },
      {
        title: intl.formatMessage({ id: 'dashboard.table.manager' }),
        dataIndex: 'manager',
        key: 'manager',
        render: (text) => (
          <Ellipsis tooltip lines={1}>
            {text || '-'}
          </Ellipsis>
        ),
      },
      {
        title: intl.formatMessage({ id: 'dashboard.table.qualityScore' }),
        dataIndex: 'score',
        key: 'score',
        render: (score) => (
          <div style={{ whiteSpace: 'nowrap' }}>
            <Rate disabled style={{ fontSize: '14px' }} value={parseFloat(score || '0') || 0} allowHalf count={5} />
          </div>
        ),
      },
      {
        title: intl.formatMessage({ id: 'dashboard.table.unqualifiedReason' }),
        dataIndex: 'reason',
        key: 'reason',
        render: (text) => (
          <Ellipsis tooltip lines={1}>
            {text || '-'}
          </Ellipsis>
        ),
      },
    ],
    [intl, normativePage, normativePageSize]
  );

  // 处理周选择变化
  const handleWeekChange = (date) => {
    if (date) {
      setSelectedWeek(date);
    }
  };

  return (
    <div className={styles.dashboard}>
      {/* 顶部标题和选项卡 */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>
            <img src={star} alt="star" className={styles.starIcon} />
            <div className={styles.titleText}>{intl.formatMessage({ id: 'dashboard.title' })}</div>
          </h1>
          <Segmented
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { label: intl.formatMessage({ id: 'dashboard.tab.week' }), value: 'week' },
              { label: intl.formatMessage({ id: 'dashboard.tab.month' }), value: 'month' },
            ]}
            className={styles.analysisTabs}
          />
          {activeTab === 'week' ? (
            <DatePicker
              value={selectedWeek}
              onChange={handleWeekChange}
              picker="week"
              allowClear={false}
              format={(value) => {
                if (!value) return '';
                const start = value.startOf('week');
                const end = value.endOf('week');
                const year = start.year(); // 或者用 value.year() 也可以
                return `${year}-${start.format('MM-DD')}~${end.format('MM-DD')}`;
              }}
              className={styles.datePicker}
            />
          ) : (
            <DatePicker
              value={selectedDate}
              allowClear={false}
              onChange={setSelectedDate}
              picker="month"
              format="YYYY-MM"
              className={styles.datePicker}
            />
          )}
        </div>
      </div>

      {/* 关键指标卡片 */}
      <Spin spinning={metricsLoading}>
        <div className={styles.metricsRow}>
          {metricsData.map((metric, index) => (
            <div key={index} className={styles.metricCard}>
              <div className={styles.metricContent}>
                <div className={styles.metricInfo}>
                  <div className={styles.metricTitle}>{metric.title}</div>
                  <div className={styles.metricValue}>
                    {metric.value} <span className={styles.metricUnit}>{metric.unit}</span>
                  </div>
                  <div className={styles.metricTrend}>
                    <span className={styles.metricTrendText}>
                      {intl.formatMessage({ id: 'dashboard.trend.compared' })}
                    </span>
                    <span className={metric.trendType === 'up' ? styles.trendUp : styles.trendDown}>
                      {metric.trend}%{metric.trendType === 'up' ? '↑' : '↓'}
                    </span>
                  </div>
                </div>
                <div className={styles.metricIcon} data-icon={metric.icon}>
                  {metric.title === intl.formatMessage({ id: 'dashboard.metric.shelfAgent' }) && (
                    <img src={currentShelfAgent} alt={intl.formatMessage({ id: 'dashboard.metric.shelfAgent' })} />
                  )}
                  {metric.title === intl.formatMessage({ id: 'dashboard.metric.activityRate' }) && (
                    <img
                      src={currentAgentActivityRate}
                      alt={intl.formatMessage({ id: 'dashboard.metric.activityRate' })}
                    />
                  )}
                  {metric.title === intl.formatMessage({ id: 'dashboard.metric.loginUser' }) && (
                    <img src={currentLoginUser} alt={intl.formatMessage({ id: 'dashboard.metric.loginUser' })} />
                  )}
                  {metric.title === intl.formatMessage({ id: 'dashboard.metric.serviceCount' }) && (
                    <img src={currentServiceCnt} alt={intl.formatMessage({ id: 'dashboard.metric.serviceCount' })} />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Spin>

      {/* 数字员工分析区域 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionTitleText}></span>
          {intl.formatMessage({ id: 'dashboard.section.employee' })}
        </div>
        <div className={styles.analysisSection}>
          <div className={styles.chartCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>{intl.formatMessage({ id: 'dashboard.chart.employeeTrend' })}</div>
            </div>
            <div className={styles.cardBody}>
              <Spin spinning={employeeTrendLoading}>
                <div ref={employeeTrendRef} className={styles.chartContainer} />
              </Spin>
            </div>
          </div>
          <div className={styles.rankCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>{intl.formatMessage({ id: 'dashboard.rank.employeeTop10' })}</div>
              <Segmented
                value={employeeRankTab}
                onChange={setEmployeeRankTab}
                size="middle"
                options={[
                  {
                    label: intl.formatMessage({ id: 'dashboard.rank.byServiceCount' }),
                    value: 'DIG_EMPLOYEE_SERVICE_TOP',
                  },
                  { label: intl.formatMessage({ id: 'dashboard.rank.byQuality' }), value: 'DIG_EMPLOYEE_QUALITY' },
                  {
                    label: intl.formatMessage({ id: 'dashboard.rank.bySubscribe' }),
                    value: 'DIG_EMPLOYEE_SUBSCRIBE_TOP',
                  },
                ]}
                className={styles.rankTabs}
              />
            </div>
            <div className={styles.cardBody}>
              <Table
                columns={employeeColumns}
                dataSource={employeeRankData}
                pagination={false}
                rowKey="rank"
                className={styles.rankTable}
                loading={employeeRankLoading}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 用户使用分析区域 */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionTitleText}></span>
          {intl.formatMessage({ id: 'dashboard.section.user' })}
        </div>
        <div className={styles.analysisSection}>
          <div className={styles.chartCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>{intl.formatMessage({ id: 'dashboard.chart.userTrend' })}</div>
            </div>
            <div className={styles.cardBody}>
              <Spin spinning={userTrendLoading}>
                <div ref={userTrendRef} className={styles.chartContainer} />
              </Spin>
            </div>
          </div>
          <div className={styles.rankCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>{intl.formatMessage({ id: 'dashboard.rank.activityTop10' })}</div>
              <Segmented
                value={activityRankTab}
                onChange={setActivityRankTab}
                size="middle"
                options={[
                  { label: intl.formatMessage({ id: 'dashboard.rank.byOrgLevel4' }), value: 'ACTIVITY_TOP_ORG_LEVEL4' },
                  { label: intl.formatMessage({ id: 'dashboard.rank.byOrgLevel3' }), value: 'ACTIVITY_TOP_ORG_LEVEL3' },
                  { label: intl.formatMessage({ id: 'dashboard.rank.byUser' }), value: 'ACTIVITY_TOP_USER' },
                ]}
                className={styles.rankTabs}
              />
            </div>
            <div className={styles.cardBody}>
              <Table
                columns={activityColumns}
                dataSource={activityRankData}
                pagination={false}
                rowKey="rank"
                className={styles.rankTable}
                loading={activityRankLoading}
              />
            </div>
          </div>
        </div>
      </div>

      {showNormativeAnalysis && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <span className={styles.sectionTitleText}></span>
            {intl.formatMessage({ id: 'dashboard.section.normative' })}
          </div>
          <div className={styles.normativeCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>{intl.formatMessage({ id: 'dashboard.table.normativeDetail' })}</div>
            </div>
            <div className={styles.cardBody}>
              <Table
                columns={normativeColumns}
                dataSource={normativeData}
                pagination={false}
                rowKey="id"
                className={styles.normativeTable}
                loading={normativeLoading}
              />
              <div className={styles.paginationWrapper}>
                <Pagination
                  current={normativePage}
                  pageSize={normativePageSize}
                  total={normativeTotal}
                  onChange={setNormativePage}
                  showSizeChanger={false}
                  showQuickJumper
                  showTotal={(total, range) =>
                    intl.formatMessage({ id: 'dashboard.pagination.total' }, { start: range[0], end: range[1], total })
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 背景渐变 */}
      <div className={styles.backgroundRadialGradients1}></div>
      <div className={styles.backgroundRadialGradients2}></div>
    </div>
  );
};

export default Dashboard;
