package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import java.util.List;

import com.iwhalecloud.byai.manager.domain.tenant.TenantDatasourceService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDatasourceService.QueryResult;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDatasourceService.TableInfo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin/tenant-datasource")
public class TenantDatasourceController {
    private final TenantDatasourceService service;

    public TenantDatasourceController(TenantDatasourceService service) {
        this.service = service;
    }

    @PostMapping("/tables")
    public ResponseUtil<List<TableInfo>> tables(@RequestBody TenantRequest request) {
        return ResponseUtil.success(service.tables(request.enterpriseId()));
    }

    @PostMapping("/browse")
    public ResponseUtil<QueryResult> browse(@RequestBody BrowseRequest request) {
        return ResponseUtil.success(service.browse(request.enterpriseId(), request.schema(), request.table(),
            request.page()));
    }

    @PostMapping("/execute")
    public ResponseUtil<QueryResult> execute(@RequestBody ExecuteRequest request) {
        return ResponseUtil.success(service.execute(request.enterpriseId(), request.sql(),
            request.page() == null ? 1 : request.page(), Boolean.TRUE.equals(request.confirmed())));
    }

    public record TenantRequest(long enterpriseId) {}
    public record BrowseRequest(long enterpriseId, String schema, String table, int page) {}
    public record ExecuteRequest(long enterpriseId, String sql, Integer page, Boolean confirmed) {}
}
