package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTaskPublication;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskPublicationMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.qo.resource.DirAndFileQo;
import com.iwhalecloud.byai.manager.vo.resource.DirAndFileVo;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskCompleteRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskFile;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskPublicationResponse;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** 群聊任务提升、查询、取消以及一次性完成发布用例。 */
@Service
public class GroupChatTaskService {
    private final ByaiGroupChatTaskMapper taskMapper;
    private final ByaiGroupChatTaskPublicationMapper publicationMapper;
    private final ByaiGroupChatExecutionMapper executionMapper;
    private final ByaiMessageMapper messageMapper;
    private final SequenceService sequenceService;
    private final GroupChatCandidateSessionService candidateSessionService;
    private final GroupChatTaskAuthorizationService taskAuthorizationService;
    private final GroupChatAuthorizationService groupAuthorizationService;
    private final SessionService sessionService;
    private final ProjectService projectService;
    private final SsResourceService resourceService;
    private final GroupChatEventPublisher eventPublisher;

    public GroupChatTaskService(ByaiGroupChatTaskMapper taskMapper,
        ByaiGroupChatTaskPublicationMapper publicationMapper, ByaiGroupChatExecutionMapper executionMapper,
        ByaiMessageMapper messageMapper, SequenceService sequenceService,
        GroupChatCandidateSessionService candidateSessionService,
        GroupChatTaskAuthorizationService taskAuthorizationService,
        GroupChatAuthorizationService groupAuthorizationService, SessionService sessionService,
        ProjectService projectService, SsResourceService resourceService, GroupChatEventPublisher eventPublisher) {
        this.taskMapper = taskMapper;
        this.publicationMapper = publicationMapper;
        this.executionMapper = executionMapper;
        this.messageMapper = messageMapper;
        this.sequenceService = sequenceService;
        this.candidateSessionService = candidateSessionService;
        this.taskAuthorizationService = taskAuthorizationService;
        this.groupAuthorizationService = groupAuthorizationService;
        this.sessionService = sessionService;
        this.projectService = projectService;
        this.resourceService = resourceService;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    public ByaiGroupChatTask promote(ByaiGroupChatExecution execution, String taskName, String ackText) {
        ByaiGroupChatTask existing = taskMapper.selectById(execution.getCandidateSessionId());
        if (existing != null) {
            return existing;
        }
        Date now = new Date();
        if (executionMapper.decideDisposition(execution.getExecutionId(), "TASK", taskName, ackText, now) != 1) {
            existing = taskMapper.selectById(execution.getCandidateSessionId());
            if (existing != null) {
                return existing;
            }
            throw new IllegalStateException("Task disposition changed concurrently");
        }
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setTaskSessionId(execution.getCandidateSessionId());
        task.setGroupSessionId(execution.getGroupSessionId());
        task.setSourceMessageId(execution.getSourceMessageId());
        task.setDispatchId(execution.getExecutionId());
        task.setInitiatorUserId(execution.getInitiatorUserId());
        task.setTargetAgentId(execution.getTargetAgentId());
        task.setTaskName(taskName);
        task.setStatus("ACTIVE");
        task.setTurnStatus("RUNNING");
        task.setCreateTime(now);
        task.setUpdateTime(now);
        taskMapper.insert(task);
        candidateSessionService.promote(task.getTaskSessionId(), taskName);
        publishTaskEvent(task, "TASK_CREATED", null);
        if (StringUtils.isNotBlank(ackText)) {
            Long messageId = createGroupMessage(task, ackText, "TASK_ACK", null, null);
            executionMapper.setAckMessage(execution.getExecutionId(), messageId);
        }
        return task;
    }

    public List<ByaiGroupChatTask> list(Long groupSessionId) {
        groupAuthorizationService.requireCurrentUserMember(groupSessionId);
        return taskMapper.selectByGroup(groupSessionId);
    }

    public ByaiGroupChatTask detail(Long taskId) {
        return taskAuthorizationService.requireInitiator(taskId);
    }

    @Transactional
    public GroupChatTaskPublicationResponse complete(Long taskId, GroupChatTaskCompleteRequest request) {
        ByaiGroupChatTask task = taskAuthorizationService.requireInitiator(taskId);
        ByaiGroupChatTaskPublication existing = publicationMapper.selectById(taskId);
        if (existing != null) {
            return response(existing);
        }
        List<GroupChatTaskFile> files = request == null || request.getFiles() == null
            ? Collections.emptyList() : request.getFiles();
        String text = request == null ? null : StringUtils.trimToNull(request.getText());
        if (text == null && files.isEmpty()) {
            throw new IllegalArgumentException("Published task result requires text or files");
        }
        if (!"ACTIVE".equals(task.getStatus()) || "RUNNING".equals(task.getTurnStatus())) {
            throw new IllegalArgumentException("Task is not ready for publication");
        }
        validateCloudFiles(task, files);
        Long messageId = sequenceService.nextVal();
        ByaiGroupChatTaskPublication publication = new ByaiGroupChatTaskPublication();
        publication.setTaskSessionId(taskId);
        publication.setGroupSessionId(task.getGroupSessionId());
        publication.setMessageId(messageId);
        publication.setPublisherUserId(CurrentUserHolder.getCurrentUserId());
        publication.setTextContent(text);
        publication.setFilesJson(JSON.toJSONString(files));
        publication.setCreateTime(new Date());
        publicationMapper.insert(publication);
        createGroupMessage(task, text, "TASK_RESULT", files, messageId);
        if (taskMapper.publish(taskId, messageId, publication.getPublisherUserId(), new Date()) != 1) {
            throw new IllegalStateException("Task publication state changed concurrently");
        }
        task.setStatus("PUBLISHED");
        task.setPublishMessageId(messageId);
        task.setPublishBy(publication.getPublisherUserId());
        publishTaskEvent(task, "TASK_PUBLISHED", messageId);
        return response(publication);
    }

    @Transactional
    public void cancel(Long taskId) {
        ByaiGroupChatTask task = taskAuthorizationService.requireCanceller(taskId);
        if (taskMapper.cancel(taskId, new Date()) != 1) {
            throw new IllegalArgumentException("Task is no longer active");
        }
        task.setStatus("CANCELLED");
        publishTaskEvent(task, "TASK_STATUS_CHANGED", null);
    }

    @Transactional
    public void updateTurnStatus(Long taskId, String status) {
        ByaiGroupChatTask task = taskMapper.selectById(taskId);
        if (task != null && taskMapper.updateTurnStatus(taskId, status, new Date()) == 1) {
            task.setTurnStatus(status);
            publishTaskEvent(task, "TASK_STATUS_CHANGED", null);
        }
    }

    @Transactional
    public boolean startTurn(Long taskId) {
        ByaiGroupChatTask task = taskMapper.selectById(taskId);
        if (task == null || taskMapper.claimTurn(taskId, new Date()) != 1) {
            return false;
        }
        task.setTurnStatus("RUNNING");
        publishTaskEvent(task, "TASK_STATUS_CHANGED", null);
        return true;
    }

    private void validateCloudFiles(ByaiGroupChatTask task, List<GroupChatTaskFile> files) {
        if (files.isEmpty()) {
            return;
        }
        ByaiSession group = sessionService.findById(task.getGroupSessionId());
        Project project = group == null ? null : projectService.findById(group.getProjectId());
        if (project == null || project.getCloudResourceId() == null) {
            throw new IllegalArgumentException("Group project cloud drive is unavailable");
        }
        for (GroupChatTaskFile file : files) {
            if (file == null || StringUtils.isBlank(file.getFileName()) || StringUtils.isBlank(file.getFilePath())
                || file.getFilePath().contains("..")) {
                throw new IllegalArgumentException("Invalid project cloud file reference");
            }
            String normalized = file.getFilePath().startsWith("/") ? file.getFilePath() : "/" + file.getFilePath();
            int slash = normalized.lastIndexOf('/');
            String directory = slash <= 0 ? "/" : normalized.substring(0, slash);
            DirAndFileQo query = new DirAndFileQo();
            query.setResourceId(project.getCloudResourceId());
            query.setDirectoryPath(directory);
            query.setKeyword(file.getFileName());
            List<DirAndFileVo> matches = resourceService.queryDirAndFileByLevel(query);
            boolean found = matches != null && matches.stream().anyMatch(item -> file.getFileName().equals(item.getFileName())
                || file.getFileName().equals(item.getName()));
            if (!found) {
                throw new IllegalArgumentException("Project cloud file not found: " + file.getFileName());
            }
            file.setFilePath(normalized);
        }
    }

    private Long createGroupMessage(ByaiGroupChatTask task, String content, String kind,
        List<GroupChatTaskFile> files, Long reservedMessageId) {
        Long messageId = reservedMessageId == null ? sequenceService.nextVal() : reservedMessageId;
        Date now = new Date();
        ByaiMessage message = new ByaiMessage();
        message.setId(messageId);
        message.setMessageId(messageId);
        message.setSessionId(task.getGroupSessionId());
        ByaiSession group = sessionService.findById(task.getGroupSessionId());
        message.setProjectId(group == null ? null : group.getProjectId());
        message.setMessageRef(task.getSourceMessageId());
        message.setMessageContent(StringUtils.defaultString(content));
        message.setCreatorId(task.getTargetAgentId());
        // 群任务回执和结果与普通群回复使用相同的发言者身份字段。
        message.setResComId(task.getTargetAgentId());
        SsResource agent = resourceService.findById(task.getTargetAgentId());
        message.setCreatorName(agent == null ? null : agent.getResourceName());
        message.setUsage(2);
        message.setIsComplete(true);
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("scene", "GROUP_CHAT");
        metadata.put("kind", kind);
        metadata.put("targetAgentId", task.getTargetAgentId());
        metadata.put("taskId", task.getTaskSessionId());
        metadata.put("sourceMessageId", task.getSourceMessageId());
        metadata.put("publisherUserId", "TASK_RESULT".equals(kind) ? CurrentUserHolder.getCurrentUserId() : null);
        metadata.put("files", files);
        message.setMetadata(JSON.toJSONString(metadata));
        message.setCreateTime(now);
        message.setUpdateTime(now);
        messageMapper.insert(message);

        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MESSAGE_CREATED");
        event.put("sessionId", String.valueOf(task.getGroupSessionId()));
        event.put("messageId", String.valueOf(messageId));
        event.put("messageRef", task.getSourceMessageId());
        event.put("replyToMessageId", task.getSourceMessageId());
        event.put("replyTo", buildReplySummary(task.getGroupSessionId(), task.getSourceMessageId()));
        event.put("targetAgentId", task.getTargetAgentId());
        event.put("taskId", String.valueOf(task.getTaskSessionId()));
        event.put("kind", kind);
        event.put("content", content);
        event.put("files", files);
        event.put("creatorId", task.getTargetAgentId());
        event.put("creatorName", message.getCreatorName());
        Map<String, Object> speaker = new HashMap<>();
        speaker.put("type", "AGENT");
        speaker.put("agentId", String.valueOf(task.getTargetAgentId()));
        speaker.put("agentName", message.getCreatorName());
        speaker.put("displayName", message.getCreatorName());
        event.put("speaker", speaker);
        publishAfterCommit(task.getGroupSessionId(), event);
        return messageId;
    }

    private Map<String, Object> buildReplySummary(Long sessionId, Long messageId) {
        ByaiMessage referenced = messageMapper.selectByMessageId(messageId);
        if (referenced == null || !sessionId.equals(referenced.getSessionId())) {
            return null;
        }
        Map<String, Object> reply = new HashMap<>();
        reply.put("messageId", referenced.getMessageId());
        reply.put("content", referenced.getMessageContent());
        reply.put("role", Integer.valueOf(1).equals(referenced.getUsage()) ? "USER" : "ASSISTANT");
        Map<String, Object> speaker = new HashMap<>();
        speaker.put("type", Integer.valueOf(1).equals(referenced.getUsage()) ? "USER" : "AGENT");
        speaker.put("displayName", referenced.getCreatorName());
        reply.put("speaker", speaker);
        return reply;
    }

    private void publishTaskEvent(ByaiGroupChatTask task, String eventName, Long messageId) {
        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", eventName);
        event.put("sessionId", String.valueOf(task.getGroupSessionId()));
        event.put("taskId", String.valueOf(task.getTaskSessionId()));
        event.put("taskName", task.getTaskName());
        event.put("status", task.getStatus());
        event.put("turnStatus", task.getTurnStatus());
        event.put("targetAgentId", task.getTargetAgentId());
        event.put("initiatorUserId", task.getInitiatorUserId());
        event.put("sourceMessageId", task.getSourceMessageId());
        event.put("messageId", messageId);
        publishAfterCommit(task.getGroupSessionId(), event);
    }

    private void publishAfterCommit(Long groupSessionId, JSONObject event) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            eventPublisher.publish(groupSessionId, event, null);
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                eventPublisher.publish(groupSessionId, event, null);
            }
        });
    }

    private GroupChatTaskPublicationResponse response(ByaiGroupChatTaskPublication publication) {
        GroupChatTaskPublicationResponse response = new GroupChatTaskPublicationResponse();
        response.setTaskId(publication.getTaskSessionId());
        response.setMessageId(publication.getMessageId());
        response.setText(publication.getTextContent());
        response.setFiles(JSON.parseArray(publication.getFilesJson(), GroupChatTaskFile.class));
        return response;
    }
}
