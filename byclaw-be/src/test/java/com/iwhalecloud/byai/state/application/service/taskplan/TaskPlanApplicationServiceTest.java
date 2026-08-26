package com.iwhalecloud.byai.state.application.service.taskplan;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
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
    void create_persistsSingleRowAndReturnsServerAssignedIds() {
        when(planMapper.selectOne(any())).thenReturn(null);

        TaskPlanSnapshot snapshot = service.update(createRequest());

        assertThat(snapshot.getStatus()).isEqualTo("ACTIVE");
        assertThat(snapshot.getVersion()).isEqualTo(1);
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("IN_PROGRESS", "PENDING");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getTaskId)
            .doesNotContainNull();
        verify(planMapper).insert(any(ByaiAgentTaskPlan.class));
    }

    @Test
    void create_replaysTheFirstSnapshotForTheSameIdempotencyKey() {
        AtomicReference<ByaiAgentTaskPlan> stored = new AtomicReference<>();
        when(planMapper.selectOne(any())).thenAnswer(invocation -> stored.get());
        when(planMapper.insert(any())).thenAnswer(invocation -> {
            stored.set(invocation.getArgument(0));
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
    void create_rejectsASecondPlanForTheSameRun() {
        ByaiAgentTaskPlan existing = plan("ACTIVE", 1, tasks("IN_PROGRESS", "PENDING"));
        when(planMapper.selectOne(any())).thenReturn(existing);
        TaskPlanUpdateRequest request = createRequest();
        request.setIdempotencyKey("another-create");

        assertThatThrownBy(() -> service.update(request))
            .isInstanceOfSatisfying(TaskPlanCommandException.class, error -> {
                assertThat(error.getCode()).isEqualTo("PLAN_ALREADY_EXISTS");
                assertThat(error.getCurrentPlan().getPlanId()).isEqualTo("99");
            });
    }

    @Test
    void update_changesOnlyStatusesAndAdvancesVersionWithCas() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 1, tasks("IN_PROGRESS", "PENDING"));
        when(planMapper.selectOne(any())).thenReturn(active);
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        TaskPlanUpdateRequest request = updateRequest(active, List.of(
            statusUpdate("101", "COMPLETED", null),
            statusUpdate("102", "IN_PROGRESS", null)));
        TaskPlanSnapshot snapshot = service.update(request);

        assertThat(snapshot.getVersion()).isEqualTo(2);
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getTaskId)
            .containsExactly("101", "102");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getTitle)
            .containsExactly("分析协议", "实现协议");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("COMPLETED", "IN_PROGRESS");
        verify(planMapper).update(any(), any(Wrapper.class));
    }

    @Test
    void update_returnsCurrentPlanOnVersionConflict() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 3, tasks("COMPLETED", "IN_PROGRESS"));
        when(planMapper.selectOne(any())).thenReturn(active);
        TaskPlanUpdateRequest request = updateRequest(active,
            List.of(statusUpdate("102", "COMPLETED", null)));
        request.setExpectedVersion(2);

        assertThatThrownBy(() -> service.update(request))
            .isInstanceOfSatisfying(TaskPlanCommandException.class, error -> {
                assertThat(error.getCode()).isEqualTo("VERSION_CONFLICT");
                assertThat(error.getCurrentPlan().getVersion()).isEqualTo(3);
            });
    }

    @Test
    void update_rejectsChangingATerminalTask() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 2, tasks("COMPLETED", "IN_PROGRESS"));
        when(planMapper.selectOne(any())).thenReturn(active);
        TaskPlanUpdateRequest request = updateRequest(active,
            List.of(statusUpdate("101", "IN_PROGRESS", null)));

        assertThatThrownBy(() -> service.update(request))
            .isInstanceOfSatisfying(TaskPlanCommandException.class, error -> {
                assertThat(error.getCode()).isEqualTo("ILLEGAL_TASK_TRANSITION");
                assertThat(error.getCurrentPlan().getTasks().getFirst().getStatus()).isEqualTo("COMPLETED");
            });
    }

    @Test
    void update_rejectsStartingALaterTaskBeforeTheCurrentTaskFinishes() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 1, tasks("PENDING", "PENDING"));
        when(planMapper.selectOne(any())).thenReturn(active);
        TaskPlanUpdateRequest request = updateRequest(active,
            List.of(statusUpdate("102", "IN_PROGRESS", null)));

        assertThatThrownBy(() -> service.update(request))
            .isInstanceOfSatisfying(TaskPlanCommandException.class,
                error -> assertThat(error.getCode()).isEqualTo("INVALID_EXECUTION_ORDER"));
    }

    @Test
    void update_failsFastAndSkipsPendingTasks() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 1, tasks("IN_PROGRESS", "PENDING"));
        when(planMapper.selectOne(any())).thenReturn(active);
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);
        TaskPlanUpdateRequest.StatusReasonInput reason = new TaskPlanUpdateRequest.StatusReasonInput();
        reason.setCode("DELEGATION_FAILED");
        reason.setMessage("数字员工调度失败");

        TaskPlanSnapshot snapshot = service.update(updateRequest(active,
            List.of(statusUpdate("101", "FAILED", reason))));

        assertThat(snapshot.getStatus()).isEqualTo("FAILED");
        assertThat(snapshot.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("FAILED", "SKIPPED");
        assertThat(snapshot.getTasks().get(1).getStatusReason().getCode())
            .isEqualTo("BLOCKED_BY_PREVIOUS_FAILURE");
    }

    @Test
    void cancellationPreservesCompletedWorkAndClosesUnfinishedTasks() {
        ByaiAgentTaskPlan active = plan("ACTIVE", 2, tasks("COMPLETED", "IN_PROGRESS"));
        when(planMapper.selectOne(any())).thenReturn(active);
        when(planMapper.update(any(), any(Wrapper.class))).thenReturn(1);
        StopChatDto stop = new StopChatDto();
        stop.setSessionId(11L);
        stop.setMessageId(12L);

        TaskPlanSnapshot cancelling = service.requestCancellation(stop, "USER_STOPPED", "用户请求停止");
        TaskPlanSnapshot cancelled = service.confirmCancellation(stop, "USER_STOPPED", "用户已停止执行");

        assertThat(cancelling.getStatus()).isEqualTo("CANCELLING");
        assertThat(cancelled.getStatus()).isEqualTo("CANCELLED");
        assertThat(cancelled.getTasks()).extracting(TaskPlanSnapshot.TaskSnapshot::getStatus)
            .containsExactly("COMPLETED", "CANCELLED");
    }

    @Test
    void findLatestByMessageIdsReadsEmbeddedTasksWithoutASecondTable() {
        ByaiAgentTaskPlan latest = plan("COMPLETED", 3, tasks("COMPLETED", "COMPLETED"));
        ByaiAgentTaskPlan older = plan("ACTIVE", 2, tasks("COMPLETED", "IN_PROGRESS"));
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
        first.setStatus("IN_PROGRESS");
        TaskPlanUpdateRequest.TaskInput second = new TaskPlanUpdateRequest.TaskInput();
        second.setStep("实现协议");
        second.setStatus("PENDING");
        request.setTasks(List.of(first, second));
        return request;
    }

    private TaskPlanUpdateRequest updateRequest(ByaiAgentTaskPlan plan,
        List<TaskPlanUpdateRequest.TaskStatusUpdate> updates) {
        TaskPlanUpdateRequest request = baseRequest();
        request.setAction("UPDATE");
        request.setIdempotencyKey("update-" + plan.getVersion());
        request.setPlanId(String.valueOf(plan.getPlanId()));
        request.setExpectedVersion(plan.getVersion());
        request.setUpdates(updates);
        return request;
    }

    private TaskPlanUpdateRequest baseRequest() {
        TaskPlanUpdateRequest request = new TaskPlanUpdateRequest();
        request.setIdempotencyKey("tool-call-1");
        request.setSessionId("11");
        request.setMessageId("12");
        request.setTraceId("trace-1");
        request.setSourceRuntime("BYCLAW_SUPER");
        request.setSourceRunId("run-1");
        return request;
    }

    private TaskPlanUpdateRequest.TaskStatusUpdate statusUpdate(String taskId, String status,
        TaskPlanUpdateRequest.StatusReasonInput reason) {
        TaskPlanUpdateRequest.TaskStatusUpdate update = new TaskPlanUpdateRequest.TaskStatusUpdate();
        update.setTaskId(taskId);
        update.setStatus(status);
        update.setStatusReason(reason);
        return update;
    }

    private ByaiAgentTaskPlan plan(String status, int version, List<TaskPlanSnapshot.TaskSnapshot> tasks) {
        ByaiAgentTaskPlan plan = new ByaiAgentTaskPlan();
        plan.setPlanId(99L);
        plan.setUserId(7L);
        plan.setUserCode("user-7");
        plan.setSessionId(11L);
        plan.setMessageId(12L);
        plan.setTraceId("trace-1");
        plan.setSourceRuntime("BYCLAW_SUPER");
        plan.setSourceRunId("run-1");
        plan.setCreateRequestId("create-1");
        plan.setTitle("实现任务计划");
        plan.setStatus(status);
        plan.setVersion(version);
        plan.setTasksPayload(JSON.toJSONString(tasks));
        plan.setIdempotencyPayload("[]");
        plan.setCreatedAt(new Date(1_000L));
        plan.setUpdatedAt(new Date(2_000L));
        return plan;
    }

    private List<TaskPlanSnapshot.TaskSnapshot> tasks(String firstStatus, String secondStatus) {
        return List.of(task("101", 1, "分析协议", firstStatus), task("102", 2, "实现协议", secondStatus));
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
