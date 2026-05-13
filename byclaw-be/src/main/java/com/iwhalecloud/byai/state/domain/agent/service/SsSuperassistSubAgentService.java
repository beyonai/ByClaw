package com.iwhalecloud.byai.state.domain.agent.service;

import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.application.service.resource.AgentResourceService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassistSubAgent;
import com.iwhalecloud.byai.manager.mapper.superassist.SuasSuperassistSubAgentMapper;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.state.domain.assitsant.vo.IsTopVo;
import org.apache.commons.collections.CollectionUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.google.common.collect.ImmutableList;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.agent.enums.MetaStatusEnum;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.feign.request.manager.AgentResourceChatInfoDto;
import com.iwhalecloud.byai.common.feign.request.manager.ResourceIdQo;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.log.exception.ManagerRuntimeException;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import lombok.extern.slf4j.Slf4j;

/**
 * <br>
 * <Description of the type></br>
 *
 * @author track
 * @version 1.0
 * @taskId 1.0
 * @createDate 2025/3/29
 * @see com.ztesoft
 * @since 1.0
 */
@Slf4j
@Service
public class SsSuperassistSubAgentService {

    @Autowired
    private MemoryMessageService memoryMessageService;

    @Autowired
    private SuasSuperassistSubAgentMapper suasSuperassistSubAgentMapper;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private AgentResourceService agentResourceService;

    /**
     * 获取系统默认数字员工ID列表
     *
     * @return 默认数字员工ID列表（慧笔、chatbi、鲸灵）
     * @throws BdpRuntimeException 当默认数字员工未配置时抛出异常
     */
    public List<Long> getDefaultAgentIds() {
        List<ByaiSystemConfigList> byaiSystemConfigLists = byaiSystemConfigService
            .findByParamGroupCode(Constants.DEFAULT_BYAI_AGENT);

        if (CollectionUtils.isEmpty(byaiSystemConfigLists)) {
            throw new BdpRuntimeException(
                "Huibi Digital employees, Wenshu Digital employees, and Jingling Digital employees have not yet been configured");
        }

        return byaiSystemConfigLists.stream().map(t -> {
            String paramValue = t.getParamValue();
            return Long.parseLong(paramValue);
        }).collect(Collectors.toList());
    }




    /**
     * TODO: 后续应该需要改为查ES 查询pg的资源详情
     * 
     * @param agentId
     * @param isDebug
     * @return
     */
    public AgentResourceChatInfoDto getResourceAgent(Integer isDebug, Long agentId) {
        try {
            if (agentId == null) {
                throw new BdpRuntimeException(I18nUtil.get("agent.service.agent.id.cannot.be.empty"));
            }
            ResourceIdQo resourceIdQo = new ResourceIdQo();
            resourceIdQo.setResourceIds(ImmutableList.of(agentId));
            // 默认查询上架的
            if (isDebug == null || DebugModeEnum.DEBUG_0.getNum().equals(isDebug)) {
                resourceIdQo.setResourceStatus(MetaStatusEnum.UP.getCode());
            }
            List<AgentResourceChatInfoDto> list = agentResourceService.getAgentResourceInfo(resourceIdQo);
            if (CollectionUtils.isEmpty(list)) {
                return null;
            }
            AgentResourceChatInfoDto result = list.get(0);
            return result;
        }
        catch (Exception e) {
            throw new ManagerRuntimeException(e);
        }
    }



    /**
     * 清除数字员工关注数量的缓存
     *
     * @param agentId 数字员工ID
     */
    private void clearAgentFocusCountCache(Long agentId) {
        if (agentId == null) {
            return;
        }
        String cacheKey = "agent:focus:count:{focus_count}:" + agentId; // 使用hash tag
        RedisUtil.removeKey(cacheKey);
        log.debug("清除数字员工关注数量缓存，agentId: {}", agentId);
    }

    /**
     * 关注数字员工
     *
     * @param agentId 数字员工ID
     * @param assistantId 助手ID
     * @param createBy 创建人ID（如果createBy不为空则为前台自己创建的数字员工，否则是关注后台的数字员工）
     * @return 关注关系实体对象
     */
    public SuasSuperassistSubAgent focusAgent(Long agentId, Long assistantId, Long createBy) {
        // 判断是否存在
        SuasSuperassistSubAgent agent = findAgentById(agentId, assistantId);
        // 已经关注了直接返回
        if (agent != null) {
            return agent;
        }
        // 新增
        SuasSuperassistSubAgent suasSuperassistSubAgent = new SuasSuperassistSubAgent();
        suasSuperassistSubAgent.setAgentId(agentId);
        suasSuperassistSubAgent.setIsSub(1);
        suasSuperassistSubAgent.setAgentType(AgentMetaEnum.DIG_EMPLOYEE.getCode());
        suasSuperassistSubAgent.setStatusCd("00A");
        suasSuperassistSubAgent.setSubTime(new Date());
        suasSuperassistSubAgent.setTopTime(new Date());
        suasSuperassistSubAgent.setIsTop(0);
        suasSuperassistSubAgent.setSuperassistId(assistantId);
        // 只有后台创建才会写这个值
        // suasSuperassistSubAgent.setCreateBy(createBy);
        suasSuperassistSubAgent.setCreateTime(new Date());
        suasSuperassistSubAgent.setSuperassistSubAgentId(sequenceService.nextVal());
        suasSuperassistSubAgentMapper.insert(suasSuperassistSubAgent);

        // 清除关注数量缓存
        clearAgentFocusCountCache(agentId);

        return suasSuperassistSubAgent;
    }

    /**
     * 根据数字员工ID和助手ID查询关注关系
     *
     * @param agentId 数字员工ID
     * @param assistantId 助手ID
     * @return 关注关系实体对象，如果不存在则返回null
     */
    private SuasSuperassistSubAgent findAgentById(Long agentId, Long assistantId) {

        LambdaQueryWrapper<SuasSuperassistSubAgent> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SuasSuperassistSubAgent::getAgentId, agentId);
        queryWrapper.eq(SuasSuperassistSubAgent::getSuperassistId, assistantId);
        List<SuasSuperassistSubAgent> agentList = suasSuperassistSubAgentMapper.selectList(queryWrapper);
        if (CollectionUtils.isEmpty(agentList)) {
            return null;
        }
        return agentList.get(0);
    }

    /**
     * 取消关注数字员工
     *
     * @param agentId 数字员工ID
     * @param assistantId 助手ID
     * @return 操作结果，true表示成功，false表示失败
     */
    public Boolean cancelFocus(Long agentId, Long assistantId) {
        // 查询管理关系
        SuasSuperassistSubAgent agent = findAgentById(agentId, assistantId);
        if (agent == null) {
            return true;
        }
        Boolean result = suasSuperassistSubAgentMapper.deleteById(agent.getSuperassistSubAgentId()) > 0;

        // 清除关注数量缓存
        if (result) {
            clearAgentFocusCountCache(agentId);
        }

        return result;
    }

    /**
     * 置顶和取消置顶
     * 
     * @param isTopVo 置顶对象
     */
    public void isTopAgent(IsTopVo isTopVo) {

        Integer isTop = isTopVo.getIsTop();
        List<Long> agentIds = isTopVo.getAgentIds();
        List<String> agentTypeList = isTopVo.getAgentTypeList();

        if (ListUtil.isEmpty(agentIds)) {
            return;
        }

        // 查询当前助手与该数字员工的关联关系
        for (int i = 0; i < agentIds.size(); i++) {

            Long agentId = agentIds.get(i);
            String agentType = agentTypeList.get(i);

            // 查询置顶数据
            LambdaQueryWrapper<SuasSuperassistSubAgent> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.eq(SuasSuperassistSubAgent::getAgentId, agentId);
            queryWrapper.eq(SuasSuperassistSubAgent::getSuperassistId, CurrentUserHolder.getAssistantId());
            queryWrapper.eq(SuasSuperassistSubAgent::getStatusCd, Constants.STATUS_00A);
            queryWrapper.orderByDesc(SuasSuperassistSubAgent::getCreateTime);
            List<SuasSuperassistSubAgent> topList = suasSuperassistSubAgentMapper.selectList(queryWrapper);

            if (Objects.equals(isTop, 1)) {
                this.topAgent(agentId, agentType, topList);
            }
            else {
                this.cancelTopAgent(topList);
            }

        }
    }

    /**
     * 取消置顶操作
     *
     * @param topList 参数列表
     */
    private void cancelTopAgent(List<SuasSuperassistSubAgent> topList) {
        // 没数据不操作
        if (ListUtil.isEmpty(topList)) {
            return;
        }

        for (SuasSuperassistSubAgent suasSuperassistSubAgent : topList) {
            suasSuperassistSubAgent.setIsTop(0);
            suasSuperassistSubAgent.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            suasSuperassistSubAgent.setUpdateDate(new Date());
            suasSuperassistSubAgent.setComAcctId(CurrentUserHolder.getEnterpriseId());
            suasSuperassistSubAgentMapper.updateById(suasSuperassistSubAgent);
        }
    }

    /**
     * 置顶操作
     * 
     * @param agentId 资源标识
     * @param agentType 资源类型
     * @param topList 参数列表
     */
    private void topAgent(Long agentId, String agentType, List<SuasSuperassistSubAgent> topList) {

        if (ListUtil.isNotEmpty(topList)) {
            for (SuasSuperassistSubAgent suasSuperassistSubAgent : topList) {
                suasSuperassistSubAgent.setIsTop(1);
                suasSuperassistSubAgent.setTopTime(new Date());
                suasSuperassistSubAgentMapper.updateById(suasSuperassistSubAgent);
            }
        }
        else {
            SuasSuperassistSubAgent suasSuperassistSubAgent = new SuasSuperassistSubAgent();
            suasSuperassistSubAgent.setSuperassistSubAgentId(sequenceService.nextVal());
            suasSuperassistSubAgent.setAgentId(agentId);
            suasSuperassistSubAgent.setAgentType(agentType);
            suasSuperassistSubAgent.setCreateTime(new Date());
            suasSuperassistSubAgent.setCreateBy(CurrentUserHolder.getCurrentUserId());
            suasSuperassistSubAgent.setSuperassistId(CurrentUserHolder.getAssistantId());
            suasSuperassistSubAgent.setComAcctId(CurrentUserHolder.getEnterpriseId());
            suasSuperassistSubAgent.setIsSub(1);
            suasSuperassistSubAgent.setIsTop(1);
            suasSuperassistSubAgent.setSubTime(new Date());
            suasSuperassistSubAgent.setTopTime(new Date());
            suasSuperassistSubAgent.setStatusCd(Constants.STATUS_00A);
            suasSuperassistSubAgentMapper.insert(suasSuperassistSubAgent);
        }
    }

}
