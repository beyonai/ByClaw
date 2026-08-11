package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Executes post-commit workspace persistence in an independent transaction.
 */
@Service
public class DigitalEmployeePostCommitRefreshExecutor {

    private final DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    public DigitalEmployeePostCommitRefreshExecutor(
            @Lazy DigitalEmployeeApplicationService digitalEmployeeApplicationService) {
        this.digitalEmployeeApplicationService = digitalEmployeeApplicationService;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
    public boolean refresh(Long digitalEmployeeId, DigitalEmployeeDTO inputDto) {
        return inputDto == null
                ? digitalEmployeeApplicationService.synOpenClawWorkSpace(digitalEmployeeId)
                : digitalEmployeeApplicationService.synOpenClawWorkSpace(digitalEmployeeId, inputDto);
    }
}
