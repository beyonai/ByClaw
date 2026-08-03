package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.Date;
import java.util.List;

import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskListQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskStateDto;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskViewDto;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanRequireItemMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;

@ExtendWith(MockitoExtension.class)
class DevloopApplicationServiceTaskQueryTest {

    @Mock
    private ByaiSessionMapper byaiSessionMapper;

    @Mock
    private DevloopTaskStateReader taskStateReader;

    @Mock
    private LoginApplicationService loginApplicationService;

    @Mock
    private ScanRequireItemMapper scanRequireItemMapper;

    @Mock
    private ProjectRepoMapper projectRepoMapper;

    private DevloopApplicationService service;

    @BeforeEach
    void setUp() {
        CurrentUserHolder.clearLoginInfo();
        // 单元测试未加载 MyBatis 容器，初始化实体元数据后才能将 Lambda 条件转换为 SQL 字段。
        if (TableInfoHelper.getTableInfo(ByaiSession.class) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), ByaiSession.class);
        }
        service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "byaiSessionMapper", byaiSessionMapper);
        ReflectionTestUtils.setField(service, "taskStateReader", taskStateReader);
        ReflectionTestUtils.setField(service, "loginApplicationService", loginApplicationService);
        ReflectionTestUtils.setField(service, "scanRequireItemMapper", scanRequireItemMapper);
        ReflectionTestUtils.setField(service, "projectRepoMapper", projectRepoMapper);
    }

    @AfterEach
    void tearDown() {
        // 任务查询会读取线程级登录态，每个用例结束后清理，避免影响后续用例。
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    @SuppressWarnings({ "rawtypes", "unchecked" })
    void paginatesDatabaseBeforeReadingCurrentPageState() {
        ByaiSession session = new ByaiSession();
        session.setSessionId(123L);
        session.setProjectId(203L);
        session.setCreatorId(9L);
        session.setSessionName("任务状态查询");
        session.setCreateTime(new Date());

        Page<ByaiSession> sessionPage = new Page<>(2, 20);
        sessionPage.setRecords(Collections.singletonList(session));
        sessionPage.setTotal(41);
        when(byaiSessionMapper.selectPage(any(Page.class), any())).thenReturn(sessionPage);
        when(scanRequireItemMapper.selectOne(any())).thenReturn(null);
        when(projectRepoMapper.selectList(any())).thenReturn(Collections.emptyList());

        LoginInfo owner = new LoginInfo();
        owner.setUserCode("owner-code");
        when(loginApplicationService.getLoginInfo(9L)).thenReturn(owner);
        DevloopTaskStateDto state = new DevloopTaskStateDto();
        state.setSchemaVersion("2.0.0");
        state.setSessionId("123");
        state.setTraceId("trace-123");
        state.setStatus("in_progress");
        when(taskStateReader.read("owner-code", 123L)).thenReturn(state);

        DevloopTaskListQueryDto query = new DevloopTaskListQueryDto();
        query.setProjectId(203L);
        query.setPageNum(2);
        query.setPageSize(20);

        ResponseUtil<PageInfo<DevloopTaskViewDto>> response = service.listTasks(query);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData().getPageNum()).isEqualTo(2);
        assertThat(response.getData().getPageSize()).isEqualTo(20);
        assertThat(response.getData().getTotal()).isEqualTo(41);
        assertThat(response.getData().getTotalPages()).isEqualTo(3);
        assertThat(response.getData().getList()).singleElement().satisfies(task -> {
            assertThat(task.getSessionId()).isEqualTo(123L);
            assertThat(task.getStateAvailable()).isTrue();
            assertThat(task.getTraceId()).isEqualTo("trace-123");
        });
        verify(taskStateReader).read("owner-code", 123L);
    }

    @Test
    void countsOnlyNonCompletedOrUnavailableProjectionAsRunning() {
        ByaiSession completed = taskSession(1L, 9L);
        ByaiSession paused = taskSession(2L, 9L);
        ByaiSession unavailable = taskSession(3L, 9L);
        when(byaiSessionMapper.selectList(any())).thenReturn(List.of(completed, paused, unavailable));

        LoginInfo owner = new LoginInfo();
        owner.setUserCode("owner-code");
        when(loginApplicationService.getLoginInfo(anyLong())).thenReturn(owner);

        DevloopTaskStateDto completedState = new DevloopTaskStateDto();
        completedState.setStatus("completed");
        when(taskStateReader.read("owner-code", 1L)).thenReturn(completedState);

        DevloopTaskStateDto pausedState = new DevloopTaskStateDto();
        pausedState.setStatus("paused");
        when(taskStateReader.read("owner-code", 2L)).thenReturn(pausedState);
        when(taskStateReader.read("owner-code", 3L)).thenThrow(new IllegalStateException("projection missing"));

        Integer running = ReflectionTestUtils.invokeMethod(service, "countRunningTasksByAgent", 203L, 88L);

        assertThat(running).isEqualTo(2);
    }

    @Test
    void returnsEmptyTaskStateWhenProjectionIsNotAvailableYet() {
        ByaiSession session = taskSession(123L, 9L);
        when(byaiSessionMapper.selectById(123L)).thenReturn(session);

        LoginInfo owner = new LoginInfo();
        owner.setUserCode("owner-code");
        when(loginApplicationService.getLoginInfo(9L)).thenReturn(owner);
        when(taskStateReader.read("owner-code", 123L))
            .thenThrow(new IllegalStateException("projection missing"));

        ResponseUtil<DevloopTaskStateDto> response = service.getTaskPhases(123L);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).isNull();
    }

    @Test
    @SuppressWarnings({ "rawtypes", "unchecked" })
    void filtersTasksByCurrentCreatorWhenOnlyMineIsEnabled() {
        LoginInfo currentUser = new LoginInfo();
        currentUser.setUserId(1001L);
        CurrentUserHolder.setLoginInfo(currentUser);
        when(byaiSessionMapper.selectPage(any(Page.class), any())).thenReturn(new Page<ByaiSession>(1, 20));

        DevloopTaskListQueryDto query = new DevloopTaskListQueryDto();
        query.setProjectId(203L);
        query.setOnlyMine(true);

        ResponseUtil<PageInfo<DevloopTaskViewDto>> response = service.listTasks(query);

        ArgumentCaptor<LambdaQueryWrapper<ByaiSession>> wrapperCaptor =
            ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(byaiSessionMapper).selectPage(any(Page.class), wrapperCaptor.capture());
        assertThat(response.isSuccess()).isTrue();
        // MyBatis-Plus 在生成 SQL 片段时才展开 Lambda 条件参数，先触发序列化后再核对创建人过滤值。
        LambdaQueryWrapper<ByaiSession> wrapper = wrapperCaptor.getValue();
        assertThat(wrapper.getSqlSegment()).contains("creator_id");
        assertThat(wrapper.getParamNameValuePairs()).containsValue(1001L);
    }

    @Test
    @SuppressWarnings({ "rawtypes", "unchecked" })
    void keepsAllProjectTasksWhenOnlyMineIsDisabled() {
        LoginInfo currentUser = new LoginInfo();
        currentUser.setUserId(1001L);
        CurrentUserHolder.setLoginInfo(currentUser);
        when(byaiSessionMapper.selectPage(any(Page.class), any())).thenReturn(new Page<ByaiSession>(1, 20));

        DevloopTaskListQueryDto query = new DevloopTaskListQueryDto();
        query.setProjectId(203L);
        query.setOnlyMine(false);

        ResponseUtil<PageInfo<DevloopTaskViewDto>> response = service.listTasks(query);

        ArgumentCaptor<LambdaQueryWrapper<ByaiSession>> wrapperCaptor =
            ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(byaiSessionMapper).selectPage(any(Page.class), wrapperCaptor.capture());
        assertThat(response.isSuccess()).isTrue();
        // 同样先生成 SQL，确保断言检查的是实际会传给 Mapper 的参数集合。
        LambdaQueryWrapper<ByaiSession> wrapper = wrapperCaptor.getValue();
        assertThat(wrapper.getSqlSegment()).doesNotContain("creator_id");
        assertThat(wrapper.getParamNameValuePairs()).doesNotContainValue(1001L);
    }

    private ByaiSession taskSession(Long sessionId, Long creatorId) {
        ByaiSession session = new ByaiSession();
        session.setSessionId(sessionId);
        session.setCreatorId(creatorId);
        return session;
    }
}
