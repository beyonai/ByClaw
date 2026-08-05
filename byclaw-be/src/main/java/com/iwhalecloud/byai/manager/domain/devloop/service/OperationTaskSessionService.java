package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionExtMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 运营任务会话领域服务。
 *
 * 运营任务不再使用独立任务表，而是以 byai_session.session_id 作为任务 ID，
 * 任务业务字段保存到带 oploop_ 前缀的会话扩展参数中，避免和研发会话扩展字段冲突。
 */
@Service
public class OperationTaskSessionService {

    public static final String EXT_SOURCE_ID = "oploop_source_id";
    public static final String EXT_STATUS = "oploop_task_status";
    public static final String EXT_ASSIGNEE_ID = "oploop_assignee_id";
    public static final String EXT_DESCRIPTION = "oploop_task_description";
    public static final String EXT_DUE_TIME = "oploop_due_time";
    public static final String EXT_OPERATION_TYPE = "oploop_operation_type";
    public static final String EXT_CONFIG = "oploop_task_config";
    public static final String EXT_AGENT_SELECTION = "oploop_agent_selection";
    public static final String EXT_WORKFLOW = "oploop_workflow";
    public static final String EXT_TRIGGER_TIME = "oploop_trigger_time";
    public static final String EXT_SCHEDULE_RUN_ID = "oploop_schedule_run_id";

    /** 运营任务统一状态，需求是否启动由是否存在任务会话推导，不单独落需求状态。 */
    public static final String STATUS_PENDING = "pending";
    public static final String STATUS_RUNNING = "running";
    public static final String STATUS_DONE = "done";
    public static final String STATUS_FAILED = "failed";

    @Autowired
    private ByaiSessionMapper byaiSessionMapper;

    @Autowired
    private ByaiSessionExtMapper byaiSessionExtMapper;

    @Autowired
    private ByaiSessionMemberMapper byaiSessionMemberMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 按运营任务筛选条件分页查询会话。扩展参数通过 EXISTS 查询避免研发会话混入。 */
    public Page<ByaiSession> pageByProjectId(Long projectId, Long assignee, String keyword, Date createTimeStart,
        Date createTimeEnd, String status, int pageNum, int pageSize) {
        LambdaQueryWrapper<ByaiSession> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ByaiSession::getProjectId, projectId)
            .and(query -> query.isNull(ByaiSession::getState).or().ne(ByaiSession::getState, "DELETED"))
            .apply(operationTaskExistsSql(OperationTaskSessionService.EXT_SOURCE_ID, null));
        if (assignee != null) {
            wrapper.apply(operationTaskExistsSql(EXT_ASSIGNEE_ID, String.valueOf(assignee)));
        }
        if (StringUtils.isNotBlank(status)) {
            wrapper.apply(operationTaskExistsSql(EXT_STATUS, status.trim()));
        }
        if (createTimeStart != null) {
            wrapper.ge(ByaiSession::getCreateTime, createTimeStart);
        }
        if (createTimeEnd != null) {
            wrapper.le(ByaiSession::getCreateTime, createTimeEnd);
        }
        String normalizedKeyword = StringUtils.trimToNull(keyword);
        if (normalizedKeyword != null) {
            // PostgreSQL 的 LIKE 区分大小写，运营任务搜索统一忽略大小写。
            wrapper.apply("LOWER(session_name) LIKE {0}", "%" + normalizedKeyword.toLowerCase(java.util.Locale.ROOT)
                + "%");
        }
        wrapper.orderByDesc(ByaiSession::getCreateTime).orderByDesc(ByaiSession::getSessionId);
        return byaiSessionMapper.selectPage(new Page<>(pageNum, pageSize), wrapper);
    }

    /** 查询单个运营任务会话；研发会话即使 ID 相同也不会被误识别。 */
    public ByaiSession findById(Long sessionId) {
        ByaiSession session = sessionId == null ? null : byaiSessionMapper.selectById(sessionId);
        return session != null && isOperationTask(session.getSessionId()) ? session : null;
    }

    /** 查询需求下是否已经创建过运营任务，用于推导需求状态和禁止编辑。 */
    public boolean existsBySourceId(Long sourceId) {
        if (sourceId == null) {
            return false;
        }
        LambdaQueryWrapper<ByaiSessionExt> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ByaiSessionExt::getExtParamCode, EXT_SOURCE_ID)
            .eq(ByaiSessionExt::getExtParamValue, String.valueOf(sourceId));
        return byaiSessionExtMapper.selectCount(wrapper) > 0;
    }

    /** 查询需求下的任务会话，用于周期任务模板和需求详情展示。 */
    public List<ByaiSession> listBySourceId(Long sourceId) {
        if (sourceId == null) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<ByaiSession> wrapper = new LambdaQueryWrapper<>();
        wrapper.apply(operationTaskExistsSql(EXT_SOURCE_ID, String.valueOf(sourceId)))
            .orderByAsc(ByaiSession::getCreateTime).orderByAsc(ByaiSession::getSessionId);
        return byaiSessionMapper.selectList(wrapper);
    }

    /** 读取单个任务的全部扩展参数，按编码返回，便于应用层构造接口响应和提示词上下文。 */
    public Map<String, String> getExtValues(Long sessionId) {
        if (sessionId == null) {
            return Collections.emptyMap();
        }
        List<ByaiSessionExt> extList = byaiSessionExtMapper.selectList(
            new LambdaQueryWrapper<ByaiSessionExt>().eq(ByaiSessionExt::getSessionId, sessionId));
        Map<String, String> values = new LinkedHashMap<>();
        for (ByaiSessionExt ext : extList) {
            if (StringUtils.isNotBlank(ext.getExtParamCode())) {
                values.put(ext.getExtParamCode(), ext.getExtParamValue());
            }
        }
        return values;
    }

    /** 保存运营任务的整组扩展参数；键名统一使用 oploop_ 前缀，避免污染研发会话扩展。 */
    public void saveTaskExtensions(Long sessionId, Map<String, String> values) {
        if (values == null || values.isEmpty()) {
            return;
        }
        values.forEach((code, value) -> saveOrUpdateExt(sessionId, code, code, value));
    }

    /** 更新任务状态及执行编排信息，所有字段都落在会话扩展表，不修改研发会话业务字段。 */
    public void updateTaskState(Long sessionId, String status, String agentSelection, String workflow) {
        saveOrUpdateExt(sessionId, EXT_STATUS, EXT_STATUS, status);
        if (agentSelection != null) {
            saveOrUpdateExt(sessionId, EXT_AGENT_SELECTION, EXT_AGENT_SELECTION, agentSelection);
        }
        if (workflow != null) {
            saveOrUpdateExt(sessionId, EXT_WORKFLOW, EXT_WORKFLOW, workflow);
        }
    }

    /** 运营任务删除前的状态校验，只有待执行任务允许物理删除。 */
    public boolean isPending(Long sessionId) {
        return STATUS_PENDING.equals(getExtValues(sessionId).get(EXT_STATUS));
    }

    /** 读取运营任务关联的需求源 ID，删除和提示词查询均必须经过该标识隔离研发会话。 */
    public Long getSourceId(Long sessionId) {
        String value = getExtValues(sessionId).get(EXT_SOURCE_ID);
        if (StringUtils.isBlank(value)) {
            return null;
        }
        try {
            return Long.valueOf(value);
        }
        catch (NumberFormatException exception) {
            return null;
        }
    }

    /** 新增或更新扩展参数；同一任务和编码始终只保留一条逻辑记录。 */
    public void saveOrUpdateExt(Long sessionId, String code, String name, String value) {
        if (sessionId == null || StringUtils.isBlank(code) || value == null) {
            return;
        }
        LambdaQueryWrapper<ByaiSessionExt> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ByaiSessionExt::getSessionId, sessionId).eq(ByaiSessionExt::getExtParamCode, code);
        ByaiSessionExt existing = byaiSessionExtMapper.selectOne(wrapper);
        if (existing == null) {
            ByaiSessionExt ext = new ByaiSessionExt();
            ext.setExtId(sequenceService.nextVal());
            ext.setSessionId(sessionId);
            ext.setExtParamName(name);
            ext.setExtParamCode(code);
            ext.setExtParamValue(value);
            byaiSessionExtMapper.insert(ext);
        }
        else {
            existing.setExtParamName(name);
            existing.setExtParamValue(value);
            byaiSessionExtMapper.updateById(existing);
        }
    }

    /** 物理删除尚未执行的任务会话及其成员、扩展参数；执行后的会话由业务规则禁止删除。 */
    public void deletePending(Long sessionId) {
        if (sessionId == null) {
            return;
        }
        byaiSessionExtMapper.delete(new LambdaQueryWrapper<ByaiSessionExt>().eq(ByaiSessionExt::getSessionId, sessionId));
        byaiSessionMemberMapper.delete(
            new LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember>()
                .eq(com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember::getSessionId, sessionId));
        byaiSessionMapper.deleteById(sessionId);
    }

    /** 判断会话是否已经带有运营需求关联扩展参数。 */
    private boolean isOperationTask(Long sessionId) {
        LambdaQueryWrapper<ByaiSessionExt> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ByaiSessionExt::getSessionId, sessionId).eq(ByaiSessionExt::getExtParamCode, EXT_SOURCE_ID);
        return byaiSessionExtMapper.selectCount(wrapper) > 0;
    }

    /** 生成绑定会话扩展参数的 EXISTS 片段；调用方传入的值已由后端转换为数字或固定枚举。 */
    private String operationTaskExistsSql(String code, String value) {
        if (value == null) {
            return "EXISTS (SELECT 1 FROM byai_session_ext ext WHERE ext.session_id = byai_session.session_id "
                + "AND ext.ext_param_code = '" + code + "')";
        }
        return "EXISTS (SELECT 1 FROM byai_session_ext ext WHERE ext.session_id = byai_session.session_id "
            + "AND ext.ext_param_code = '" + code + "' AND ext.ext_param_value = '" + value.replace("'", "''")
            + "')";
    }
}
