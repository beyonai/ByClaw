package com.iwhalecloud.byai.state.application.service.taskplan;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.apache.ibatis.builder.MapperBuilderAssistant;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.taskplan.ByaiAgentTaskEvent;
import com.iwhalecloud.byai.manager.entity.taskplan.ByaiAgentTaskItem;
import com.iwhalecloud.byai.manager.entity.taskplan.ByaiAgentTaskPlan;
import com.iwhalecloud.byai.manager.mapper.taskplan.ByaiAgentTaskEventMapper;
import com.iwhalecloud.byai.manager.mapper.taskplan.ByaiAgentTaskItemMapper;
import com.iwhalecloud.byai.manager.mapper.taskplan.ByaiAgentTaskPlanMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanUpdateRequest;

class TaskPlanApplicationServiceTest {

    private ByaiAgentTaskPlanMapper planMapper;

    private ByaiAgentTaskItemMapper itemMapper;

    private ByaiAgentTaskEventMapper eventMapper;

    private SessionService sessionService;

    private TaskPlanApplicationService service;

    @BeforeEach
    void setUp() {
        initTableInfo(ByaiAgentTaskPlan.class);
        initTableInfo(ByaiAgentTaskItem.class);
        initTableInfo(ByaiAgentTaskEvent.class);
        planMapper = mock(ByaiAgentTaskPlanMapper.class);
        itemMapper = mock(ByaiAgentTaskItemMapper.class);
        eventMapper = mock(ByaiAgentTaskEventMapper.class);
        sessionService = mock(SessionService.class);
        service = new TaskPlanApplicationService(planMapper, itemMapper, eventMapper, sessionService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(7L);
        loginInfo.setUserCode("user-7");
        CurrentUserHolder.setLoginInfo(loginInfo);

        ByaiSession session = new ByaiSession();
        session.setSessionId(11L);
        session.setCreatorId(7L);
        when(sessionService.findById(11L)).thenReturn(session);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void update_createsSnapshotAndServerAssignedTaskIds() {
        when(planMapper.selectOne(any())).thenReturn(null);
        List<ByaiAgentTaskItem> savedItems = new ArrayList<>();
        doAnswer(invocation -> {
            savedItems.add(invocation.getArgument(0));
            return 1;
        }).when(itemMapper).insert(any(ByaiAgentTaskItem.class));
        when(itemMapper.selectList(any())).thenAnswer(invocation -> new ArrayList<>(savedItems));

        TaskPlanUpdateRequest request = request();
        TaskPlanSnapshot snapshot = service.update(request);

        assertThat(snapshot.getStatus()).isEqualTo("ACTIVE");
        assertThat(snapshot.getVersion()).isEqualTo(1);
        assertThat(snapshot.getSessionId()).isEqualTo("11");
        assertThat(snapshot.getMessageId()).isEqualTo("12");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("IN_PROGRESS", "PENDING");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getTaskId)
            .doesNotContainNull();
        assertThat(snapshot.getTasks().getFirst().getStatusReason().getCode()).isEqualTo("WORKING");
        verify(planMapper).insert(any(ByaiAgentTaskPlan.class));
        verify(eventMapper).insert(any(ByaiAgentTaskEvent.class));
    }

    @Test
    void update_findsPlanByExecutionAndAdvancesVersion() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 1);
        active.setSourceRunId("previous-run");
        ByaiAgentTaskPlan updated = plan("ACTIVE", 2);
        when(planMapper.selectOne(any())).thenReturn(active, updated);
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        ByaiAgentTaskItem first = item(101L, 1, "IN_PROGRESS");
        first.setTitle("分析协议");
        ByaiAgentTaskItem second = item(102L, 2, "PENDING");
        second.setTitle("实现协议");
        List<ByaiAgentTaskItem> savedItems = new ArrayList<>(List.of(first, second));
        when(itemMapper.selectList(any())).thenAnswer(invocation -> new ArrayList<>(savedItems));
        doAnswer(invocation -> {
            savedItems.clear();
            return 2;
        }).when(itemMapper).delete(any());
        doAnswer(invocation -> {
            savedItems.add(invocation.getArgument(0));
            return 1;
        }).when(itemMapper).insert(any(ByaiAgentTaskItem.class));

        TaskPlanUpdateRequest request = request();
        request.getTasks().getFirst().setStatus("COMPLETED");
        request.getTasks().get(1).setStatus("IN_PROGRESS");
        TaskPlanSnapshot snapshot = service.update(request);

        assertThat(snapshot.getVersion()).isEqualTo(2);
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getTaskId)
            .containsExactly("101", "102");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("COMPLETED", "IN_PROGRESS");
        verify(planMapper).update(any(), any(Wrapper.class));
    }

    @Test
    void update_preservesCompletedTaskTimestampsWhenLaterTasksAdvance() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 2);
        ByaiAgentTaskPlan completedPlan = plan("COMPLETED", 3);
        when(planMapper.selectOne(any())).thenReturn(active, completedPlan);
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        Date firstCompletedAt = new Date(1_000L);
        Date firstUpdatedAt = new Date(1_100L);
        ByaiAgentTaskItem first = item(101L, 1, "COMPLETED");
        first.setTitle("分析协议");
        first.setStartedAt(new Date(500L));
        first.setCompletedAt(firstCompletedAt);
        first.setUpdatedAt(firstUpdatedAt);
        ByaiAgentTaskItem second = item(102L, 2, "IN_PROGRESS");
        second.setTitle("实现协议");
        second.setStartedAt(new Date(2_000L));
        List<ByaiAgentTaskItem> savedItems = new ArrayList<>(List.of(first, second));
        when(itemMapper.selectList(any())).thenAnswer(invocation -> new ArrayList<>(savedItems));
        doAnswer(invocation -> {
            savedItems.clear();
            return 2;
        }).when(itemMapper).delete(any());
        doAnswer(invocation -> {
            savedItems.add(invocation.getArgument(0));
            return 1;
        }).when(itemMapper).insert(any(ByaiAgentTaskItem.class));

        TaskPlanUpdateRequest request = request();
        request.getTasks().getFirst().setStatus("COMPLETED");
        request.getTasks().getFirst().setStatusReason(null);
        request.getTasks().get(1).setStatus("COMPLETED");
        TaskPlanSnapshot snapshot = service.update(request);

        assertThat(snapshot.getTasks().getFirst().getCompletedAt()).isEqualTo(firstCompletedAt);
        assertThat(snapshot.getTasks().getFirst().getUpdatedAt()).isEqualTo(firstUpdatedAt);
        assertThat(snapshot.getTasks().get(1).getCompletedAt()).isAfter(firstCompletedAt);
    }

    @Test
    void update_failsFastAndSkipsPendingTasksAfterTaskFailure() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 1);
        ByaiAgentTaskPlan failedPlan = plan("FAILED", 2);
        failedPlan.setStatusReasonCode("DELEGATION_FAILED");
        failedPlan.setStatusReasonMessage("数字员工调度失败");
        when(planMapper.selectOne(any())).thenReturn(active, failedPlan);
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        ByaiAgentTaskItem first = item(101L, 1, "IN_PROGRESS");
        first.setTitle("分析协议");
        first.setStartedAt(new Date(1_000L));
        ByaiAgentTaskItem second = item(102L, 2, "PENDING");
        second.setTitle("实现协议");
        List<ByaiAgentTaskItem> savedItems = new ArrayList<>(List.of(first, second));
        when(itemMapper.selectList(any())).thenAnswer(invocation -> new ArrayList<>(savedItems));
        doAnswer(invocation -> {
            savedItems.clear();
            return 2;
        }).when(itemMapper).delete(any());
        doAnswer(invocation -> {
            savedItems.add(invocation.getArgument(0));
            return 1;
        }).when(itemMapper).insert(any(ByaiAgentTaskItem.class));

        TaskPlanUpdateRequest request = request();
        request.getTasks().getFirst().setStatus("FAILED");
        TaskPlanUpdateRequest.StatusReasonInput failure = new TaskPlanUpdateRequest.StatusReasonInput();
        failure.setCode("DELEGATION_FAILED");
        failure.setMessage("数字员工调度失败");
        request.getTasks().getFirst().setStatusReason(failure);
        TaskPlanSnapshot snapshot = service.update(request);

        assertThat(snapshot.getStatus()).isEqualTo("FAILED");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("FAILED", "SKIPPED");
        assertThat(snapshot.getTasks().get(1).getStatusReason().getCode())
            .isEqualTo("BLOCKED_BY_PREVIOUS_FAILURE");
    }

    @Test
    void update_cancelsAllPendingTasksAfterCurrentTaskCancellation() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 1);
        ByaiAgentTaskPlan cancelledPlan = plan("CANCELLED", 2);
        cancelledPlan.setStatusReasonCode("DELEGATION_CANCELLED");
        cancelledPlan.setStatusReasonMessage("数字员工调度已取消");
        when(planMapper.selectOne(any())).thenReturn(active, cancelledPlan);
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        ByaiAgentTaskItem first = item(101L, 1, "IN_PROGRESS");
        first.setTitle("分析协议");
        first.setStartedAt(new Date(1_000L));
        ByaiAgentTaskItem second = item(102L, 2, "PENDING");
        second.setTitle("实现协议");
        List<ByaiAgentTaskItem> savedItems = new ArrayList<>(List.of(first, second));
        when(itemMapper.selectList(any())).thenAnswer(invocation -> new ArrayList<>(savedItems));
        doAnswer(invocation -> {
            savedItems.clear();
            return 2;
        }).when(itemMapper).delete(any());
        doAnswer(invocation -> {
            savedItems.add(invocation.getArgument(0));
            return 1;
        }).when(itemMapper).insert(any(ByaiAgentTaskItem.class));

        TaskPlanUpdateRequest request = request();
        request.getTasks().getFirst().setStatus("CANCELLED");
        TaskPlanUpdateRequest.StatusReasonInput cancellation = new TaskPlanUpdateRequest.StatusReasonInput();
        cancellation.setCode("DELEGATION_CANCELLED");
        cancellation.setMessage("数字员工调度已取消");
        request.getTasks().getFirst().setStatusReason(cancellation);
        TaskPlanSnapshot snapshot = service.update(request);

        assertThat(snapshot.getStatus()).isEqualTo("CANCELLED");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("CANCELLED", "CANCELLED");
        assertThat(snapshot.getTasks().get(1).getStatusReason().getCode()).isEqualTo("PLAN_CANCELLED");
    }

    @Test
    void update_rejectsChangingATerminalTaskAfterThePlanAdvanced() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 2);
        when(planMapper.selectOne(any())).thenReturn(active);

        ByaiAgentTaskItem first = item(101L, 1, "COMPLETED");
        first.setTitle("分析协议");
        first.setCompletedAt(new Date(1_000L));
        ByaiAgentTaskItem second = item(102L, 2, "IN_PROGRESS");
        second.setTitle("实现协议");
        when(itemMapper.selectList(any())).thenReturn(List.of(first, second));

        TaskPlanUpdateRequest request = request();
        request.getTasks().getFirst().setStatus("IN_PROGRESS");
        request.getTasks().get(1).setStatus("IN_PROGRESS");

        assertThatThrownBy(() -> service.update(request))
            .hasMessageContaining("Terminal task at position 1 cannot change");
    }

    @Test
    void update_rejectsStartingALaterTaskBeforeTheCurrentTaskFinishes() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 1);
        when(planMapper.selectOne(any())).thenReturn(active);

        ByaiAgentTaskItem first = item(101L, 1, "PENDING");
        first.setTitle("分析协议");
        ByaiAgentTaskItem second = item(102L, 2, "PENDING");
        second.setTitle("实现协议");
        when(itemMapper.selectList(any())).thenReturn(List.of(first, second));

        TaskPlanUpdateRequest request = request();
        request.getTasks().getFirst().setStatus("PENDING");
        request.getTasks().get(1).setStatus("IN_PROGRESS");

        assertThatThrownBy(() -> service.update(request))
            .hasMessageContaining("cannot start before all previous tasks are terminal");
    }

    @Test
    void requestCancellation_movesPlanToCancellingWithoutDiscardingCompletedWork() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 2);
        ByaiAgentTaskPlan cancelling = plan("CANCELLING", 3);
        cancelling.setStatusReasonCode("USER_STOPPED");
        when(planMapper.selectOne(any())).thenReturn(active, cancelling);
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        ByaiAgentTaskItem completed = item(101L, 1, "COMPLETED");
        ByaiAgentTaskItem running = item(102L, 2, "IN_PROGRESS");
        when(itemMapper.selectList(any())).thenReturn(List.of(completed, running));

        var stop = new com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto();
        stop.setSessionId(11L);
        stop.setMessageId(12L);
        TaskPlanSnapshot snapshot = service.requestCancellation(stop, "USER_STOPPED", "用户请求停止");

        assertThat(snapshot.getStatus()).isEqualTo("CANCELLING");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("COMPLETED", "IN_PROGRESS");
        verify(eventMapper).insert(any(ByaiAgentTaskEvent.class));
    }

    @Test
    void findLatestByMessageIds_returnsLatestSnapshotsWithOneBatchItemQuery() {
        ByaiAgentTaskPlan latest = plan("COMPLETED", 3);
        latest.setPlanId(99L);
        latest.setMessageId(12L);

        ByaiAgentTaskPlan older = plan("ACTIVE", 2);
        older.setPlanId(98L);
        older.setMessageId(12L);

        ByaiAgentTaskPlan another = plan("FAILED", 4);
        another.setPlanId(100L);
        another.setMessageId(13L);
        when(planMapper.selectList(any())).thenReturn(List.of(latest, older, another));

        ByaiAgentTaskItem completed = item(101L, 1, "COMPLETED");
        completed.setPlanId(99L);
        ByaiAgentTaskItem failed = item(102L, 1, "FAILED");
        failed.setPlanId(100L);
        when(itemMapper.selectList(any())).thenReturn(List.of(completed, failed));

        Map<Long, TaskPlanSnapshot> snapshots = service.findLatestByMessageIds(11L, List.of(12L, 13L));

        assertThat(snapshots).hasSize(2);
        assertThat(snapshots.get(12L).getVersion()).isEqualTo(3);
        assertThat(snapshots.get(12L).getStatus()).isEqualTo("COMPLETED");
        assertThat(snapshots.get(12L).getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("COMPLETED");
        assertThat(snapshots.get(13L).getStatus()).isEqualTo("FAILED");
        verify(planMapper).selectList(any());
        verify(itemMapper).selectList(any());
    }

    @Test
    void deleteMethods_removePlanRootsForDatabaseCascade() {
        service.deleteByMessageId(12L);
        service.deleteBySessionId(11L);

        verify(planMapper, times(2)).delete(any());
    }

    private TaskPlanUpdateRequest request() {
        TaskPlanUpdateRequest request = new TaskPlanUpdateRequest();
        request.setIdempotencyKey("tool-call-1");
        request.setSessionId("11");
        request.setMessageId("12");
        request.setTraceId("trace-1");
        request.setSourceRuntime("BYCLAW_SUPER");
        request.setSourceRunId("run-1");
        request.setTitle("实现任务计划");

        TaskPlanUpdateRequest.TaskInput first = new TaskPlanUpdateRequest.TaskInput();
        first.setStep("分析协议");
        first.setStatus("IN_PROGRESS");
        TaskPlanUpdateRequest.StatusReasonInput reason = new TaskPlanUpdateRequest.StatusReasonInput();
        reason.setCode("WORKING");
        reason.setMessage("正在分析");
        first.setStatusReason(reason);
        TaskPlanUpdateRequest.TaskInput second = new TaskPlanUpdateRequest.TaskInput();
        second.setStep("实现协议");
        second.setStatus("PENDING");
        request.setTasks(List.of(first, second));
        return request;
    }

    private void initTableInfo(Class<?> entityType) {
        if (TableInfoHelper.getTableInfo(entityType) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), entityType);
        }
    }

    private ByaiAgentTaskPlan plan(String status, int version) {
        ByaiAgentTaskPlan plan = new ByaiAgentTaskPlan();
        plan.setPlanId(99L);
        plan.setUserId(7L);
        plan.setSessionId(11L);
        plan.setMessageId(12L);
        plan.setSourceRuntime("BYCLAW_SUPER");
        plan.setSourceRunId("run-1");
        plan.setTitle("实现任务计划");
        plan.setStatus(status);
        plan.setVersion(version);
        plan.setCreatedAt(new Date());
        plan.setUpdatedAt(new Date());
        return plan;
    }

    private ByaiAgentTaskItem item(Long id, int position, String status) {
        ByaiAgentTaskItem item = new ByaiAgentTaskItem();
        item.setTaskId(id);
        item.setPlanId(99L);
        item.setPosition(position);
        item.setTitle("task-" + position);
        item.setStatus(status);
        item.setCreatedAt(new Date());
        item.setUpdatedAt(new Date());
        return item;
    }
}
