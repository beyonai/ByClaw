package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.Date;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** 为每次 Agent mention 建立隔离的候选会话，TASK 时该会话直接成为任务。 */
@Service
public class GroupChatCandidateSessionService {
    private final SessionService sessionService;
    private final SessionExtService sessionExtService;
    private final ByaiMessageMapper messageMapper;
    private final SequenceService sequenceService;

    public GroupChatCandidateSessionService(SessionService sessionService, SessionExtService sessionExtService,
        ByaiMessageMapper messageMapper, SequenceService sequenceService) {
        this.sessionService = sessionService;
        this.sessionExtService = sessionExtService;
        this.messageMapper = messageMapper;
        this.sequenceService = sequenceService;
    }

    public Long create(Long groupSessionId, Long sourceMessageId, Long initiatorUserId, Long targetAgentId) {
        ByaiSession group = sessionService.findById(groupSessionId);
        ByaiMessage source = messageMapper.selectByMessageId(sourceMessageId);
        if (group == null || source == null) {
            throw new IllegalArgumentException("Group message is unavailable");
        }
        Date now = new Date();
        Long sessionId = sequenceService.nextVal();
        ByaiSession candidate = new ByaiSession();
        candidate.setSessionId(sessionId);
        candidate.setParentSessionId(groupSessionId);
        candidate.setProjectId(group.getProjectId());
        candidate.setCreatorId(initiatorUserId);
        candidate.setEnterpriseId(group.getEnterpriseId());
        candidate.setObjectId(targetAgentId);
        candidate.setSessionType(SessionType.H_AS.getCode());
        candidate.setSessionName("Group task candidate");
        candidate.setState("GROUP_TASK_CANDIDATE");
        candidate.setCreateTime(now);
        candidate.setUpdateTime(now);
        sessionService.save(candidate);

        saveExt(sessionId, "group_source_session_id", String.valueOf(groupSessionId));
        saveExt(sessionId, "group_source_boundary_message_id", String.valueOf(sourceMessageId));
        saveExt(sessionId, "group_source_message_id", String.valueOf(sourceMessageId));

        ByaiMessage childMessage = new ByaiMessage();
        Long childMessageId = sequenceService.nextVal();
        childMessage.setId(childMessageId);
        childMessage.setMessageId(childMessageId);
        childMessage.setSessionId(sessionId);
        childMessage.setProjectId(group.getProjectId());
        childMessage.setCreatorId(initiatorUserId);
        childMessage.setCreatorName(source.getCreatorName());
        childMessage.setMessageContent(source.getMessageContent());
        childMessage.setUsage(1);
        childMessage.setIsComplete(true);
        JSONObject metadata = new JSONObject();
        metadata.put("scene", "GROUP_TASK");
        // 子会话保留原文中的成员占位符，必须同时保留完整资源列表供历史消息渲染。
        JSONObject sourceMetadata = StringUtils.isBlank(source.getMetadata())
            ? null : JSON.parseObject(source.getMetadata());
        if (sourceMetadata != null && sourceMetadata.containsKey("resourceList")) {
            metadata.put("resourceList", sourceMetadata.get("resourceList"));
        }
        childMessage.setMetadata(metadata.toJSONString());
        childMessage.setCreateTime(now);
        childMessage.setUpdateTime(now);
        messageMapper.insert(childMessage);
        return sessionId;
    }

    public void promote(Long sessionId, String taskName) {
        ByaiSession session = sessionService.findById(sessionId);
        if (session == null) {
            throw new IllegalArgumentException("Candidate session not found");
        }
        session.setState("GROUP_TASK");
        session.setSessionName(taskName);
        sessionService.update(session);
    }

    public void hideChatCandidate(Long sessionId) {
        ByaiSession session = sessionService.findById(sessionId);
        if (session != null) {
            session.setState("GROUP_CHAT_DISPATCH");
            sessionService.update(session);
        }
    }

    private void saveExt(Long sessionId, String code, String value) {
        ByaiSessionExt ext = new ByaiSessionExt();
        ext.setExtId(sequenceService.nextVal());
        ext.setSessionId(sessionId);
        ext.setExtParamCode(code);
        ext.setExtParamValue(value);
        sessionExtService.save(ext);
    }
}
