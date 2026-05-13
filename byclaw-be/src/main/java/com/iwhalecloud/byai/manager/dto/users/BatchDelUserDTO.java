package com.iwhalecloud.byai.manager.dto.users;

import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-04-23 19:33:59
 * @description TODO
 */
@Getter
@Setter
public class BatchDelUserDTO {

    @NotEmpty(message = "{batchdeluserdto.userlist.notempty}")
    private List<DelUserDTO> delUserDTOList;
}
