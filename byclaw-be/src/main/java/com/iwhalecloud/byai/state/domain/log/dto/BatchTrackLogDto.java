package com.iwhalecloud.byai.state.domain.log.dto;

import com.iwhalecloud.byai.manager.entity.log.TrackLog;
import lombok.Getter;
import lombok.Setter;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-12-27 14:42:45
 * @description TODO
 */
@Getter
@Setter
public class BatchTrackLogDto {

    private List<TrackLog> trackLogs;
}
