package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import java.util.List;
import java.util.Objects;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.TraceIdCodec;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.message.enums.MsgStatus;

/** 补偿已落库但完成通知未投影的任务轮次；不推断历史任务或后台 Agent 的状态。 */
@Service
public class GroupChatTaskTurnRecoveryService {
    private static final Logger log = LoggerFactory.getLogger(GroupChatTaskTurnRecoveryService.class);
    private final ByaiGroupChatTaskMapper taskMapper;
    private final ByaiMessageMapper messageMapper;
    private final GroupChatTaskService taskService;
    @Value("${byclaw.group-chat.scan-batch-size:100}")
    private int batchSize = 100;
    private long cursor;

    public GroupChatTaskTurnRecoveryService(ByaiGroupChatTaskMapper taskMapper, ByaiMessageMapper messageMapper,
        GroupChatTaskService taskService) {
        this.taskMapper = taskMapper;
        this.messageMapper = messageMapper;
        this.taskService = taskService;
    }

    @Scheduled(fixedDelayString = "${byclaw.group-chat.completion-recovery-ms:30000}")
    public void recover() {
        List<ByaiGroupChatTask> tasks = taskMapper.selectBoundRunningPage(cursor, batchSize);
        cursor = tasks.size() < batchSize ? 0 : tasks.get(tasks.size() - 1).getTaskSessionId();
        for (ByaiGroupChatTask task : tasks) {
            try {
                reconcile(task);
            }
            catch (RuntimeException error) {
                log.warn("Group task turn recovery failed: taskSessionId={}, turnId={}, traceId={}",
                    task.getTaskSessionId(), task.getCurrentTurnId(), task.getCurrentTurnTraceId(), error);
            }
        }
    }

    private void reconcile(ByaiGroupChatTask task) {
        String traceId = task.getCurrentTurnTraceId();
        if (task.getCurrentTurnId() == null || !TraceIdCodec.canDecode(traceId)) return;
        ByaiMessage answer = messageMapper.selectByMessageId(TraceIdCodec.decode(traceId).getModelAnswerMessageId());
        if (answer == null || !Objects.equals(answer.getSessionId(), task.getTaskSessionId())
            || !Integer.valueOf(2).equals(answer.getUsage())
            || !(Boolean.TRUE.equals(answer.getIsComplete()) || MsgStatus.FINISH.getCode().equals(answer.getMsgStatus()))) {
            return;
        }
        boolean failed = StringUtils.isNotBlank(answer.getMetadata())
            && JSON.parseObject(answer.getMetadata()).getBooleanValue("turnFailed");
        // 扫描之后用户可能已开启下一轮，最终更新仍由数据库校验 trace。
        taskService.completeTurn(task.getTaskSessionId(), traceId, failed);
    }
}
