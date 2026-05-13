package com.iwhalecloud.byai.manager.domain.staticdata.service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.manager.qo.staticdata.SystemConfigQo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.manager.vo.staticdata.SystemConfigVo;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import com.iwhalecloud.byai.manager.mapper.staticdata.ByaiSystemConfigMapper;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;

/**
 * 系统配置服务实现类
 */
@Service
public class SystemConfigService {

    /**
     * 匹配 ${XXX} 占位符的正则
     */
    private Pattern pattern = Pattern.compile("\\$\\{(.*?)\\}");

    @Autowired
    private ByaiSystemConfigMapper dcSystemConfigMapper;

    /**
     * 分页查询
     * 
     * @param systemConfigQo 查询对象
     * @return PageInfo
     */
    public PageInfo<SystemConfigVo> selectSystemConfigByQo(SystemConfigQo systemConfigQo) {
        Page<SystemConfigVo> page = PageHelper.startPage(systemConfigQo.getPageNum(), systemConfigQo.getPageSize(), true);
        dcSystemConfigMapper.selectSystemConfigByQo(systemConfigQo);
        return PageHelperUtil.toPageInfo(page.toPageInfo());
    }

    /**
     * 根据ID查询系统配置
     *
     * @param paramId 参数ID
     * @return ByaiSystemConfig
     */
    public ByaiSystemConfig findById(Long paramId) {
        if (paramId == null) {
            return null;
        }
        return dcSystemConfigMapper.selectById(paramId);
    }

    /***
     * 查找所有数据
     * 
     * @return List<ByaiSystemConfig>
     */
    public List<ByaiSystemConfig> findAll() {
        return dcSystemConfigMapper.selectList(new LambdaQueryWrapper<>());
    }

    /**
     * 保存系统配置
     *
     * @param byaiSystemConfig 系统配置实体
     */
    public void save(ByaiSystemConfig byaiSystemConfig) {
        dcSystemConfigMapper.insert(byaiSystemConfig);
    }

    /**
     * 更新系统配置
     *
     * @param byaiSystemConfig 系统配置实体
     */
    public void updateById(ByaiSystemConfig byaiSystemConfig) {
        dcSystemConfigMapper.updateById(byaiSystemConfig);
    }

    /**
     * 查询记录数
     * 
     * @param paramCode 静态参数编码
     * @param paramIdNoEqual 表标识，一般更新时传
     * @return long
     */
    public long countSystemConfig(String paramCode, Long paramIdNoEqual) {
        LambdaQueryWrapper<ByaiSystemConfig> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSystemConfig::getParamCode, paramCode);

        if (paramIdNoEqual != null) {
            queryWrapper.notIn(ByaiSystemConfig::getParamId, paramIdNoEqual);
        }
        return dcSystemConfigMapper.selectCount(queryWrapper);
    }

    /**
     * 删除系统配置
     *
     * @param paramId 参数ID
     */
    public void deleteById(Long paramId) {
        if (paramId == null) {
            return;
        }
        dcSystemConfigMapper.deleteById(paramId);
    }

    /**
     * 查询多个key装成Map集合返回
     *
     * @param paramCodes 集合
     * @return Map<String, Object>
     */
    public Map<String, Object> findParamValueMapByCodes(List<String> paramCodes) {
        Map<String, Object> paramValueMap = new HashMap<>(paramCodes.size());
        for (String paramCode : paramCodes) {
            ByaiSystemConfig byaiSystemConfig = this.findCacheOrDbByParamCode(paramCode);
            String paramValue = byaiSystemConfig != null ? byaiSystemConfig.getParamValue() : null;
            paramValueMap.put(paramCode, paramValue);
        }
        return paramValueMap;
    }

    /**
     * 根据编码优先从缓存查找，其次数据库,统一处理，根据实际情况使用
     * 
     * @param paramCode 静态参数编码
     * @return ByaiSystemConfig
     */
    public ByaiSystemConfig findCacheOrDbByParamCode(String paramCode) {

        // 优先从缓存中读取
        String cacheJson = RedisUtil.hmGet(RedisConfig.SYSTEM_CONFIG_CODE_KEY, paramCode);

        ByaiSystemConfig byaiSystemConfig = null;
        if (StringUtil.isNotEmpty(cacheJson)) {
            byaiSystemConfig = JSON.parseObject(cacheJson, ByaiSystemConfig.class);
        }
        else {
            // 其次中数据库中读取并缓存起来
            byaiSystemConfig = this.findByParamCode(paramCode);
            if (byaiSystemConfig != null) {
                cacheJson = JSON.toJSONString(byaiSystemConfig);
                RedisUtil.hmPut(RedisConfig.SYSTEM_CONFIG_CODE_KEY, paramCode, cacheJson);
            }
        }

        // 对环境变量进行统一替换
        if (byaiSystemConfig != null) {
            String paramValue = byaiSystemConfig.getParamValue();
            byaiSystemConfig.setParamValue(this.environmentReplace(paramValue));
        }

        return byaiSystemConfig;
    }

    /**
     * 数据库查找配置信息,不查缓存,暂不对外暴露
     *
     * @param paramCode 配置编码
     * @return ByaiSystemConfig
     */
    private ByaiSystemConfig findByParamCode(String paramCode) {
        if (StringUtils.isEmpty(paramCode)) {
            return null;
        }
        LambdaQueryWrapper<ByaiSystemConfig> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ByaiSystemConfig::getParamCode, paramCode);
        return dcSystemConfigMapper.selectOne(queryWrapper);
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

    /**
     * 获取字符串参数值
     *
     * @param paramCode 参数编码
     * @return String
     */
    public String getStringParamValueByCode(String paramCode) {

        ByaiSystemConfig byaiSystemConfig = this.findCacheOrDbByParamCode(paramCode);

        if (StringUtils.isEmpty(paramCode) || byaiSystemConfig == null) {
            return null;
        }
        return byaiSystemConfig.getParamValue();
    }

    /**
     * 获取长整型参数值
     *
     * @param paramCode 静态参数编码
     * @return Long
     */
    public Long getLongParamValueByCode(String paramCode) {
        // 从缓存中获取，如果没有查询数据库
        ByaiSystemConfig byaiSystemConfig = this.findCacheOrDbByParamCode(paramCode);
        if (StringUtils.isEmpty(paramCode) || byaiSystemConfig == null) {
            return null;
        }
        return Long.parseLong(byaiSystemConfig.getParamValue());
    }

}
