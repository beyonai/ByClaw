package com.iwhalecloud.byai.manager.dto.email;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotEmpty;
import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-05-22 19:55:32
 * @description TODO
 */
@Getter
@Setter
public class EmailDTO {

    @NotEmpty(message = "{emaildto.subject.notempty}")
    private String subject;

    @Email(message = "{emaildto.email.email}")
    private String email;

    @NotEmpty(message = "{emaildto.text.notempty}")
    private String text;


}
