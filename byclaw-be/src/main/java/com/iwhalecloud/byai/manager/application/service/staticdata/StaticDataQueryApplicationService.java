package com.iwhalecloud.byai.manager.application.service.staticdata;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.staticdata.service.ByaiSystemConfigListService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * @author he.duming
 * @date 2026-01-08 21:19:29
 * @description 前端静态参数用
 */
@Service
public class StaticDataQueryApplicationService {

    @Autowired
    private SystemConfigService systemConfigService;

    @Autowired
    private ByaiSystemConfigListService byaiSystemConfigListService;

    /**
     * 获取静态参数
     *
     * @param paramCode 入参
     * @return ByaiSystemConfig
     */
    public ByaiSystemConfig getDcSystemConfig(String paramCode) {
        return systemConfigService.findCacheOrDbByParamCode(paramCode);
    }

    /**
     * @param language 语言环境
     * @param paramGroupCode 分组编码
     * @return ResponseUtil
     */
    public List<Map<String, Object>> getDcSystemConfigList(String language, String paramGroupCode) {

        String json = RedisUtil.hmGet(RedisConfig.SYSTEM_CONFIG_GROUP_CODE_KEY, paramGroupCode);

        // 优先查询缓存
        List<ByaiSystemConfigList> byaiSystemConfigLists;
        if (StringUtil.isNotEmpty(json)) {
            byaiSystemConfigLists = JSON.parseArray(json, ByaiSystemConfigList.class);
        }
        else {
            byaiSystemConfigLists = byaiSystemConfigListService.findByParamGroupCode(paramGroupCode);
        }

        // 兼容原来dcSystemConfigList列表接口
        List<Map<String, Object>> resultList = new ArrayList<>(byaiSystemConfigLists.size());
        for (ByaiSystemConfigList byaiSystemConfigList : byaiSystemConfigLists) {
            Map<String, Object> dcSystemConfigMap = new HashMap<>();
            dcSystemConfigMap.put("id", byaiSystemConfigList.getParamId());
            dcSystemConfigMap.put("standCode", byaiSystemConfigList.getParamValue());
            if (I18nUtil.ENGLISH.equalsIgnoreCase(language)) {
                dcSystemConfigMap.put("standDisplayValue", byaiSystemConfigList.getParamEnName());
            }
            else {
                dcSystemConfigMap.put("standDisplayValue", byaiSystemConfigList.getParamName());
            }
            dcSystemConfigMap.put("standDesc", byaiSystemConfigList.getParamDesc());
            dcSystemConfigMap.put("orderNo", byaiSystemConfigList.getParamSeq());
            resultList.add(dcSystemConfigMap);
        }
        return resultList;
    }

}
