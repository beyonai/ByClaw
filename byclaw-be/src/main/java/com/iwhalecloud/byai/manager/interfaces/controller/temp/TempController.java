package com.iwhalecloud.byai.manager.interfaces.controller.temp;


import com.iwhalecloud.byai.manager.entity.temp.TempQo;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/temp")
public class TempController {

    @Autowired
    private UserService userService;
    @PostMapping("/queryEmail")
    public Map<String, List<String>> queryEmail(@RequestBody TempQo tempQo) {
        return userService.queryEmailByOrgAndName(tempQo);
    }

    @PostMapping("/queryName")
    public Map<String, List<String>> queryNameByOrgAndName(@RequestBody TempQo tempQo) {
        return userService.queryNameByOrgAndName(tempQo);
    }



}
