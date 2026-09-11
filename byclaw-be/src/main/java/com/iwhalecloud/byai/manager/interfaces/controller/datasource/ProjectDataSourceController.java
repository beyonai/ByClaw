package com.iwhalecloud.byai.manager.interfaces.controller.datasource;

import com.iwhalecloud.byai.manager.application.service.datasource.ProjectDataSourceService;
import com.iwhalecloud.byai.manager.dto.datasource.DataSourceSaveDto;
import com.iwhalecloud.byai.manager.dto.datasource.DataSourceScopeDto;
import com.iwhalecloud.byai.manager.dto.datasource.DataSourceView;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;

@RestController
@RequestMapping("/api/v1/projectDataSources")
public class ProjectDataSourceController {
    private final ProjectDataSourceService service;

    public ProjectDataSourceController(ProjectDataSourceService service) {
        this.service = service;
    }

    @PostMapping("/list")
    public ResponseUtil<List<DataSourceView>> list(@Valid @RequestBody DataSourceScopeDto request) {
        return ResponseUtil.successResponse(service.list(request.getProjectId()));
    }

    @PostMapping("/available")
    public ResponseUtil<List<DataSourceView>> available(@Valid @RequestBody DataSourceScopeDto request) {
        return ResponseUtil.successResponse(service.available(request.getProjectId()));
    }

    @PostMapping("/create")
    public ResponseUtil<DataSourceView> create(@Valid @RequestBody DataSourceSaveDto request) {
        return ResponseUtil.successResponse(service.create(request));
    }

    @PostMapping("/update")
    public ResponseUtil<DataSourceView> update(@Valid @RequestBody DataSourceSaveDto request) {
        return ResponseUtil.successResponse(service.update(request));
    }

    @PostMapping("/bind")
    public ResponseUtil<Void> bind(@Valid @RequestBody DataSourceScopeDto request) {
        service.bind(request.getProjectId(), request.getDatasourceId());
        return ResponseUtil.successResponse();
    }

    @PostMapping("/unbind")
    public ResponseUtil<Void> unbind(@Valid @RequestBody DataSourceScopeDto request) {
        service.unbind(request.getProjectId(), request.getDatasourceId());
        return ResponseUtil.successResponse();
    }

    @PostMapping("/delete")
    public ResponseUtil<Void> delete(@Valid @RequestBody DataSourceScopeDto request) {
        service.delete(request.getProjectId(), request.getDatasourceId());
        return ResponseUtil.successResponse();
    }
}
