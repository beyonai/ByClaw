package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.service.IntegrationRunService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanItemTaskService;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskListQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskStateDto;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskViewDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ScanRequireItem;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanRequireItemMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
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

    @Mock
    private SsResourceMapper ssResourceMapper;

    @Mock
    private ProjectMapper projectMapper;

    @Mock
    private ScanItemTaskService scanItemTaskService;

    @Mock
    private IntegrationRunService integrationRunService;

    private DevloopApplicationService service;

    private MessageSource originalMessageSource;

    @BeforeEach
    void setUp() {
        CurrentUserHolder.clearLoginInfo();
        // I18nUtil 持有静态 MessageSource，参数校验经 failRes 走 I18nUtil.get，测试需注入并在结束后还原。
        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("devloop.task.type.invalid", Locale.US, "invalid task type");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.US);
        // 单元测试未加载 MyBatis 容器，初始化实体元数据后才能将 Lambda 条件转换为 SQL 字段。
        initTableInfo(ByaiSession.class);
        initTableInfo(ScanRequireItem.class);
        service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "byaiSessionMapper", byaiSessionMapper);
        ReflectionTestUtils.setField(service, "taskStateReader", taskStateReader);
        ReflectionTestUtils.setField(service, "loginApplicationService", loginApplicationService);
        ReflectionTestUtils.setField(service, "scanRequireItemMapper", scanRequireItemMapper);
        ReflectionTestUtils.setField(service, "projectRepoMapper", projectRepoMapper);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "projectMapper", projectMapper);
        ReflectionTestUtils.setField(service, "scanItemTaskService", scanItemTaskService);
        ReflectionTestUtils.setField(service, "integrationRunService", integrationRunService);
    }

    @AfterEach
    void tearDown() {
        // 任务查询会读取线程级登录态，每个用例结束后清理，避免影响后续用例。
        CurrentUserHolder.clearLoginInfo();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        LocaleContextHolder.resetLocaleContext();
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
        when(scanRequireItemMapper.selectList(any())).thenReturn(Collections.emptyList());
        when(projectRepoMapper.selectList(any())).thenReturn(Collections.emptyList());
        when(scanItemTaskService.filterSubtaskSessionIds(any())).thenReturn(Collections.emptySet());
        when(integrationRunService.filterTesterSessionIds(any())).thenReturn(Collections.emptySet());

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
    @SuppressWarnings({ "rawtypes", "unchecked" })
    void listsOnlyRootSessionsAndExcludesChildTasks() {
        Page<ByaiSession> page = new Page<>(1, 20);
        page.setRecords(Collections.emptyList());
        page.setTotal(0);
        when(byaiSessionMapper.selectPage(any(Page.class), any())).thenReturn(page);

        DevloopTaskListQueryDto query = new DevloopTaskListQueryDto();
        query.setProjectId(203L);

        service.listTasks(query);

        ArgumentCaptor<LambdaQueryWrapper<ByaiSession>> captor = ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(byaiSessionMapper).selectPage(any(Page.class), captor.capture());
        assertThat(captor.getValue().getSqlSegment()).contains("parent_session_id IS NULL");
    }

    @Test
    @SuppressWarnings({ "rawtypes", "unchecked" })
    void returnsSessionBoundAgentSoInputCanMentionEmployee() {
        ByaiSession session = new ByaiSession();
        session.setSessionId(321L);
        session.setProjectId(203L);
        session.setCreatorId(9L);
        session.setSessionName("绑定员工的任务");
        session.setCreateTime(new Date());
        session.setObjectType("DigEmployee");
        session.setObjectId(88L);

        Page<ByaiSession> sessionPage = new Page<>(1, 20);
        sessionPage.setRecords(Collections.singletonList(session));
        sessionPage.setTotal(1);
        when(byaiSessionMapper.selectPage(any(Page.class), any())).thenReturn(sessionPage);
        when(scanRequireItemMapper.selectList(any())).thenReturn(Collections.emptyList());
        when(projectRepoMapper.selectList(any())).thenReturn(Collections.emptyList());
        when(scanItemTaskService.filterSubtaskSessionIds(any())).thenReturn(Collections.emptySet());
        when(integrationRunService.filterTesterSessionIds(any())).thenReturn(Collections.emptySet());

        SsResource agentResource = new SsResource();
        agentResource.setResourceId(88L);
        agentResource.setResourceName("测试员工");
        agentResource.setAvatar("icon-agent");
        when(ssResourceMapper.selectByResourceId(88L)).thenReturn(agentResource);

        LoginInfo owner = new LoginInfo();
        owner.setUserCode("owner-code");
        when(loginApplicationService.getLoginInfo(9L)).thenReturn(owner);
        when(taskStateReader.read("owner-code", 321L)).thenReturn(null);

        DevloopTaskListQueryDto query = new DevloopTaskListQueryDto();
        query.setProjectId(203L);
        query.setPageNum(1);
        query.setPageSize(20);

        ResponseUtil<PageInfo<DevloopTaskViewDto>> response = service.listTasks(query);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData().getList()).singleElement().satisfies(task -> {
            // 前端靠这两个字段把默认 @ 员工回填进输入框，只回 agentName 不够。
            assertThat(task.getObjectType()).isEqualTo("DigEmployee");
            assertThat(task.getObjectId()).isEqualTo(88L);
            assertThat(task.getAgentName()).isEqualTo("测试员工");
        });
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

    @Test
    @SuppressWarnings({ "rawtypes", "unchecked" })
    void labelsTaskTypeFromCreationLinkageInsteadOfBoundAgent() {
        ByaiSession architect = taskSession(11L, 9L);
        ByaiSession coder = taskSession(12L, 9L);
        ByaiSession tester = taskSession(13L, 9L);
        ByaiSession requirement = taskSession(14L, 9L);
        ByaiSession chat = taskSession(15L, 9L);
        List<ByaiSession> sessions = List.of(architect, coder, tester, requirement, chat);
        sessions.forEach(session -> session.setProjectId(203L));

        Page<ByaiSession> sessionPage = new Page<>(1, 20);
        sessionPage.setRecords(sessions);
        sessionPage.setTotal(sessions.size());
        when(byaiSessionMapper.selectPage(any(Page.class), any())).thenReturn(sessionPage);

        Project project = new Project();
        project.setProjectId(203L);
        project.setInitSessionId(11L);
        when(projectMapper.selectById(203L)).thenReturn(project);
        // 拆解入口会把首个子任务会话同时回写到需求项，coder 与 requirement 两个判据都命中它。
        when(scanRequireItemMapper.selectList(any()))
            .thenReturn(List.of(requireItem(12L), requireItem(14L)));
        when(scanItemTaskService.filterSubtaskSessionIds(any())).thenReturn(Set.of(12L));
        when(integrationRunService.filterTesterSessionIds(any())).thenReturn(Set.of(13L));
        when(projectRepoMapper.selectList(any())).thenReturn(Collections.emptyList());

        LoginInfo owner = new LoginInfo();
        owner.setUserCode("owner-code");
        when(loginApplicationService.getLoginInfo(anyLong())).thenReturn(owner);

        DevloopTaskListQueryDto query = new DevloopTaskListQueryDto();
        query.setProjectId(203L);

        ResponseUtil<PageInfo<DevloopTaskViewDto>> response = service.listTasks(query);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData().getList())
            .extracting(DevloopTaskViewDto::getTaskId, DevloopTaskViewDto::getTaskType)
            .containsExactly(tuple(11L, "architect"), tuple(12L, "coder"), tuple(13L, "tester"),
                tuple(14L, "requirement"), tuple(15L, "chat"));
    }

    @Test
    void filtersByTaskTypeOverFullResultSetSoTotalStaysConsistent() {
        ByaiSession coder = taskSession(12L, 9L);
        ByaiSession chat = taskSession(15L, 9L);
        List.of(coder, chat).forEach(session -> session.setProjectId(203L));
        // 类型判据来自状态文件之外的关联行，仍需整表捞出后再内存分页，否则 total 会与过滤结果不一致。
        when(byaiSessionMapper.selectList(any())).thenReturn(List.of(coder, chat));

        Project project = new Project();
        project.setProjectId(203L);
        when(projectMapper.selectById(203L)).thenReturn(project);
        when(scanRequireItemMapper.selectList(any())).thenReturn(Collections.emptyList());
        when(scanItemTaskService.filterSubtaskSessionIds(any())).thenReturn(Set.of(12L));
        when(integrationRunService.filterTesterSessionIds(any())).thenReturn(Collections.emptySet());
        when(projectRepoMapper.selectList(any())).thenReturn(Collections.emptyList());

        LoginInfo owner = new LoginInfo();
        owner.setUserCode("owner-code");
        when(loginApplicationService.getLoginInfo(anyLong())).thenReturn(owner);

        DevloopTaskListQueryDto query = new DevloopTaskListQueryDto();
        query.setProjectId(203L);
        query.setTaskType("coder");

        ResponseUtil<PageInfo<DevloopTaskViewDto>> response = service.listTasks(query);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData().getTotal()).isEqualTo(1);
        assertThat(response.getData().getList()).singleElement()
            .satisfies(task -> assertThat(task.getTaskId()).isEqualTo(12L));
    }

    @Test
    void rejectsUnknownTaskTypeFilter() {
        DevloopTaskListQueryDto query = new DevloopTaskListQueryDto();
        query.setProjectId(203L);
        query.setTaskType("reviewer");

        ResponseUtil<PageInfo<DevloopTaskViewDto>> response = service.listTasks(query);

        assertThat(response.isSuccess()).isFalse();
        assertThat(response.getMsg()).isEqualTo("invalid task type");
    }

    private void initTableInfo(Class<?> entity) {
        if (TableInfoHelper.getTableInfo(entity) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), entity);
        }
    }

    private ScanRequireItem requireItem(Long sessionId) {
        ScanRequireItem item = new ScanRequireItem();
        item.setItemId(sessionId * 10);
        item.setSessionId(sessionId);
        return item;
    }

    private ByaiSession taskSession(Long sessionId, Long creatorId) {
        ByaiSession session = new ByaiSession();
        session.setSessionId(sessionId);
        session.setCreatorId(creatorId);
        return session;
    }
}
