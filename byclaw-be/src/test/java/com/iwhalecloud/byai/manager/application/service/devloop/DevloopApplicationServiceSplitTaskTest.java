package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Locale;

import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiPromptService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanItemTaskService;
import com.iwhalecloud.byai.manager.dto.devloop.RequirementSplitDTO;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectMember;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.entity.devloop.ScanRequireItem;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanRequireItemMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/**
 * splitTask 单测:验证需求拆多仓库子任务的核心不变式——
 * 1) rowId→taskId 依赖翻译(逗号串,引用不到的 rowId 跳过);
 * 2) 需求回写入度0(第一个)子任务的 sessionId;
 * 3) 需求已启动(sessionId 非空)时拒绝重复拆分,不建任何子任务。
 */
@ExtendWith(MockitoExtension.class)
@DisabledOnOs(OS.WINDOWS)
class DevloopApplicationServiceSplitTaskTest {

    @Mock
    private ScanRequireItemMapper scanRequireItemMapper;
    @Mock
    private ProjectRepoMapper projectRepoMapper;
    @Mock
    private ProjectMapper projectMapper;
    @Mock
    private ProjectMemberService projectMemberService;
    @Mock
    private ScanItemTaskService scanItemTaskService;
    @Mock
    private SequenceService sequenceService;
    @Mock
    private AssistantChatService assistantChatService;
    @Mock
    private AiPromptService aiPromptService;

    private DevloopApplicationService service;
    private MessageSource originalMessageSource;

    @BeforeEach
    void setUp() {
        CurrentUserHolder.clearLoginInfo();
        // I18nUtil 持有静态 MessageSource,拒绝路径经 failRes 走 I18nUtil.get,测试需注入并在结束后还原。
        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("devloop.task.requirement.already.started", Locale.US, "already started");
        messageSource.addMessage("devloop.task.split.tasks.required", Locale.US, "tasks required");
        messageSource.addMessage("devloop.task.repository.not.found", Locale.US, "repo not found");
        messageSource.addMessage("devloop.task.agent.required", Locale.US, "agent required");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.US);
        service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "scanRequireItemMapper", scanRequireItemMapper);
        ReflectionTestUtils.setField(service, "projectRepoMapper", projectRepoMapper);
        ReflectionTestUtils.setField(service, "projectMapper", projectMapper);
        ReflectionTestUtils.setField(service, "projectMemberService", projectMemberService);
        ReflectionTestUtils.setField(service, "scanItemTaskService", scanItemTaskService);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "assistantChatService", assistantChatService);
        ReflectionTestUtils.setField(service, "aiPromptService", aiPromptService);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        LocaleContextHolder.resetLocaleContext();
    }

    private ProjectMember member(long userId, long agentId) {
        ProjectMember m = new ProjectMember();
        m.setUserId(userId);
        m.setAgentId(agentId);
        return m;
    }

    private ProjectRepo repo(long repoId, long projectId) {
        ProjectRepo r = new ProjectRepo();
        r.setRepoId(repoId);
        r.setProjectId(projectId);
        r.setRepoFullName("org/repo-" + repoId);
        return r;
    }

    private RequirementSplitDTO.SplitTask splitTask(String rowId, long repoId, long assigneeId, List<String> deps) {
        RequirementSplitDTO.SplitTask t = new RequirementSplitDTO.SplitTask();
        t.setRowId(rowId);
        t.setTitle("子任务-" + rowId);
        t.setRepoId(repoId);
        t.setAssigneeId(assigneeId);
        t.setDependsOn(deps);
        return t;
    }

    @Test
    void splitTask_translatesRowDepsToTaskIds_andWritesBackFirstSession() {
        long projectId = 100L, sourceItemId = 200L;
        ScanRequireItem item = new ScanRequireItem();
        item.setItemId(sourceItemId);
        item.setTitle("接入新支付渠道");
        item.setSessionId(null);
        when(scanRequireItemMapper.selectById(sourceItemId)).thenReturn(item);

        when(projectMemberService.listByProjectId(projectId))
            .thenReturn(List.of(member(1L, 11L), member(2L, 22L)));
        when(projectRepoMapper.selectById(301L)).thenReturn(repo(301L, projectId));
        when(projectRepoMapper.selectById(302L)).thenReturn(repo(302L, projectId));
        when(projectMapper.selectById(projectId)).thenReturn(new Project());
        when(aiPromptService.findTemplateByCode(any(), any())).thenReturn(null);

        // 预分配 taskId 与建会话各自独立自增,验证 dependsOn 存的是 taskId 而非 sessionId。
        AtomicLong seq = new AtomicLong(1000L);
        when(sequenceService.nextVal()).thenAnswer(inv -> seq.incrementAndGet());
        AtomicLong session = new AtomicLong(5000L);
        when(assistantChatService.createGroupChatSession(any())).thenAnswer(inv -> {
            AssistantChatDto dto = inv.getArgument(0);
            dto.setSessionId(session.incrementAndGet());
            return null;
        });

        // 两个子任务:be(row-a,无上游)、fe(row-b,依赖 row-a + 一个不存在的 row-x)。
        RequirementSplitDTO dto = new RequirementSplitDTO();
        dto.setProjectId(projectId);
        dto.setSourceItemId(sourceItemId);
        dto.setTasks(List.of(
            splitTask("row-a", 301L, 1L, List.of()),
            splitTask("row-b", 302L, 2L, List.of("row-a", "row-x"))));

        ResponseUtil<Map<String, Object>> res = service.splitTask(dto);
        assertThat(res.getCode()).isEqualTo(ResponseUtil.SUCCESS);

        // taskId 预分配顺序:row-a=1001, row-b=1002。row-b 依赖翻译成 "1001",悬空的 row-x 被跳过。
        ArgumentCaptor<Long> taskIdCap = ArgumentCaptor.forClass(Long.class);
        ArgumentCaptor<String> depsCap = ArgumentCaptor.forClass(String.class);
        verify(scanItemTaskService, org.mockito.Mockito.times(2)).insertSubtaskWithDeps(
            taskIdCap.capture(), eq(sourceItemId), eq(projectId), anyLong(), anyLong(),
            depsCap.capture(), any());
        assertThat(taskIdCap.getAllValues()).containsExactly(1001L, 1002L);
        assertThat(depsCap.getAllValues().get(0)).isNull();
        assertThat(depsCap.getAllValues().get(1)).isEqualTo("1001");

        // 需求回写第一个子任务(入度0)的 sessionId=5001。
        ArgumentCaptor<ScanRequireItem> updateCap = ArgumentCaptor.forClass(ScanRequireItem.class);
        verify(scanRequireItemMapper).updateById(updateCap.capture());
        assertThat(updateCap.getValue().getSessionId()).isEqualTo(5001L);
    }

    @Test
    void splitTask_rejectsWhenRequirementAlreadyStarted() {
        long projectId = 100L, sourceItemId = 200L;
        ScanRequireItem item = new ScanRequireItem();
        item.setItemId(sourceItemId);
        item.setSessionId(9999L); // 已启动
        when(scanRequireItemMapper.selectById(sourceItemId)).thenReturn(item);

        RequirementSplitDTO dto = new RequirementSplitDTO();
        dto.setProjectId(projectId);
        dto.setSourceItemId(sourceItemId);
        dto.setTasks(List.of(splitTask("row-a", 301L, 1L, List.of())));

        ResponseUtil<Map<String, Object>> res = service.splitTask(dto);
        assertThat(res.getCode()).isNotEqualTo(ResponseUtil.SUCCESS);
        verify(scanItemTaskService, never()).insertSubtaskWithDeps(
            any(), any(), any(), any(), any(), any(), any());
        verify(scanRequireItemMapper, never()).updateById(any());
    }
}
