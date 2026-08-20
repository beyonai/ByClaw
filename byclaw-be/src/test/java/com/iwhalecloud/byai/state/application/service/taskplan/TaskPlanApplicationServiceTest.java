package com.iwhalecloud.byai.state.application.service.taskplan;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

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
    void update_createsSnapshotAndStableTaskIds() {
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
