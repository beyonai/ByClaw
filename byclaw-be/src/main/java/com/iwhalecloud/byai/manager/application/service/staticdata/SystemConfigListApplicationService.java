package com.iwhalecloud.byai.manager.application.service.staticdata;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.staticdata.service.ByaiSystemConfigListService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.staticdata.SystemConfigListDTO;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.common.qo.QueryObject;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.staticdata.SystemConfigListGroupVo;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 系统配置列表应用服务
 */
@Service
public class SystemConfigListApplicationService {

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private ByaiSystemConfigListService byaiSystemConfigListService;

    /**
     * 分页查询系统配置列表分组
     *
     * @param qo 查询对象
     * @return PageInfo
     */
    public PageInfo<SystemConfigListGroupVo> selectSystemConfigListGroupByQo(QueryObject qo) {
        PageInfo<SystemConfigListGroupVo> pageVO = byaiSystemConfigListService.selectSystemConfigListGroupByQo(qo);

        // 查询缓存数据返回
        List<SystemConfigListGroupVo> rows = pageVO.getList();
        for (int i = 0; rows != null && i < rows.size(); i++) {
            SystemConfigListGroupVo systemConfigListGroupVo = rows.get(i);
            String paramGroupCode = systemConfigListGroupVo.getParamGroupCode();
            String cacheJson = RedisUtil.hmGet(RedisConfig.SYSTEM_CONFIG_GROUP_CODE_KEY, paramGroupCode);
            systemConfigListGroupVo.setCacheJson(cacheJson);
        }
        return pageVO;
    }

    /**
     * 新增系统配置列表
     *
     * @param bystemConfigListDTO 新增请求
     */
    public void saveSystemConfigList(SystemConfigListDTO bystemConfigListDTO) {

        String paramGroupCode = bystemConfigListDTO.getParamGroupCode();
        String paramGroupName = bystemConfigListDTO.getParamGroupName();

        // 重复校验检查
        long total = byaiSystemConfigListService.countSystemConfigList(paramGroupCode, paramGroupName);
        if (total > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "system.config.list.paramgroupcode.exists.save");
        }

        List<ByaiSystemConfigList> byaiSystemConfigLists = bystemConfigListDTO.getByaiSystemConfigLists();
        for (ByaiSystemConfigList byaiSystemConfigList : byaiSystemConfigLists) {
            byaiSystemConfigList.setParamId(SequenceService.nextVal());
            byaiSystemConfigList.setParamGroupCode(paramGroupCode);
            byaiSystemConfigList.setParamGroupName(paramGroupName);
            byaiSystemConfigListService.save(byaiSystemConfigList);
        }

        // 缓存
        String cacheJson = JSON.toJSONString(byaiSystemConfigLists);
        RedisUtil.hmPut(RedisConfig.SYSTEM_CONFIG_GROUP_CODE_KEY, paramGroupCode, cacheJson);

    }

    /**
     * 更新系统配置列表
     *
     * @param bystemConfigListDTO 更新请求
     */
    public void updateSystemConfigList(SystemConfigListDTO bystemConfigListDTO) {

        String paramGroupCode = bystemConfigListDTO.getParamGroupCode();
        String paramGroupName = bystemConfigListDTO.getParamGroupName();

        // 查询历史数据
        List<ByaiSystemConfigList> historyLists = byaiSystemConfigListService.findByParamGroupCode(paramGroupCode);
        Map<Long, ByaiSystemConfigList> historyListMap = new HashMap<>();
        for (ByaiSystemConfigList byaiSystemConfigList : historyLists) {
            historyListMap.put(byaiSystemConfigList.getParamId(), byaiSystemConfigList);
        }

        // 当前版本
        List<ByaiSystemConfigList> byaiSystemConfigLists = bystemConfigListDTO.getByaiSystemConfigLists();
        for (ByaiSystemConfigList byaiSystemConfigList : byaiSystemConfigLists) {
            Long paramId = byaiSystemConfigList.getParamId();
            ByaiSystemConfigList historyByaiSystemConfigList = historyListMap.remove(paramId);
            // 如果存在该paramId的,进行更新处理
            if (historyByaiSystemConfigList != null) {
                byaiSystemConfigListService.updateById(byaiSystemConfigList);
            }
            else {
                byaiSystemConfigList.setParamId(SequenceService.nextVal());
                byaiSystemConfigList.setParamGroupCode(paramGroupCode);
                byaiSystemConfigList.setParamGroupName(paramGroupName);
                byaiSystemConfigListService.save(byaiSystemConfigList);
            }
        }

        // 对比剩下多余的删除
        for (Long paramId : historyListMap.keySet()) {
            byaiSystemConfigListService.removeById(paramId);
        }

        // 缓存
        String cacheJson = JSON.toJSONString(byaiSystemConfigLists);
        RedisUtil.hmPut(RedisConfig.SYSTEM_CONFIG_GROUP_CODE_KEY, paramGroupCode, cacheJson);
    }

    /**
     * 根据分组编码删除系统配置列表
     *
     * @param paramGroupCode 分组编码
     */
    public void deleteByParamGroupCode(String paramGroupCode) {
        RedisUtil.hmDelete(RedisConfig.SYSTEM_CONFIG_GROUP_CODE_KEY, paramGroupCode);
        byaiSystemConfigListService.removeByByGroupCode(paramGroupCode);
    }

    /**
     * 根据分组编码查询系统配置列表
     *
     * @param paramGroupCode 分组编码
     * @return SystemConfigListDTO
     */
    public SystemConfigListDTO getByParamGroupCode(String paramGroupCode) {
        return byaiSystemConfigListService.getByParamGroupCode(paramGroupCode);
    }

    /**
     * 刷新缓存配置成功
     *
     * @param paramGroupCode 缓存标识
     */
    public void clearOneByParamGroupCode(String paramGroupCode) {
        List<ByaiSystemConfigList> list = byaiSystemConfigListService.findByParamGroupCode(paramGroupCode);
        RedisUtil.hmPut(RedisConfig.SYSTEM_CONFIG_GROUP_CODE_KEY, paramGroupCode, JSON.toJSONString(list));
    }

    /**
     * 刷新全部缓存配置成功
     */
    public void loadAllSystemConfigListCache() {

        List<ByaiSystemConfigList> allByaiSystemConfigList = byaiSystemConfigListService.findAll();

        // 按照 paramGroupCode 编码分组放到 Map 集合中
        Map<String, List<ByaiSystemConfigList>> groupedMap = allByaiSystemConfigList.stream()
            .collect(Collectors.groupingBy(ByaiSystemConfigList::getParamGroupCode, HashMap::new, Collectors.toList()));

        // 遍历分组结果，将每个分组缓存到 Redis
        groupedMap.forEach((paramGroupCode, configList) -> {
            if (paramGroupCode != null && !paramGroupCode.isEmpty()) {
                String cacheJson = JSON.toJSONString(configList);
                RedisUtil.hmPut(RedisConfig.SYSTEM_CONFIG_GROUP_CODE_KEY, paramGroupCode, cacheJson);
            }
        });
    }
}
