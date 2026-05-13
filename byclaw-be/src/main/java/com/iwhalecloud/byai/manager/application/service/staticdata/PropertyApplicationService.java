package com.iwhalecloud.byai.manager.application.service.staticdata;

import cn.hutool.core.map.MapUtil;
import com.iwhalecloud.byai.manager.dto.staticdata.BatchPropertyDTO;
import com.iwhalecloud.byai.manager.dto.staticdata.PropertyDTO;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * @author he.duming
 * @date 2025-06-29 14:46:54
 * @description TODO
 */
@Service
public class PropertyApplicationService {

    /**
     * 查询配置文件
     *
     * @param propertyDTO 查询对象
     * @return ResponseUtil
     */
    public ResponseUtil qryPropertyKey(PropertyDTO propertyDTO) {
        String key = propertyDTO.getKey();
        // 如果不是env.开头的不查�?
        if (key != null && key.startsWith("env")) {
            String envValue = ApplicationContextUtil.getEnvProperty(key, "");
            return ResponseUtil.successResponse("OK", envValue);
        }
        else {
            return ResponseUtil.successResponse("OK", "");
        }
    }

    /**
     * 批量查询配置文件
     * 
     * @param batchPropertyDTO 查询对象
     * @return ResponseUtil
     */
    public ResponseUtil bathQryPropertyKey(BatchPropertyDTO batchPropertyDTO) {
        List<String> keys = batchPropertyDTO.getKeys();
        if (ListUtil.isEmpty(keys)) {
            return ResponseUtil.successResponse(Collections.emptyMap());
        }

        Map<String, String> resultMap = MapUtil.newHashMap();
        for (String key : keys) {
            // 如果不是env.开头的不查
            if (key != null && key.startsWith("env")) {
                resultMap.put(key, ApplicationContextUtil.getEnvProperty(key, ""));
            }
            else {
                resultMap.put(key, "");
            }
        }
        return ResponseUtil.successResponse(resultMap);
    }

}
