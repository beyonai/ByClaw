package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class EmployeeVersionSnapshotTest {
    private DigitalEmployeeDTO employee() {
        var dto = new DigitalEmployeeDTO(); dto.setResourceName("测试员工"); dto.setAgentType("001");
        dto.setResourceId(10L); dto.setOwnerType("personal"); dto.setCorePersonaDefinition("原提示词");
        dto.setMachineChannel("[{\"clientSecret\":\"do-not-copy\"}]");
        dto.setAgentSseHead("credential"); dto.setTargetContent("runtime-secret");
        dto.setPrologue("{\"modelInfo\":{\"modelId\":\"9007199254740993\",\"temperature\":0.6,\"apiKey\":\"model-secret\"},\"descText\":\"欢迎\"}");
        dto.setRelSkills(List.of(Map.of("skillCode", "weather", "resourceId", "99", "skillUrl", "signed-secret-url")));
        return dto;
    }
    @Test void snapshotContainsConfigurationButNoRuntimeCredentialsOrOwner() {
        String snapshot = EmployeeVersionSnapshot.encode(employee());
        assertFalse(snapshot.contains("do-not-copy")); assertFalse(snapshot.contains("runtime-secret"));
        assertFalse(snapshot.contains("model-secret")); assertFalse(snapshot.contains("signed-secret-url"));
        var config = EmployeeVersionSnapshot.decode(snapshot);
        assertFalse(config.containsKey("ownerType")); assertFalse(config.containsKey("resourceId"));
        assertEquals("测试员工", config.getString("resourceName"));
        assertEquals("9007199254740993", JSON.parseObject(config.getString("prologue")).getJSONObject("modelInfo").getString("modelId"));
    }
    @Test void restorationKeepsCurrentCredentialsIdentityAndOwnershipWhileClearingSavedEmptyValues() {
        var original = employee(); original.setResourceDesc(null);
        String snapshot = EmployeeVersionSnapshot.encode(original);
        var current = employee(); current.setResourceId(20L); current.setOwnerType("enterprise");
        current.setMachineChannel("current-credential"); current.setResourceDesc("later description");
        var restored = EmployeeVersionSnapshot.restore(snapshot, current);
        assertEquals(20L, restored.getResourceId()); assertEquals("enterprise", restored.getOwnerType());
        assertEquals("current-credential", restored.getMachineChannel()); assertNull(restored.getResourceDesc());
        assertNull(restored.getMemoryConfigList()); assertNull(restored.getTargetContent());
    }
    @Test void unsupportedOrIncompleteSnapshotsCannotBeActivated() {
        assertThrows(RuntimeException.class, () -> EmployeeVersionSnapshot.decode("{}"));
        assertThrows(RuntimeException.class, () -> EmployeeVersionSnapshot.decode("{\"snapshotSchemaVersion\":999,\"configuration\":{}}"));
    }
    @Test void employeeGroupRetainsExistingRuntimeProtocol() {
        var dto = employee(); dto.setAgentType("017");
        var snapshot = JSON.parseObject(EmployeeVersionSnapshot.encode(dto));
        assertEquals("byclaw.digital-employee-group-runtime/v1", snapshot.getString("schemaVersion"));
        assertEquals("9007199254740993", snapshot.getString("modelId"));
        assertEquals("原提示词", snapshot.getString("prompt"));
        assertNotNull(snapshot.getJSONArray("members"));
    }
    @Test void identicalConfigurationsHaveStableHashes() {
        var dto = employee(); String a = EmployeeVersionSnapshot.encode(dto);
        dto.setMachineChannel("rotated-current-secret"); dto.setResourceId(44L);
        assertEquals(EmployeeVersionSnapshot.hash(a), EmployeeVersionSnapshot.hash(EmployeeVersionSnapshot.encode(dto)));
        dto.setCorePersonaDefinition("changed");
        assertNotEquals(EmployeeVersionSnapshot.hash(a), EmployeeVersionSnapshot.hash(EmployeeVersionSnapshot.encode(dto)));
    }
    @Test void legacyModelParametersSurviveSaveAndRestore() {
        var dto = employee(); dto.setPrologue("{\"modelInfo\":{\"modelId\":\"9\",\"model\":\"model label\",\"history\":6,\"maxToken\":2000,\"temperature\":0.1}}");
        var restored = EmployeeVersionSnapshot.restore(EmployeeVersionSnapshot.encode(dto), employee());
        var model = JSON.parseObject(restored.getPrologue()).getJSONObject("modelInfo");
        assertEquals(6, model.getInteger("history")); assertEquals(2000, model.getInteger("maxToken"));
        assertEquals("model label", model.getString("model"));
    }
}
