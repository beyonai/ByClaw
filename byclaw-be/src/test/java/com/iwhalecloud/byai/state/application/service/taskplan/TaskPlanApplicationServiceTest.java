package com.iwhalecloud.byai.state.application.service.taskplan;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.taskplan.ByaiAgentTaskPlan;
import com.iwhalecloud.byai.manager.mapper.taskplan.ByaiAgentTaskPlanMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanLookupRequest;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanUpdateRequest;
import com.iwhalecloud.byai.state.domain.taskplan.exception.TaskPlanCommandException;

class TaskPlanApplicationServiceTest {

    private ByaiAgentTaskPlanMapper planMapper;

    private SessionService sessionService;

    private TaskPlanApplicationService service;

    @BeforeEach
    void setUp() {
        initTableInfo(ByaiAgentTaskPlan.class);
        planMapper = mock(ByaiAgentTaskPlanMapper.class);
        sessionService = mock(SessionService.class);
        service = new TaskPlanApplicationService(planMapper, sessionService);

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
    void create_usesDatabasePlanIdAndPositionTaskIds() {
        when(planMapper.selectOne(any())).thenReturn(null);
        when(planMapper.insert(any())).thenAnswer(invocation -> {
            ByaiAgentTaskPlan plan = invocation.getArgument(0);
            plan.setPlanId(1L);
            return 1;
        });

        TaskPlanSnapshot snapshot = service.update(createRequest());

        assertThat(snapshot.getPlanId()).isEqualTo("1");
        assertThat(snapshot.getMessageId()).isEqualTo("run-1:ready");
        assertThat(snapshot.getStatus()).isEqualTo("ACTIVE");
        assertThat(snapshot.getVersion()).isEqualTo(1);
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getTaskId)
            .containsExactly("1", "2");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("IN_PROGRESS", "PENDING");
        verify(planMapper).insert(any(ByaiAgentTaskPlan.class));
    }

    @Test
    void create_replaysCurrentSnapshotForTheSameCommandId() {
        AtomicReference<ByaiAgentTaskPlan> stored = new AtomicReference<>();
        when(planMapper.selectOne(any())).thenAnswer(invocation -> stored.get());
        when(planMapper.insert(any())).thenAnswer(invocation -> {
            ByaiAgentTaskPlan plan = invocation.getArgument(0);
            plan.setPlanId(1L);
            stored.set(plan);
            return 1;
        });

        TaskPlanUpdateRequest request = createRequest();
        TaskPlanSnapshot first = service.update(request);
        TaskPlanSnapshot replay = service.update(request);

        assertThat(replay.getPlanId()).isEqualTo(first.getPlanId());
        assertThat(replay.getVersion()).isEqualTo(1);
        verify(planMapper).insert(any(ByaiAgentTaskPlan.class));
    }

    @Test
    void create_rejectsAnotherActivePlanForTheSameExecution() {
        when(planMapper.selectOne(any())).thenReturn(plan("ACTIVE", 1, tasks("IN_PROGRESS", "PENDING")));
        TaskPlanUpdateRequest request = createRequest();
        request.setIdempotencyKey("another-create");

        assertThatThrownBy(() -> service.update(request))
            .isInstanceOfSatisfying(TaskPlanCommandException.class, error -> {
                assertThat(error.getCode()).isEqualTo("PLAN_ALREADY_EXISTS");
                assertThat(error.getCurrentPlan().getPlanId()).isEqualTo("99");
            });
    }

    @Test
    void create_rejectsAnotherRuntimePlanWithoutLeakingItsSnapshot() {
        ByaiAgentTaskPlan openClawPlan = plan("ACTIVE", 1, tasks("IN_PROGRESS", "PENDING"));
        openClawPlan.setSourceRuntime("OPENCLAW");
        openClawPlan.setSourceRunId("openclaw-run-1");
        when(planMapper.selectOne(any())).thenReturn(openClawPlan);

        assertThatThrownBy(() -> service.update(createRequest()))
            .isInstanceOfSatisfying(TaskPlanCommandException.class, error -> {
                assertThat(error.getCode()).isEqualTo("PLAN_ALREADY_EXISTS");
                assertThat(error.getCurrentPlan()).isNull();
            });
    }

    @Test
    void recoverCreateConflictDoesNotLeakAnotherRuntimePlan() {
        ByaiAgentTaskPlan openClawPlan = plan("ACTIVE", 1, tasks("IN_PROGRESS", "PENDING"));
        openClawPlan.setSourceRuntime("OPENCLAW");
        openClawPlan.setSourceRunId("openclaw-run-1");
        when(planMapper.selectOne(any())).thenReturn(openClawPlan);

        assertThatThrownBy(() -> service.recoverCreateConflict(createRequest()))
            .isInstanceOfSatisfying(TaskPlanCommandException.class, error -> {
                assertThat(error.getCode()).isEqualTo("PLAN_ALREADY_EXISTS");
                assertThat(error.getCurrentPlan()).isNull();
            });
    }

    @Test
    void findActiveScopesTheQueryToTheRuntimeExecutionOwner() {
        when(planMapper.selectOne(any())).thenReturn(null);
        TaskPlanLookupRequest request = new TaskPlanLookupRequest();
        request.setSessionId("11");
        request.setMessageId("delegation-1");
        request.setSourceRuntime("OPENCLAW");
        request.setSourceRunId("openclaw-run-1");

        assertThat(service.findActive(request)).isNull();

        verify(planMapper).selectOne(argThat(wrapper -> {
            String sql = wrapper.getSqlSegment();
            return sql.contains("message_id")
                && sql.contains("source_runtime")
                && sql.contains("source_run_id");
        }));
    }

    @Test
    void findLatestForMessageKeepsFrontendRecoverySeparateFromRuntimeOwnership() {
        ByaiAgentTaskPlan completed = plan("COMPLETED", 3, tasks("COMPLETED", "COMPLETED"));
        completed.setSourceRuntime("OPENCLAW");
        completed.setSourceRunId("openclaw-run-1");
        when(planMapper.selectOne(any())).thenReturn(completed);
        TaskPlanLookupRequest request = new TaskPlanLookupRequest();
        request.setSessionId("11");
        request.setMessageId("run-1:ready");

        TaskPlanSnapshot snapshot = service.findLatestForMessage(request);

        assertThat(snapshot.getSourceRuntime()).isEqualTo("OPENCLAW");
        assertThat(snapshot.getSourceRunId()).isEqualTo("openclaw-run-1");
    }

    @Test
    void requestCancellationAcceptsOpaqueMessageId() {
        when(planMapper.selectOne(any())).thenReturn(plan("ACTIVE", 1, tasks("IN_PROGRESS", "PENDING")));
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);
        TaskPlanLookupRequest request = new TaskPlanLookupRequest();
        request.setSessionId("11");
        request.setMessageId("run-1:ready");
        request.setSourceRuntime("BYCLAW_SUPER");
        request.setSourceRunId("run-1");

        TaskPlanSnapshot snapshot = service.requestCancellation(request, "USER_STOPPED", "用户请求停止");

        assertThat(snapshot.getStatus()).isEqualTo("CANCELLING");
    }

    @Test
    void completeCurrent_completesCurrentAndStartsNextAtomically() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 1, tasks("IN_PROGRESS", "PENDING"));
        when(planMapper.selectOne(any())).thenReturn(active);
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        TaskPlanSnapshot snapshot = service.update(actionRequest("COMPLETE_CURRENT", "complete-1"));

        assertThat(snapshot.getVersion()).isEqualTo(2);
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("COMPLETED", "IN_PROGRESS");
        verify(planMapper).update(any(), any(Wrapper.class));
    }

    @Test
    void completeCurrent_completesThePlanWhenNoPendingTaskRemains() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 2, tasks("COMPLETED", "IN_PROGRESS"));
        when(planMapper.selectOne(any())).thenReturn(active);
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        TaskPlanSnapshot snapshot = service.update(actionRequest("COMPLETE_CURRENT", "complete-2"));

        assertThat(snapshot.getStatus()).isEqualTo("COMPLETED");
        assertThat(snapshot.getVersion()).isEqualTo(3);
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("COMPLETED", "COMPLETED");
    }

    @Test
    void failCurrent_failsFastAndSkipsPendingTasks() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 1, tasks("IN_PROGRESS", "PENDING"));
        when(planMapper.selectOne(any())).thenReturn(active);
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);
        TaskPlanUpdateRequest request = actionRequest("FAIL_CURRENT", "fail-1");
        TaskPlanUpdateRequest.StatusReasonInput reason = new TaskPlanUpdateRequest.StatusReasonInput();
        reason.setCode("DELEGATION_FAILED");
        reason.setMessage("数字员工调度失败");
        request.setStatusReason(reason);

        TaskPlanSnapshot snapshot = service.update(request);

        assertThat(snapshot.getStatus()).isEqualTo("FAILED");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("FAILED", "SKIPPED");
        assertThat(snapshot.getTasks().get(1).getStatusReason().getCode())
            .isEqualTo("BLOCKED_BY_PREVIOUS_FAILURE");
    }

    @Test
    void repeatedTerminalCommandReturnsLatestSnapshotWithoutAnotherWrite() {
        ByaiAgentTaskPlan completed = plan("COMPLETED", 3, tasks("COMPLETED", "COMPLETED"));
        completed.setLastCommandId("complete-2");
        when(planMapper.selectOne(any())).thenReturn(null, completed);

        TaskPlanSnapshot snapshot = service.update(actionRequest("COMPLETE_CURRENT", "complete-2"));

        assertThat(snapshot.getStatus()).isEqualTo("COMPLETED");
        assertThat(snapshot.getVersion()).isEqualTo(3);
    }

    @Test
    void stopChatCancellationCancelsEveryActiveExecutionInTheSession() {
        ByaiAgentTaskPlan superPlan = plan("ACTIVE", 2, tasks("COMPLETED", "IN_PROGRESS"));
        ByaiAgentTaskPlan openClawPlan = plan("ACTIVE", 1, tasks("IN_PROGRESS", "PENDING"));
        openClawPlan.setPlanId(100L);
        openClawPlan.setSourceRuntime("OPENCLAW");
        openClawPlan.setSourceRunId("openclaw-run-1");
        when(planMapper.selectList(any())).thenReturn(List.of(superPlan, openClawPlan));
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);
        StopChatDto stop = new StopChatDto();
        stop.setSessionId(11L);
        stop.setMessageId(999L);

        List<TaskPlanSnapshot> cancelling = service.requestCancellation(stop, "USER_STOPPED", "用户请求停止");
        List<TaskPlanSnapshot> cancelled = service.confirmCancellation(stop, "USER_STOPPED", "用户已停止执行");

        assertThat(cancelling).hasSize(2).allMatch(plan -> "CANCELLING".equals(plan.getStatus()));
        assertThat(cancelled).hasSize(2).allMatch(plan -> "CANCELLED".equals(plan.getStatus()));
        assertThat(cancelled.get(0).getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("COMPLETED", "CANCELLED");
        assertThat(cancelled.get(1).getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("CANCELLED", "CANCELLED");
        verify(planMapper, times(4)).update(any(), any(Wrapper.class));
    }

    @Test
    void findLatestByMessageIdsReadsEmbeddedTasksWithoutASecondTable() {
        ByaiAgentTaskPlan latest = plan("COMPLETED", 3, tasks("COMPLETED", "COMPLETED"));
        ByaiAgentTaskPlan older = plan("ACTIVE", 2, tasks("COMPLETED", "IN_PROGRESS"));
        latest.setMessageId("12");
        older.setMessageId("12");
        older.setPlanId(98L);
        when(planMapper.selectList(any())).thenReturn(List.of(latest, older));

        Map<Long, TaskPlanSnapshot> snapshots = service.findLatestByMessageIds(11L, List.of(12L));

        assertThat(snapshots.get(12L).getVersion()).isEqualTo(3);
        assertThat(snapshots.get(12L).getTasks()).hasSize(2);
        verify(planMapper).selectList(any());
    }

    @Test
    void deleteMethodsDeleteOnlyTheSinglePlanTable() {
        service.deleteByMessageId(12L);
        service.deleteBySessionId(11L);

        verify(planMapper, times(2)).delete(any());
    }

    private TaskPlanUpdateRequest createRequest() {
        TaskPlanUpdateRequest request = baseRequest();
        request.setAction("CREATE");
        request.setTitle("实现任务计划");
        TaskPlanUpdateRequest.TaskInput first = new TaskPlanUpdateRequest.TaskInput();
        first.setStep("分析协议");
        TaskPlanUpdateRequest.TaskInput second = new TaskPlanUpdateRequest.TaskInput();
        second.setStep("实现协议");
        request.setTasks(List.of(first, second));
        return request;
    }

    private TaskPlanUpdateRequest actionRequest(String action, String commandId) {
        TaskPlanUpdateRequest request = baseRequest();
        request.setAction(action);
        request.setIdempotencyKey(commandId);
        return request;
    }

    private TaskPlanUpdateRequest baseRequest() {
        TaskPlanUpdateRequest request = new TaskPlanUpdateRequest();
        request.setIdempotencyKey("tool-call-1");
        request.setSessionId("11");
        request.setMessageId("run-1:ready");
        request.setTraceId("trace-1");
        request.setSourceRuntime("BYCLAW_SUPER");
        request.setSourceRunId("run-1");
        return request;
    }

    private ByaiAgentTaskPlan plan(String status, int version, List<TaskPlanSnapshot.TaskSnapshot> tasks) {
        ByaiAgentTaskPlan plan = new ByaiAgentTaskPlan();
        plan.setPlanId(99L);
        plan.setUserId(7L);
        plan.setSessionId(11L);
        plan.setMessageId("run-1:ready");
        plan.setTraceId("trace-1");
        plan.setSourceRuntime("BYCLAW_SUPER");
        plan.setSourceRunId("run-1");
        plan.setTitle("实现任务计划");
        plan.setStatus(status);
        plan.setVersion(version);
        plan.setTasksPayload(JSON.toJSONString(tasks));
        plan.setLastCommandId("previous-command");
        plan.setCreatedAt(new Date(1_000L));
        plan.setUpdatedAt(new Date(2_000L));
        return plan;
    }

    private List<TaskPlanSnapshot.TaskSnapshot> tasks(String firstStatus, String secondStatus) {
        return List.of(task("1", 1, "分析协议", firstStatus), task("2", 2, "实现协议", secondStatus));
    }

    private TaskPlanSnapshot.TaskSnapshot task(String id, int position, String title, String status) {
        TaskPlanSnapshot.TaskSnapshot task = new TaskPlanSnapshot.TaskSnapshot();
        task.setTaskId(id);
        task.setPosition(position);
        task.setTitle(title);
        task.setStatus(status);
        task.setUpdatedAt(new Date(2_000L));
        if (!"PENDING".equals(status)) {
            task.setStartedAt(new Date(1_500L));
        }
        if (List.of("COMPLETED", "FAILED", "SKIPPED", "CANCELLED").contains(status)) {
            task.setCompletedAt(new Date(2_000L));
        }
        return task;
    }

    private void initTableInfo(Class<?> entityType) {
        if (TableInfoHelper.getTableInfo(entityType) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), entityType);
        }
    }
}
