package com.iwhalecloud.byai.manager.interfaces.controller.source;

import java.util.List;

import com.iwhalecloud.byai.manager.entity.source.SystemQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import com.iwhalecloud.byai.manager.entity.source.SourceSystem;
import com.iwhalecloud.byai.manager.domain.source.service.SourceSystemService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

/**
 * 驻地组织控制器
 */
@RestController
@RequestMapping("/system/sourcesystem")
public class SourceSystemController {

    @Autowired
    private SourceSystemService sourceSystemService;

    /**
     * 查询除BYAI的所有系统
     *
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getSourceSystemList", method = RequestMethod.GET)
    public ResponseUtil getStationTree() {
        List<SourceSystem> sourceSystems = sourceSystemService.getSourceSystemList();
        return ResponseUtil.successResponse(sourceSystems);
    }

    @RequestMapping(value = "/getSourceSystemListByType", method = RequestMethod.POST)
    public ResponseUtil getSourceSystemListByType(@RequestBody SystemQo systemQo) {
        List<SourceSystem> sourceSystems = sourceSystemService.getSourceSystemListByTypes(systemQo);
        return ResponseUtil.successResponse(sourceSystems);
    }

}