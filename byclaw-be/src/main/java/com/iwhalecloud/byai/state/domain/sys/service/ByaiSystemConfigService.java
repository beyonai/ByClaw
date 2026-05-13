package com.iwhalecloud.byai.state.domain.sys.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.manager.mapper.staticdata.ByaiSystemConfigListMapper;
import com.iwhalecloud.byai.manager.mapper.staticdata.ByaiSystemConfigMapper;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import io.jsonwebtoken.lang.Collections;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.commons.collections.MapUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * User: Simon Date: 13-11-29 系统参数
 */
@Service
public class ByaiSystemConfigService {

    private static final Logger logger = LoggerFactory.getLogger(ByaiSystemConfigService.class);

    /**
     * 匹配 ${XXX} 占位符的正则
     */
    private final Pattern pattern = Pattern.compile("\\$\\{(.*?)\\}");

    @Autowired
    private ByaiSystemConfigMapper byaiSystemConfigMapper;

    @Autowired
    private ByaiSystemConfigListMapper byaiSystemConfigListMapper;

    /**
     * 根据paramCode获取配置值
     *
     * @param paramCode 编码
     * @return String
     */
    public String getDcSystemConfigValueByCode(String paramCode) {

        String cacheJson = RedisUtil.hmGet(RedisConfig.SYSTEM_CONFIG_CODE_KEY, paramCode);

        ByaiSystemConfig byaiSystemConfig;
        if (StringUtil.isNotEmpty(cacheJson)) {
            byaiSystemConfig = JsonUtil.parseObject(cacheJson, ByaiSystemConfig.class);
        }
        else {
            LambdaQueryWrapper<ByaiSystemConfig> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.eq(ByaiSystemConfig::getParamCode, paramCode);
            byaiSystemConfig = byaiSystemConfigMapper.selectOne(queryWrapper);
        }

        // 对环境变量进行替换
        return byaiSystemConfig != null ? this.environmentReplace(byaiSystemConfig.getParamValue()) : null;
    }

    /**
     * 根据参数类型获取系统配置值列表 该方法采用缓存优先的策略获取系统配置： 1. 首先尝试从Redis缓存中获取指定类型的配置列表 2. 如果缓存中没有数据或数据为空，则从数据库查询 3.
     * 查询到数据后自动缓存到Redis中，提高后续访问性能
     *
     * @param paramGroupCode 参数类型，用于筛选特定类型的系统配置
     * @return 返回指定类型的系统配置列表，如果未找到则返回空列表
     */
    public List<ByaiSystemConfigList> findByParamGroupCode(String paramGroupCode) {

        // 优先从Redis缓存中获取配置列表
        String cacheJson = RedisUtil.hmGet(RedisConfig.SYSTEM_CONFIG_GROUP_CODE_KEY, paramGroupCode);
        if (StringUtil.isNotEmpty(cacheJson)) {
            return JSON.parseArray(cacheJson, ByaiSystemConfigList.class);
        }

        LambdaQueryWrapper<ByaiSystemConfigList> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(ByaiSystemConfigList::getParamGroupCode, paramGroupCode);
        queryWrapper.orderByAsc(ByaiSystemConfigList::getParamSeq);
        return byaiSystemConfigListMapper.selectList(queryWrapper);
    }

    /**
     * 环境变量替换
     *
     * @param strValue 值
     * @return String
     */
    private String environmentReplace(String strValue) {

        if (StringUtil.isEmpty(strValue)) {
            return strValue;
        }

        // 匹配 ${xxx}变量
        Matcher matcher = pattern.matcher(strValue);

        // 初始化Map，用于存放：key=完整占位符，value=占位符名称
        Map<String, String> placeholderMap = new HashMap<>();
        // 遍历匹配结果，填充Map
        while (matcher.find()) {
            // 完整占位符,如:${APP_BOTE_URL}
            String placeholder = matcher.group(0);
            // 占位符名称,如:APP_BOTE_URL
            String environmentKey = matcher.group(1);
            placeholderMap.put(placeholder, environmentKey);
        }

        // 对环境变量进行替换
        for (Map.Entry<String, String> entry : placeholderMap.entrySet()) {
            String placeholder = entry.getKey();
            String environmentKey = entry.getValue();
            String environmentValue = ApplicationContextUtil.getEnvProperty(environmentKey, null);
            if (StringUtil.isNotEmpty(environmentValue)) {
                strValue = strValue.replace(placeholder, environmentValue);
            }
        }

        return strValue;
    }

    public List<ByaiSystemConfig> getDcSystemConfigValueByCodes(Map<String, Object> params) {
        List<String> paramCodes = (List<String>) MapUtils.getObject(params, "paramCodes");

        if (Collections.isEmpty(paramCodes)) {
            logger.error("当key查询入参paramCode为空!");
            return new ArrayList<>();
        }

        LambdaQueryWrapper<ByaiSystemConfig> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(ByaiSystemConfig::getParamCode, paramCodes);
        List<ByaiSystemConfig> configs = byaiSystemConfigMapper.selectList(queryWrapper);
        for (ByaiSystemConfig config : configs) {
            // 对环境变量进行替换
            this.environmentReplace(config.getParamValue());
        }
        return configs;

    }
}
