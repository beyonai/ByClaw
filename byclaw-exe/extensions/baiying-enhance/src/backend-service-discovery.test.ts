import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backendInstanceBaseUrl,
  backendServiceDiscoveryKey,
  parseBackendServiceInstance,
  pickBackendServiceInstance,
} from "./backend-service-discovery.js";

describe("backend service discovery", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses BE_DOMAINNAME for the Redis service discovery key and defaults to ByaiService", () => {
    expect(backendServiceDiscoveryKey()).toBe("byai_gateway:sd:instances:ByaiService");

    vi.stubEnv("BE_DOMAINNAME", "CustomByaiService");
    expect(backendServiceDiscoveryKey()).toBe("byai_gateway:sd:instances:CustomByaiService");
  });

  it("parses backend registration JSON and builds base URL with path_prefix", () => {
    const instance = parseBackendServiceInstance(
      JSON.stringify({
        id: "ByaiService:9b0914b4",
        protocol: "http",
        host: "10.10.168.200",
        port: 8086,
        path_prefix: "/api",
        weight: 3,
      }),
    );

    expect(instance).toEqual({
      id: "ByaiService:9b0914b4",
      protocol: "http",
      host: "10.10.168.200",
      port: 8086,
      pathPrefix: "/api",
      weight: 3,
    });
    expect(backendInstanceBaseUrl(instance!)).toBe("http://10.10.168.200:8086/api");
  });

  it("selects the highest weight instance and breaks ties by id", () => {
    const picked = pickBackendServiceInstance([
      JSON.stringify({ id: "b", host: "10.0.0.2", port: 8080, weight: 5 }),
      JSON.stringify({ id: "a", host: "10.0.0.1", port: 8080, weight: 5 }),
      JSON.stringify({ id: "c", host: "10.0.0.3", port: 8080, weight: 1 }),
    ]);

    expect(picked?.id).toBe("a");
    expect(backendInstanceBaseUrl(picked!)).toBe("http://10.0.0.1:8080/byaiService");
  });

  it("defaults path_prefix to /byaiService when Redis registration omits it", () => {
    const instance = parseBackendServiceInstance(
      JSON.stringify({
        id: "ByaiService:e978c145",
        protocol: "http",
        host: "10.10.168.203",
        port: 8086,
        path_prefix: null,
        weight: 1,
      }),
    );

    expect(instance?.pathPrefix).toBe("byaiService");
    expect(backendInstanceBaseUrl(instance!)).toBe("http://10.10.168.203:8086/byaiService");
  });
});
