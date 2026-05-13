package com.iwhalecloud.byai.manager.interfaces.controller.staticdata;

import com.iwhalecloud.byai.manager.application.service.staticdata.PropertyApplicationService;
import com.iwhalecloud.byai.manager.dto.staticdata.BatchPropertyDTO;
import com.iwhalecloud.byai.manager.dto.staticdata.PropertyDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

/**
 * @author he.duming
 * @date 2025-06-29 14:44:48
 * @description TODO
 */
@RestController
@RequestMapping("/system/property")
public class PropertyController {

    @Autowired
    private PropertyApplicationService propertyApplicationService;

    /**
     * 查询配置文件
     * 
     * @param propertyDTO 查询对象
     * @return ResponseUtil
     */
    @RequestMapping(value = "/qryPropertyKey", method = RequestMethod.POST)
    public ResponseUtil qryPropertyKey(@RequestBody @Validated PropertyDTO propertyDTO) {
        return propertyApplicationService.qryPropertyKey(propertyDTO);
    }

    /**
     * 批量查询配置文件
     *
     * @param batchPropertyDTO 查询对象
     * @return ResponseUtil
     */
    @RequestMapping(value = "/bathQryPropertyKey", method = RequestMethod.POST)
    public ResponseUtil bathQryPropertyKey(@RequestBody @Validated BatchPropertyDTO batchPropertyDTO) {
        return propertyApplicationService.bathQryPropertyKey(batchPropertyDTO);
    }

}
