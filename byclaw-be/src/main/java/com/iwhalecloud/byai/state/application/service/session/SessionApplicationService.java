package com.iwhalecloud.byai.state.application.service.session;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import com.iwhalecloud.byai.common.message.qo.MessageHotDelQo;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.qo.session.ByaiSessionQo;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.state.domain.agent.service.SsSuperassistSubAgentService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.message.model.SessionOpeartorDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.infrastructure.utils.ChatUtils;
import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.common.feign.request.manager.AgentResourceChatInfoDto;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

/**
 * 会话管理增删改查
 *
 * @author me
 */
@Slf4j
@Service
public class SessionApplicationService {

    @Value("${thread.pool.core-size:10}")
    private int corePoolSize;

    @Value("${thread.pool.max-size:20}")
    private int maxPoolSize;

    @Value("${thread.pool.queue-capacity:100}")
    private int queueCapacity;

    @Value("${thread.pool.keep-alive-seconds:60}")
    private int keepAliveSeconds;

    private volatile ExecutorService threadPoolExecutor;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private SessionExtService sessionExtService;

    @Autowired
    private SessionMemberService sessionMemberService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;



    @Autowired
    private SsSuperassistSubAgentService ssSuperassistSubAgentService;

    /**
     * 初始化会话管理线程池 该线程池用于处理会话相关的异步操作，如异步更新会话内容等。 线程池配置说明： - 核心线程数：默认10个，保持常驻的线程数量 - 最大线程数：默认20个，当队列满时最多创建的线程数量 -
     * 队列容量：默认100个，用于缓存待执行的任务 - 线程存活时间：默认60秒，超过核心线程数的线程空闲多久后被回收 - 线程工厂：创建自定义命名的守护线程 -
     * 拒绝策略：CallerRunsPolicy，当线程池和队列都满时，由调用线程执行任务
     */
    @PostConstruct
    public void initThreadPool() {
        // 对队列容量进行上限检查，避免传入Integer.MAX_VALUE导致无界队列，防止内存溢出
        // 对队列容量进行严格校验，确保在合理范围内
        int safeQueueCapacity;
        if (queueCapacity <= 0 || queueCapacity >= 10000) {
            safeQueueCapacity = 1000; // 默认值
            log.warn("Invalid queue capacity: {}, using default: {}", queueCapacity, safeQueueCapacity);
        }
        else {
            safeQueueCapacity = queueCapacity;
        }
        // 自定义ThreadFactory，设置线程名称
        ThreadFactory threadFactory = new ThreadFactory() {
            private final AtomicInteger threadCount = new AtomicInteger(1);

            @Override
            public Thread newThread(Runnable r) {
                Thread thread = new Thread(r);
                thread.setName(String.format("updatesession-%d", threadCount.getAndIncrement()));
                thread.setDaemon(true);
                return thread;
            }
        };

        // 直接使用ThreadPoolExecutor创建线程池，确保线程池参数明确可控
        threadPoolExecutor = new ThreadPoolExecutor(corePoolSize, maxPoolSize, keepAliveSeconds, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(safeQueueCapacity), threadFactory, new ThreadPoolExecutor.CallerRunsPolicy());

        log.info("Session thread pool initialized with core size: {}, max size: {}, queue capacity: {}", corePoolSize,
            maxPoolSize, safeQueueCapacity);
    }

    /**
     * 优雅关闭会话管理线程池 该方法在Spring容器销毁时自动调用，确保线程池能够优雅地关闭。 关闭策略： 1. 首先调用shutdown()方法，停止接收新任务，但允许已提交的任务执行完成 2.
     * 等待最多60秒，让正在执行的任务完成 3. 如果60秒后仍有任务未完成，则调用shutdownNow()强制关闭 4. 如果等待过程中被中断，也会调用shutdownNow()强制关闭
     * 这种关闭策略既保证了数据完整性，又避免了应用关闭时线程池长时间等待
     */
    @PreDestroy
    public void shutdownThreadPool() {
        ExecutorService executor = threadPoolExecutor;
        if (executor != null) {
            synchronized (this) {
                if (threadPoolExecutor != null) {
                    executor = threadPoolExecutor;
                    threadPoolExecutor = null;
                }
            }
            try {
                executor.shutdown();
                // 等待最多60秒，让正在执行的任务完成
                if (!executor.awaitTermination(60, TimeUnit.SECONDS)) {
                    // 如果60秒后仍有任务未完成，强制关闭线程池
                    executor.shutdownNow();
                }
            }
            catch (InterruptedException e) {
                // 如果等待过程中被中断，强制关闭线程池
                executor.shutdownNow();
                // 恢复中断状态，确保上层调用者能够感知到中断
                Thread.currentThread().interrupt();
            }
            finally {
                // 确保线程池被关闭
                if (!executor.isShutdown()) {
                    executor.shutdownNow();
                }
            }
            log.info("Session thread pool shutdown completed");
        }
    }

    /**
     * 查询分话列表
     *
     * @param byaiSessionQo 入参
     * @return ResponseUtil
     */
    public PageInfo<ByaiSessionDto> qryConversations(ByaiSessionQo byaiSessionQo) {
        // 设置当前用户ID，确保只查询当前用户的会话
        byaiSessionQo.setCreatorId(CurrentUserHolder.getCurrentUserId());
        // 设置企业ID，确保只查询当前企业的会话
        byaiSessionQo.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        return sessionService.qryConversations(byaiSessionQo);
    }

    /**
     * 更新会话信息 该方法用于更新指定会话的基本信息，包括会话名称和会话内容。 更新策略： - 只更新非空的字段，避免覆盖现有数据 - 自动设置当前企业ID，确保数据隔离 - 支持部分字段更新，提高灵活性 可更新的字段： -
     * sessionId：会话唯一标识（必填） - sessionName：会话名称（可选） - sessionContent：会话内容（可选）
     *
     * @param sessionOpeartorDto 会话操作DTO，包含需要更新的会话信息
     * @return ResponseUtil 操作结果响应对象
     */
    public ByaiSession updateConversation(SessionOpeartorDto sessionOpeartorDto) {

        // 创建会话对象用于更新
        ByaiSession byaiSession = new ByaiSession();
        // 设置会话ID，这是更新的唯一标识
        byaiSession.setSessionId(sessionOpeartorDto.getSessionId());
        byaiSession.setSessionName(sessionOpeartorDto.getSessionName());
        // 如果会话内容不为空，则更新会话内容
        if (StringUtils.isNotBlank(sessionOpeartorDto.getSessionContent())) {
            byaiSession.setSessionContent(sessionOpeartorDto.getSessionContent());
        }

        // 设置当前企业ID，确保数据隔离和权限控制
        byaiSession.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        // 调用会话服务执行更新操作
        sessionService.update(byaiSession);

        return byaiSession;
    }

    /**
     * @param sessionOpeartorDto 异步更新会话，一般是更新messageContent
     */
    public void updateConversationAsync(SessionOpeartorDto sessionOpeartorDto) {
        ExecutorService executor = threadPoolExecutor;
        if (executor == null) {
            log.warn("Thread pool is not initialized, executing synchronously");
            updateConversation(sessionOpeartorDto);
            return;
        }
        executor.execute(() -> {
            updateConversation(sessionOpeartorDto);
        });
    }

    /**
     * 删除会话
     *
     * @param sessionId 会话标识
     */
    public void removeConversation(Long sessionId) {

        // 删除会话
        sessionService.delete(sessionId);

        // 删除会话扩展表
        sessionExtService.deleteSessionExtBySessionId(sessionId);

        // 删除群成员
        sessionMemberService.deleteBySessionId(sessionId);

        // 删除消息
        MessageHotDelQo messageHotDelQo = new MessageHotDelQo();
        messageHotDelQo.setSessionId(sessionId);
        byaiMessageHotService.deleteByQo(messageHotDelQo);

    }

    /**
     * 新建session实体 1.如果是@智能体的情况下,objectId就是智能体 2.没有@的情况下，objectId是助手
     *
     * @param assistantChatDto
     * @return
     */
    public ByaiSession getSession(AssistantChatDto assistantChatDto) {
        ByaiSession session = new ByaiSession();
        session.setSessionId(assistantChatDto.getSessionId());
        if (assistantChatDto.getAgentId() != null) {
            AgentResourceChatInfoDto pointAgent = ssSuperassistSubAgentService
                .getResourceAgent(DebugModeEnum.DEBUG_0.getNum(), assistantChatDto.getAgentId());
            if (pointAgent == null) {
                session.setSessionName(ChatUtils.truncateString(assistantChatDto.getChatContent(), 10));
            }
            else {
            session.setSessionName(ChatUtils.truncateString(pointAgent.getName(), 10));
            }
        }
        else {
            String chatContent = assistantChatDto.getChatContent();
            session.setSessionName(ChatUtils.truncateString(chatContent.replaceAll("\\{\\{.*?\\}\\}", ""), 10));
        }
        if (assistantChatDto.getAgentId() == null) {
            // 这个if里面其实没有用处的，设置助手ID没啥用
            // session.setObjectId(ConversationObjectType.SUPER_ASSISTANT);
            session.setObjectType(ConversationObjectType.SUPER_ASSISTANT);
        }
        else {
            session.setObjectId(assistantChatDto.getAgentId());
            session.setObjectType(ConversationObjectType.DIGITAL_EMPLOYEES);
        }
        return session;
    }

}
