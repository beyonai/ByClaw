package com.iwhalecloud.byai.state.domain.men.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.men.MenTask;
import com.iwhalecloud.byai.manager.entity.men.MenTaskRecObj;
import com.iwhalecloud.byai.manager.qo.men.MenTaskQueryQo;
import com.iwhalecloud.byai.state.domain.session.dto.SessionMembersDto;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.constants.chat.ChatObjType;
import com.iwhalecloud.byai.manager.vo.men.MenTaskRecObjVo;
import com.iwhalecloud.byai.manager.dto.men.MenTaskSessionQo;
import com.iwhalecloud.byai.manager.vo.men.MenTaskVo;
import com.iwhalecloud.byai.state.domain.men.enums.MenTaskStatusEnum;
import com.iwhalecloud.byai.manager.mapper.men.MenResComMapper;
import com.iwhalecloud.byai.manager.mapper.men.MenTaskMapper;
import com.iwhalecloud.byai.manager.mapper.men.MenTaskRecObjMapper;
import com.iwhalecloud.byai.manager.qo.men.MenResComQo;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import com.iwhalecloud.byai.state.domain.session.enums.MemObjType;
import com.iwhalecloud.byai.state.domain.session.enums.UserRole;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;

/**
 * 待办任务服务
 */
@Service
public class MenTaskService {

    private static final Logger logger = LoggerFactory.getLogger(MenTaskService.class);

    @Autowired
    private MenTaskMapper menTaskMapper;

    @Autowired
    private MenResComMapper menResComMapper;

    @Autowired
    private MenTaskRecObjMapper menTaskRecObjMapper;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private MenTaskStatusLogService menTaskStatusLogService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private NotificationService notificationService;

    /**
     * 保存任务
     *
     * @param menTaskDto 任务标识
     */
    public void save(MenTask menTaskDto) {
        menTaskMapper.insert(menTaskDto);
    }

    /**
     * 删除
     *
     * @param taskId 任务标识
     */
    public void deleteById(Long taskId) {
        menTaskMapper.deleteById(taskId);
    }

    /**
     * 根据组组件标识查询
     *
     * @param resComId 组件标识
     * @return MenTaskDto
     */
    public MenTask findByResComId(Long resComId) {
        return menTaskMapper.findByResComId(resComId);
    }

    public MenTask getTaskById(Long taskId) {
        return menTaskMapper.selectById(taskId);
    }

    /**
     * @param taskExtId 任务标识
     * @param systemNo 系统编码
     * @return MenTaskDto
     */
    public MenTask findByTaskExtId(String taskExtId, String systemNo) {
        return menTaskMapper.selectByTaskExtIdAndSystemCode(taskExtId, systemNo);
    }

    /**
     * 分页条件查询待办任务列表，返回PageInfo格式
     *
     * @param queryQo 查询参数，包含分页和业务条件
     * @return PageInfo<MenTaskDto>
     */
    public PageInfo<MenTaskVo> listTasksByPage(MenTaskQueryQo queryQo) {
        // 待办自己查询自己的
        queryQo.setUserId(CurrentUserHolder.getCurrentUserId());
        // 根据taskHandleType设置statusCd列表
        if (queryQo.getTaskHandleType() != null) {
            List<String> statusList;
            switch (queryQo.getTaskHandleType()) {
                case MenTaskQueryQo.TO_BE_PROCESSED:
                    statusList = Arrays.asList(MenTaskStatusEnum.SUBMITTED.getCode(),
                        MenTaskStatusEnum.WORKING.getCode(), MenTaskStatusEnum.INPUTREQUIRED.getCode(),
                        MenTaskStatusEnum.AUTHREQUIRED.getCode());
                    break;
                case MenTaskQueryQo.PROCESSED:
                    statusList = Collections.singletonList(MenTaskStatusEnum.COMPLETED.getCode());
                    break;
                default:
                    queryQo.setSendObjId(CurrentUserHolder.getCurrentUserId());
                    statusList = null;
            }
            queryQo.setStatusCdList(statusList);
        }
        int pageNum = queryQo.getPageNum();
        int pageSize = queryQo.getPageSize();
        int offset = (pageNum - 1) * pageSize;
        // 目前类型写死了是查询人的后面优化 men_task
        List<MenTaskVo> list = menTaskMapper.listTasksByPage(queryQo, offset, pageSize);
        PageInfo<MenTaskVo> pageInfo = new PageInfo<>();
        pageInfo.setPageNum(pageNum);
        pageInfo.setPageSize(pageSize);
        if (CollectionUtils.isEmpty(list)) {
            pageInfo.setList(new ArrayList<>());
            return pageInfo;
        }
        list.forEach(task -> {
            String statusCd = task.getStatusCd();
            if (StringUtils.isNotEmpty(statusCd)) {
                MenTaskStatusEnum statusEnum = MenTaskStatusEnum.fromCode(statusCd.trim());
                task.setStatusCdName(statusEnum != null ? statusEnum.getDesc() : "未知状态");
            }
        });

        int total = menTaskMapper.countTasks(queryQo);
        int totalPages = (int) Math.ceil((double) total / pageSize);
        pageInfo.setTotal(total);
        pageInfo.setTotalPages(totalPages);
        pageInfo.setList(list);
        return pageInfo;
    }

    /**
     * 修改任务信息（处理人、处理描述、处理类型、状态等）
     *
     * @param updateQo 修改参数
     * @return 是否成功
     */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil updateTask(MenTask updateQo) {
        MenTask selectTaskOld;
        if (updateQo.getTaskId() == null) {
            selectTaskOld = menTaskMapper.selectByTaskExtIdAndSystemCode(updateQo.getTaskExtId(),
                updateQo.getSystemNo());
            if (selectTaskOld == null) {
                return ResponseUtil.fail(I18nUtil.get("error.mentask.not.found"));
            }
            updateQo.setTaskId(selectTaskOld.getTaskId());
        }
        else {
            selectTaskOld = menTaskMapper.selectById(updateQo.getTaskId());
        }
        if (selectTaskOld == null) {
            logger.error("updateTask 查询不到任务,入参是：{}", JSON.toJSONString(updateQo));
            return ResponseUtil.fail(I18nUtil.get("error.mentask.not.exist"));
        }
        // 审批人
        updateQo.setDealObjId(CurrentUserHolder.getCurrentUserId());
        updateQo.setDealType(ChatObjType.HUMAN);
        updateQo.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        updateQo.setUpdateTime(new Date());
        int rows = menTaskMapper.updateById(updateQo);
        if (rows > 0 && StringUtils.isNotEmpty(updateQo.getStatusCd())) {

            // 判断当前任务是否存在父任务的。如果存在父任务，还得判断父任务下面的子任务是不是都是完成了
            if (null != selectTaskOld.getPTaskId()) {
                LambdaQueryWrapper<MenTask> queryWrapper = new LambdaQueryWrapper<>();
                queryWrapper.eq(MenTask::getPTaskId, selectTaskOld.getPTaskId());
                queryWrapper.in(MenTask::getStatusCd, Arrays.asList(MenTaskStatusEnum.SUBMITTED.getCode(),
                    MenTaskStatusEnum.WORKING.getCode(), MenTaskStatusEnum.INPUTREQUIRED.getCode()));
                List<MenTask> checkPList = menTaskMapper.selectList(queryWrapper);
                if (CollectionUtils.isEmpty(checkPList)) {
                    // 如果父任务下面的子任务都没有进行中的，那就修改父任务状态完成
                    MenTask updatePTask = new MenTask();
                    updatePTask.setTaskId(selectTaskOld.getPTaskId());
                    updatePTask.setStatusCd(MenTaskStatusEnum.COMPLETED.getCode());
                    // 审批人
                    updatePTask.setDealObjId(CurrentUserHolder.getCurrentUserId());
                    updatePTask.setDealType(ChatObjType.HUMAN);
                    updatePTask.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                    updatePTask.setUpdateTime(new Date());
                    menTaskMapper.updateById(updatePTask);

                }
            }

            // 修改了状态需要插入日志记录
            menTaskStatusLogService.insert(selectTaskOld, updateQo);
            // 这个有地方使用到了id不能随意改咯
            return ResponseUtil.successResponse(updateQo.getTaskId());
        }
        return ResponseUtil.fail(I18nUtil.get("error.mentask.update.failed"));
    }

    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil updateResCom(MenResComQo menResComDto) {
        menResComDto.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        menResComDto.setUpdateTime(new Date());
        int rows = menResComMapper.updateById(menResComDto);
        Long messageId = menResComDto.getMessageId();
        if (messageId != null) {
            this.updateMessage(messageId, menResComDto);
        }

        if (rows > 0) {
            return ResponseUtil.successResponse(menResComDto.getResComId());
        }
        return ResponseUtil.fail(I18nUtil.get("error.mentask.update.failed"));
    }

    private void updateMessage(Long messageId, MenResComQo menResComDto) {
        Long taskId = menResComDto.getTaskId();
        // 根据taskId查询任务
        MenTask task = menTaskMapper.selectById(taskId);

        MenTaskVo menTaskVo = new MenTaskVo();
        BeanUtils.copyProperties(task, menTaskVo);
        BeanUtils.copyProperties(menResComDto, menTaskVo);
        String extraInfo = JSONObject.toJSONString(menTaskVo);

        notificationService.updateMessage(messageId, extraInfo);
    }

    public ResponseUtil createTaskConversation(MenTaskSessionQo taskSessionQo) {
        MenTask menTaskDto = menTaskMapper.selectById(taskSessionQo.getTaskId());
        if (menTaskDto == null) {
            return ResponseUtil.fail(I18nUtil.get("error.mentask.not.exist"));
        }
        if (null != menTaskDto.getSessionId()) {
            // 如果存在sessionId 直接返回之前的使用
            taskSessionQo.setSessionId(menTaskDto.getSessionId());
            return ResponseUtil.successResponse(taskSessionQo);
        }

        // 分布式锁，防止多人操作
        boolean locked = false;
        String lockKey = "createTaskConversation:lock:" + taskSessionQo.getTaskId();
        String lockKeyValue = UUID.randomUUID().toString();
        try {
            locked = RedisUtil.lock(lockKey, lockKeyValue, 60L);
            if (!locked) {
                return ResponseUtil.fail(I18nUtil.get("error.mentask.session.creating"));
            }
            // 根据任务查询所有的待办人拉到群，排查当前登录人自己的
            List<MenTaskRecObjVo> taskRecObjVos = menTaskRecObjMapper
                .selectTaskResUserByTaskId(taskSessionQo.getTaskId());
            // 过滤掉当前登录用户
            Long currentUserId = CurrentUserHolder.getCurrentUserId();
            taskRecObjVos = taskRecObjVos.stream()
                .filter(obj -> obj.getReciObjId() != null && !obj.getReciObjId().equals(currentUserId))
                .collect(Collectors.toList());
            // 这里选择继续创建，只包含当前用户的会话
            List<ByaiSessionMember> members = new ArrayList<>();
            SessionMembersDto membersDto = new SessionMembersDto();
            // 设置成员主键 //h_as：人与超级助手/数字员工单聊
            membersDto.setSessionType("h_as");
            membersDto.setSessionId(sequenceService.nextVal());
            membersDto.setCreatorId(currentUserId);
            membersDto.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
            // 添加其他待办人作为成员
            if (!taskRecObjVos.isEmpty()) {
                for (MenTaskRecObjVo taskRecObj : taskRecObjVos) {
                    ByaiSessionMember memberDto = new ByaiSessionMember();
                    memberDto.setByaiSessionMemberId(sequenceService.nextVal());
                    memberDto.setSessionId(membersDto.getSessionId());
                    memberDto.setComAcctId(CurrentUserHolder.getEnterpriseId());
                    memberDto.setCreateTime(new Date());
                    memberDto.setMemName(taskRecObj.getUserName());
                    memberDto.setMemObjId(taskRecObj.getReciObjId());
                    memberDto.setMemObjType(MemObjType.USER.name());
                    memberDto.setUserRole(UserRole.MEMBER.name());
                    members.add(memberDto);
                }
            }

            // 当前操作的用户就是群主
            ByaiSessionMember currUser = new ByaiSessionMember();
            currUser.setByaiSessionMemberId(sequenceService.nextVal());
            currUser.setSessionId(membersDto.getSessionId());
            currUser.setComAcctId(CurrentUserHolder.getEnterpriseId());
            currUser.setMemName(CurrentUserHolder.getCurrentUserName());
            currUser.setMemObjId(currentUserId);
            currUser.setMemObjType(MemObjType.USER.name());
            currUser.setUserRole(UserRole.OWNER.name());
            currUser.setCreateTime(new Date());
            members.add(currUser);
            membersDto.setMembers(members);
            membersDto.setSessionName(menTaskDto.getTitle());
            // 群成员包含 群主、创建人
            sessionService.createSessionMembers(membersDto);

            MenTask updateQo = new MenTask();
            updateQo.setTaskId(taskSessionQo.getTaskId());
            updateQo.setSessionId(membersDto.getSessionId());
            menTaskMapper.updateById(updateQo);
            return ResponseUtil.successResponse(membersDto);
        }
        finally {
            if (locked) {
                RedisUtil.releaseLock(lockKey, lockKeyValue);
            }
        }

    }

    /*
     * 插入任务 task 任务数据 menTaskRecObjDto 任务接受人数据
     */
    @Transactional(rollbackFor = Exception.class)
    public MenTask addMenTask(MenTask task, MenTaskRecObj menTaskRecObjDto) {
        if (task.getTaskId() == null) {
            task.setTaskId(sequenceService.nextVal());
        }
        task.setCreateBy(CurrentUserHolder.getCurrentUserId());
        task.setCreateTime(new Date());
        task.setComAcctId(CurrentUserHolder.getEnterpriseId());
        task.setPriority(task.getPriority() == null ? "MEDIUM" : task.getPriority());
        task.setStatusCd(task.getStatusCd() == null ? MenTaskStatusEnum.SUBMITTED.getCode() : task.getStatusCd());
        menTaskMapper.insert(task);
        // 如果接收人不为空继续插入
        if (menTaskRecObjDto != null) {
            // 批量创建新的接收人关系
            menTaskRecObjDto.setTaskRecObjId(sequenceService.nextVal());
            menTaskRecObjDto.setTaskId(task.getTaskId());
            menTaskRecObjDto.setComAcctId(CurrentUserHolder.getEnterpriseId());
            menTaskRecObjDto.setCreateBy(CurrentUserHolder.getCurrentUserId());
            menTaskRecObjDto.setCreateTime(new Date());
            menTaskRecObjMapper.insert(menTaskRecObjDto);
        }

        return task;
    }

    /*
     * 通过控制器暂时写死 查询工作空间 Submitted , Working , InputRequired ,Completed 暂时查询这4个字段的内容
     */
    public List<MenTaskVo> listTasksByPTask(MenTaskQueryQo queryQo) {
        if (queryQo.getPTaskId() == null) {
            throw new BdpRuntimeException(I18nUtil.get("men.task.service.p.task.id.cannot.be.null"));
        }
        List<MenTaskVo> list = menTaskMapper.listTasksByPTask(queryQo);
        if (CollectionUtils.isNotEmpty(list)) {
            list.forEach(task -> {
                String statusCd = task.getStatusCd();
                if (StringUtils.isNotEmpty(statusCd)) {
                    MenTaskStatusEnum statusEnum = MenTaskStatusEnum.fromCode(statusCd.trim());
                    task.setStatusCdName(statusEnum != null ? statusEnum.getDesc() : "未知状态");
                }
            });
        }
        return list;
    }

}
