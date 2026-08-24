package com.iwhalecloud.byai.manager.domain.project.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.domain.project.entity.ProjectInitTask;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 项目初始化异步任务管理服务
 *
 * 使用 Redis 存储任务状态，支持多实例部署
 */
@Slf4j
@Service
public class ProjectInitTaskManager {

    private static final String TASK_KEY_PREFIX = "project:init:task:";
    private static final long TASK_EXPIRE_HOURS = 24; // 任务状态保留 24 小时

    @Autowired
    private ObjectMapper objectMapper;

    /**
     * 创建新任务
     *
     * @param userId 用户ID
     * @param requestId 请求ID
     * @param repoPath 仓库路径
     * @param skillPackage 技能包名称
     * @return 任务ID
     */
    public String createTask(String userId, String requestId, String repoPath, String skillPackage) {
        String taskId = UUID.randomUUID().toString();

        ProjectInitTask task = ProjectInitTask.builder()
            .taskId(taskId)
            .requestId(requestId)
            .userId(userId)
            .repoPath(repoPath)
            .skillPackage(skillPackage)
            .status("PENDING")
            .currentStep("Initializing")
            .progress(0)
            .createTime(LocalDateTime.now())
            .updateTime(LocalDateTime.now())
            .expireTime(LocalDateTime.now().plusHours(TASK_EXPIRE_HOURS))
            .build();

        saveTask(task);
        log.info("Created async task: taskId={}, repoPath={}", taskId, repoPath);

        return taskId;
    }

    /**
     * 更新任务状态
     *
     * @param taskId 任务ID
     * @param status 新状态
     * @param currentStep 当前步骤
     * @param progress 进度（0-100）
     */
    public void updateTaskStatus(String taskId, String status, String currentStep, Integer progress) {
        ProjectInitTask task = getTask(taskId);
        if (task == null) {
            log.warn("Task not found for update: {}", taskId);
            return;
        }

        task.setStatus(status);
        task.setCurrentStep(currentStep);
        task.setProgress(progress);
        task.setUpdateTime(LocalDateTime.now());

        if ("SUCCESS".equals(status) || "FAILED".equals(status)) {
            task.setCompleteTime(LocalDateTime.now());
        }

        saveTask(task);
        log.debug("Updated task status: taskId={}, status={}, progress={}%", taskId, status, progress);
    }

    /**
     * 更新任务错误信息
     *
     * @param taskId 任务ID
     * @param errorMessage 错误信息
     */
    public void updateTaskError(String taskId, String errorMessage) {
        ProjectInitTask task = getTask(taskId);
        if (task == null) {
            log.warn("Task not found for error update: {}", taskId);
            return;
        }

        task.setStatus("FAILED");
        task.setErrorMessage(truncateErrorMessage(errorMessage));
        task.setCompleteTime(LocalDateTime.now());
        task.setUpdateTime(LocalDateTime.now());

        saveTask(task);
        log.info("Updated task error: taskId={}", taskId);
    }

    /**
     * 更新任务结果
     *
     * @param taskId 任务ID
     * @param result 结果对象（将被序列化为 JSON）
     */
    public void updateTaskResult(String taskId, Object result) {
        ProjectInitTask task = getTask(taskId);
        if (task == null) {
            log.warn("Task not found for result update: {}", taskId);
            return;
        }

        try {
            task.setStatus("SUCCESS");
            task.setResult(objectMapper.writeValueAsString(result));
            task.setProgress(100);
            task.setCompleteTime(LocalDateTime.now());
            task.setUpdateTime(LocalDateTime.now());

            saveTask(task);
            log.info("Updated task result: taskId={}", taskId);

        } catch (JsonProcessingException e) {
            log.error("Failed to serialize task result: taskId={}", taskId, e);
            updateTaskError(taskId, "Failed to serialize result: " + e.getMessage());
        }
    }

    /**
     * 获取任务状态
     *
     * @param taskId 任务ID
     * @return 任务对象，如果不存在则返回 null
     */
    public ProjectInitTask getTask(String taskId) {
        String key = TASK_KEY_PREFIX + taskId;
        String json = RedisUtil.getString(key);

        if (json == null) {
            return null;
        }

        try {
            return objectMapper.readValue(json, ProjectInitTask.class);
        } catch (JsonProcessingException e) {
            log.error("Failed to deserialize task: taskId={}", taskId, e);
            return null;
        }
    }

    /**
     * 删除任务
     *
     * @param taskId 任务ID
     */
    public void deleteTask(String taskId) {
        String key = TASK_KEY_PREFIX + taskId;
        RedisUtil.del(key);
        log.debug("Deleted task: taskId={}", taskId);
    }

    /**
     * 保存任务到 Redis
     */
    private void saveTask(ProjectInitTask task) {
        String key = TASK_KEY_PREFIX + task.getTaskId();

        try {
            String json = objectMapper.writeValueAsString(task);
            RedisUtil.setStringExp(key, json, TASK_EXPIRE_HOURS, TimeUnit.HOURS);
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize task: taskId={}", task.getTaskId(), e);
        }
    }

    /**
     * 截断错误信息（最多保留 1000 字符）
     */
    private String truncateErrorMessage(String errorMessage) {
        if (errorMessage == null) {
            return null;
        }
        if (errorMessage.length() <= 1000) {
            return errorMessage;
        }
        return errorMessage.substring(0, 1000) + "... (truncated)";
    }
}
