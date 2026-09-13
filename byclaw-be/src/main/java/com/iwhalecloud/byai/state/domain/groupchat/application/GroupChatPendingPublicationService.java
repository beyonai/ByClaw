package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.Date;
import java.util.List;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatPendingPublication;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatPendingPublicationRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatPendingPublicationResponse;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** prepare_group_task_publication 的 BE 用例；准备内容不上传、不发布，也不结束 Agent turn。 */
@Service
public class GroupChatPendingPublicationService {
    private final GroupChatTaskAuthorizationService authorization;
    private final ByaiGroupChatTaskMapper tasks;
    private final GroupChatPendingPublicationStore store;
    private final SequenceService sequence;

    public GroupChatPendingPublicationService(GroupChatTaskAuthorizationService authorization,
        ByaiGroupChatTaskMapper tasks, GroupChatPendingPublicationStore store, SequenceService sequence) {
        this.authorization = authorization;
        this.tasks = tasks;
        this.store = store;
        this.sequence = sequence;
    }

    public GroupChatPendingPublicationResponse current(Long taskId) {
        ByaiGroupChatTask task = authorization.requireInitiator(taskId);
        return "ACTIVE".equals(task.getStatus()) ? store.response(store.find(taskId)) : null;
    }

    @Transactional
    public GroupChatPendingPublicationResponse prepare(Long taskId, GroupChatPendingPublicationRequest request) {
        authorization.requireInitiator(taskId);
        ByaiGroupChatTask task = tasks.selectForUpdate(taskId);
        if (task == null || !"ACTIVE".equals(task.getStatus())) {
            throw new IllegalArgumentException("Task is not active");
        }
        String text = request == null ? null : StringUtils.trimToNull(request.getText());
        List<String> paths = request == null || request.getSourcePaths() == null ? List.of()
            : request.getSourcePaths().stream().map(GroupChatPublicationUploader::validateSourcePath).distinct().toList();
        if (text == null && paths.isEmpty()) {
            throw new IllegalArgumentException("Pending publication requires text or files");
        }
        ByaiGroupChatPendingPublication pending = new ByaiGroupChatPendingPublication();
        pending.setTaskSessionId(taskId);
        pending.setPendingPublicationId(sequence.nextVal());
        pending.setTextContent(text);
        pending.setSourceFilesJson(JSON.toJSONString(paths));
        pending.setUploadedFilesJson("{}");
        pending.setCreateTime(new Date());
        store.replace(task, pending);
        return store.response(pending);
    }
}
