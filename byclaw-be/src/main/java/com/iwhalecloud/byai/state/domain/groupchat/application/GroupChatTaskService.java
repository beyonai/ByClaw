package com.iwhalecloud.byai.state.domain.groupchat.application;

import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatRecallProjection;

import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.context.annotation.Lazy;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.beans.factory.annotation.Autowired;
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
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTaskPublication;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskPublicationMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.qo.resource.DirAndFileQo;
import com.iwhalecloud.byai.manager.vo.resource.DirAndFileVo;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatAgentMention;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatAgentMentionParser;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
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
    // Chat preparation depends on the task guard; defer resolving the reverse stop dependency.
    @Autowired
    @Lazy
    private AssistantChatApplicationService chatApplicationService;
    @Autowired
    private RunningOutputStreamRegistry runningRegistry;
    @Autowired
    private ChatRuntimeStateService chatRuntimeStateService;
    @Autowired
    private PlatformTransactionManager transactionManager;
    @Autowired
    private GroupChatTopicService topicService;
    @Autowired
    private ByaiGroupChatTurnMapper turnMapper;
    @Autowired
    private GroupChatAgentMentionParser mentionParser;
    @Autowired
    private GroupChatExecutionCoordinator executionCoordinator;
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
    private final DatasetApplicationService datasetService;
    private final GroupChatEventPublisher eventPublisher;
    private final GroupChatPendingPublicationStore pendingStore;
    private final GroupChatPublicationUploader publicationUploader;

    public GroupChatTaskService(ByaiGroupChatTaskMapper taskMapper,
        ByaiGroupChatTaskPublicationMapper publicationMapper, ByaiGroupChatExecutionMapper executionMapper,
        ByaiMessageMapper messageMapper, SequenceService sequenceService,
        GroupChatCandidateSessionService candidateSessionService,
        GroupChatTaskAuthorizationService taskAuthorizationService,
        GroupChatAuthorizationService groupAuthorizationService, SessionService sessionService,
        ProjectService projectService, SsResourceService resourceService, GroupChatEventPublisher eventPublisher,
        GroupChatPendingPublicationStore pendingStore, GroupChatPublicationUploader publicationUploader,
        DatasetApplicationService datasetService) {
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
        this.pendingStore = pendingStore;
        this.publicationUploader = publicationUploader;
        this.datasetService = datasetService;
    }

    @Transactional
    public ByaiGroupChatTask promote(ByaiGroupChatExecution execution, String taskName, String ackText) {
        sessionService.lockById(execution.getGroupSessionId());
        ByaiGroupChatTask existing = taskMapper.selectById(execution.getCandidateSessionId());
        if (existing != null) {
            return existing;
        }
        Date now = new Date();
        if ((execution instanceof ByaiGroupChatTurn
            ? turnMapper.decideDisposition(execution.getExecutionId(), "TASK", taskName, ackText, now)
            : executionMapper.decideDisposition(execution.getExecutionId(), "TASK", taskName, ackText, now)) != 1) {
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
        if (execution instanceof ByaiGroupChatTurn) {
            // The anchor still identifies direct task-entry turns after group scheduling has ended.
            executionMapper.decideDisposition(((ByaiGroupChatTurn) execution).getAnchorExecutionId(),
                "TASK", taskName, ackText, now);
        }
        candidateSessionService.promote(task.getTaskSessionId(), taskName);
        publishTaskEvent(task, "TASK_CREATED", null);
        if (StringUtils.isNotBlank(ackText)) {
            Long messageId = createGroupMessage(task, ackText, "TASK_ACK", null, null, null);
            if (execution instanceof ByaiGroupChatTurn) { turnMapper.setAckMessage(execution.getExecutionId(), messageId); }
            else { executionMapper.setAckMessage(execution.getExecutionId(), messageId); }
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
        ByaiGroupChatTask task = taskAuthorizationService.requireTask(taskId);
        // 先锁群再锁任务，与解散工作组的顺序一致，避免发布与解散并发。
        sessionService.lockById(task.getGroupSessionId());
        taskAuthorizationService.requireInitiator(taskId);
        // 文件转存及最终提交共用任务行锁；继续对话、取消和替换必须等待本次发布结束。
        task = taskMapper.selectForUpdate(taskId);
        Long pendingId = request == null ? null : request.getPendingPublicationId();
        if (pendingId != null && (request.getText() != null
            || (request.getFiles() != null && !request.getFiles().isEmpty()))) {
            throw new IllegalArgumentException("Confirm with pendingPublicationId only; text/files cannot be overridden");
        }
        ByaiGroupChatTaskPublication existing = publicationMapper.selectById(taskId);
        if (existing != null) {
            if (pendingId != null && !pendingId.equals(existing.getPendingPublicationId())) {
                throw new IllegalArgumentException("Pending publication is outdated");
            }
            return response(existing);
        }
        if (task == null || !"ACTIVE".equals(task.getStatus()) || "RUNNING".equals(task.getTurnStatus())) {
            throw new IllegalArgumentException("Task is not ready for publication");
        }
        List<GroupChatTaskFile> files = request == null || request.getFiles() == null
            ? Collections.emptyList() : request.getFiles();
        String text = request == null ? null : StringUtils.trimToNull(request.getText());
        if (pendingId != null) {
            ByaiGroupChatPendingPublication pending = pendingStore.find(taskId);
            if (pending == null || !pendingId.equals(pending.getPendingPublicationId())) {
                throw new IllegalArgumentException("Pending publication is outdated; refresh the current card");
            }
            text = pending.getTextContent();
            List<String> sources = JSON.parseArray(pending.getSourceFilesJson(), String.class);
            files = sources.isEmpty() ? Collections.emptyList()
                : publicationUploader.upload(pending, projectCloudResourceId(task));
        }
        if (StringUtils.isBlank(text) && files.isEmpty()) {
            throw new IllegalArgumentException("Published task result requires text or files");
        }
        validateCloudFiles(task, files);
        // 只解析最终确认发布的正文，不能使用任务过程答复或未确认的交付内容触发委派。
        GroupChatAgentMention mentions = mentionParser.parse(task.getGroupSessionId(), task.getTargetAgentId(), text);
        text = mentions.normalizedContent();
        Long messageId = sequenceService.nextVal();
        ByaiGroupChatTaskPublication publication = new ByaiGroupChatTaskPublication();
        publication.setTaskSessionId(taskId);
        publication.setPendingPublicationId(pendingId);
        publication.setGroupSessionId(task.getGroupSessionId());
        publication.setMessageId(messageId);
        publication.setPublisherUserId(CurrentUserHolder.getCurrentUserId());
        publication.setTextContent(text);
        publication.setFilesJson(JSON.toJSONString(files));
        publication.setCreateTime(new Date());
        publicationMapper.insert(publication);
        createGroupMessage(task, text, "TASK_RESULT", files, messageId, mentions);
        if (taskMapper.publish(taskId, messageId, publication.getPublisherUserId(), new Date()) != 1) {
            throw new IllegalStateException("Task publication state changed concurrently");
        }
        task.setStatus("PUBLISHED");
        task.setPublishMessageId(messageId);
        task.setPublishBy(publication.getPublisherUserId());
        scheduleResultMentions(task, mentions, messageId);
        pendingStore.clear(task, messageId);
        publishTaskEvent(task, "TASK_PUBLISHED", messageId);
        return response(publication);
    }

    private void scheduleResultMentions(ByaiGroupChatTask task, GroupChatAgentMention mentions, Long messageId) {
        List<ResourceVo> agents = mentions.resourceList().stream()
            .filter(resource -> resource.getResourceType() == AgentMetaEnum.DIG_EMPLOYEE).toList();
        if (agents.isEmpty()) {
            return;
        }
        // 保留原始 turn 的委派链和 hop 预算；旧任务则沿用会话执行记录。
        ByaiGroupChatExecution parent = turnMapper.selectById(task.getDispatchId());
        if (parent == null || !Objects.equals(parent.getCandidateSessionId(), task.getTaskSessionId())) {
            parent = executionMapper.selectByCandidateSessionId(task.getTaskSessionId());
        }
        if (parent == null) {
            throw new IllegalStateException("Task publication cannot resolve its execution: " + task.getTaskSessionId());
        }
        // 与成果发布共用事务和公开消息边界；回滚不留委派，重复确认在入口直接返回已有成果。
        for (ResourceVo agent : agents) {
            executionCoordinator.enqueueChild(parent, Long.valueOf(agent.getResourceId()), messageId, messageId,
                mentions.normalizedContent(), mentions.resourceList());
        }
    }

    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void cancel(Long taskId) {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        ByaiGroupChatTask task = transaction.execute(status -> {
            ByaiGroupChatTask current = requireActiveCancellation(taskId);
            if (!"RUNNING".equals(current.getTurnStatus())) {
                finishCancellation(current);
                return null;
            }
            return current;
        });
        if (task == null) {
            return;
        }
        // stopChat suspends transactions and can synchronously project persisted turns in REQUIRES_NEW.
        // Release our validation lock first, otherwise that callback waits on the suspended task lock.
        StopChatDto request = cancellationRequest(task);
        chatApplicationService.stopChat(request);
        transaction.executeWithoutResult(status -> {
            // Stop is external and cannot roll back; recheck authorization/state after its callbacks finish.
            ByaiGroupChatTask current = requireActiveCancellation(taskId);
            if ("RUNNING".equals(current.getTurnStatus())) {
                StopChatDto latest = cancellationRequest(current);
                if ((latest.getMessageId() != null && !Objects.equals(latest.getMessageId(), request.getMessageId()))
                    || (StringUtils.isNotBlank(latest.getTraceId())
                        && !Objects.equals(latest.getTraceId(), request.getTraceId()))) {
                    throw new IllegalArgumentException("Task started a new turn; retry cancellation");
                }
            }
            finishCancellation(current);
        });
    }

    private void finishCancellation(ByaiGroupChatTask task) {
        if (taskMapper.cancel(task.getTaskSessionId(), new Date()) != 1) {
            throw new IllegalArgumentException("Task is no longer active");
        }
        task.setStatus("CANCELLED");
        pendingStore.clear(task, null);
        publishTaskEvent(task, "TASK_STATUS_CHANGED", null);
    }

    private ByaiGroupChatTask requireActiveCancellation(Long taskId) {
        taskAuthorizationService.requireCanceller(taskId);
        ByaiGroupChatTask task = taskMapper.selectForUpdate(taskId);
        if (task == null || !"ACTIVE".equals(task.getStatus())) {
            throw new IllegalArgumentException("Task is no longer active");
        }
        return task;
    }

    private StopChatDto cancellationRequest(ByaiGroupChatTask task) {
        Long sessionId = task.getTaskSessionId();
        RunningChatInfo running = runningRegistry.getRunning(sessionId);
        ChatRuntimeState runtime = chatRuntimeStateService.get(sessionId);
        // Durable runtime survives expiry of the short-lived registry, including Agent handoff identity.
        AssistantChatDto assistant = runtime == null ? null : runtime.getAssistantChatDto();
        StopChatDto request = new StopChatDto();
        request.setSessionId(sessionId);
        request.setAgentId(running != null && running.getAgentId() != null ? running.getAgentId()
            : assistant != null && assistant.getAgentId() != null ? assistant.getAgentId() : task.getTargetAgentId());
        request.setAgentCode(StringUtils.defaultIfBlank(running == null ? null : running.getAgentCode(),
            assistant == null ? null : assistant.getAgentCode()));
        request.setMessageId(running != null && running.getModelAnswerMessageId() != null
            ? running.getModelAnswerMessageId() : runtime == null ? null : runtime.getModelAnswerMessageId());
        request.setTraceId(StringUtils.defaultIfBlank(running == null ? null : running.getTraceId(),
            runtime == null ? null : runtime.getTraceId()));
        request.setLaneId(StringUtils.defaultIfBlank(running == null ? null : running.getLaneId(),
            assistant == null ? null : assistant.getLaneId()));
        request.setClientRequestId(StringUtils.defaultIfBlank(running == null ? null : running.getClientRequestId(),
            runtime == null ? null : runtime.getClientRequestId()));
        return request;
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

    private Long projectCloudResourceId(ByaiGroupChatTask task) {
        ByaiSession group = sessionService.findById(task.getGroupSessionId());
        Project project = group == null ? null : projectService.findById(group.getProjectId());
        if (project == null || project.getCloudResourceId() == null) {
            throw new IllegalArgumentException("Group project cloud drive is unavailable");
        }
        return project.getCloudResourceId();
    }

    private void validateCloudFiles(ByaiGroupChatTask task, List<GroupChatTaskFile> files) {
        if (files.isEmpty()) {
            return;
        }
        Long cloudResourceId = projectCloudResourceId(task);
        for (GroupChatTaskFile file : files) {
            if (file == null || StringUtils.isBlank(file.getFileName()) || StringUtils.isBlank(file.getFilePath())
                || file.getFilePath().contains("..") || file.getFilePath().contains("\\")) {
                throw new IllegalArgumentException("Invalid project cloud file reference");
            }
            String normalized = file.getFilePath().startsWith("/") ? file.getFilePath() : "/" + file.getFilePath();
            int slash = normalized.lastIndexOf('/');
            if (!normalized.substring(slash + 1).equals(file.getFileName())) {
                throw new IllegalArgumentException("File name does not match project cloud path");
            }
            String directory = slash <= 0 ? "/" : normalized.substring(0, slash);
            DirAndFileQo query = new DirAndFileQo();
            query.setResourceId(cloudResourceId);
            query.setDirectoryPath(directory);
            query.setKeyword(file.getFileName());
            // 与文件上传共用知识库目录服务，按项目云盘路径查询，避免进入旧 catalogId SQL。
            List<DirAndFileVo> matches = datasetService.queryDirAndFileByLevel(query);
            boolean found = matches != null && matches.stream().anyMatch(item -> !"directory".equals(item.getType())
                && (file.getFileName().equals(item.getFileName()) || file.getFileName().equals(item.getName())));
            if (!found) {
                throw new IllegalArgumentException("Project cloud file not found: " + file.getFileName());
            }
            file.setFilePath(normalized);
            file.setCloudResourceId(String.valueOf(cloudResourceId));
        }
    }

    private Long createGroupMessage(ByaiGroupChatTask task, String content, String kind,
        List<GroupChatTaskFile> files, Long reservedMessageId, GroupChatAgentMention mentions) {
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
        if (mentions != null) {
            metadata.put("resourceList", mentions.resourceList());
        }
        message.setMetadata(JSON.toJSONString(metadata));
        message.setCreateTime(now);
        message.setUpdateTime(now);
        topicService.persistMessage(message);

        JSONObject event = new JSONObject();
        event.put("type", "GROUP_CHAT_EVENT");
        event.put("event", "MESSAGE_CREATED");
        event.put("sessionId", String.valueOf(task.getGroupSessionId()));
        event.put("messageId", String.valueOf(messageId));
        event.put("topicId", String.valueOf(message.getTopicId()));
        event.put("messageRef", task.getSourceMessageId());
        event.put("replyToMessageId", task.getSourceMessageId());
        event.put("replyTo", buildReplySummary(task.getGroupSessionId(), task.getSourceMessageId()));
        event.put("targetAgentId", task.getTargetAgentId());
        event.put("taskId", String.valueOf(task.getTaskSessionId()));
        // 与 context 历史消息保持相同字段和字符串 ID 类型。
        event.put("initiatorUserId", task.getInitiatorUserId() == null ? null : String.valueOf(task.getInitiatorUserId()));
        event.put("kind", kind);
        event.put("content", content);
        if (mentions != null) {
            event.put("resourceList", mentions.resourceList());
        }
        event.put("files", files);
        // 任务回执不携带文件，附件统一返回空数组；有附件时沿用历史查询结构以保留 ID 精度。
        event.put("attachments", files == null ? Collections.emptyList() : files.stream().map(file -> {
            GroupChatContextResponse.Attachment attachment = new GroupChatContextResponse.Attachment();
            attachment.setFileId(file.getFileId() == null ? null : String.valueOf(file.getFileId()));
            attachment.setFileName(file.getFileName());
            attachment.setFilePath(file.getFilePath());
            attachment.setCloudResourceId(file.getCloudResourceId());
            return attachment;
        }).toList());
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
        reply.put("content", GroupChatRecallProjection.referenceContent(referenced));
        reply.put("recalled", referenced.isRecalled());
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
        response.setPendingPublicationId(publication.getPendingPublicationId());
        response.setMessageId(publication.getMessageId());
        response.setText(publication.getTextContent());
        response.setFiles(JSON.parseArray(publication.getFilesJson(), GroupChatTaskFile.class));
        return response;
    }
}
