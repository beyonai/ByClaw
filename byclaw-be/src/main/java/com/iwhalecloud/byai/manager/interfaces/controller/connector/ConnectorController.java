package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.application.service.connector.ConnectorApplicationService;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorListDto;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.connector.ConnectorQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 连接器接口。
 *
 * @author he.duming
 * @date 2026-07-30 00:25:13
 */
@RestController
@RequestMapping("/connector")
public class ConnectorController {

    @Autowired
    private ConnectorApplicationService connectorApplicationService;

    /**
     * 分页查询连接器列表。
     *
     * @param qo 分页查询条件
     * @return 分页结果
     */
    @PostMapping("/listAll")
    public ResponseUtil<PageInfo<ConnectorListDto>> listAll(@RequestBody ConnectorQo qo) {
        return ResponseUtil.successResponse(connectorApplicationService.listAll(qo));
    }
}
