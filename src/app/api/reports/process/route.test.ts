import { afterEach, describe, expect, it, vi } from "vitest";
import { processNextReport } from "@/lib/report";
import { encryptLegacyKeys } from "@/lib/llm";
import { POST } from "./route";
vi.mock("@/lib/report", () => ({ processNextReport: vi.fn() }));
vi.mock("@/lib/llm", () => ({ encryptLegacyKeys: vi.fn() }));
const call = (token?: string) => POST(new Request("http://app/api/reports/process", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe("report worker authorization", () => {
  it("does no work without the exact server token", async () => {
    vi.stubEnv("CRON_TOKEN", "worker-test-token");
    expect((await call()).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
    vi.stubEnv("CRON_TOKEN", "");
    expect((await call()).status).toBe(401);
    expect(processNextReport).not.toHaveBeenCalled();
    expect(encryptLegacyKeys).not.toHaveBeenCalled();
  });
  it("migrates keys and processes work only after authorization", async () => {
    vi.stubEnv("CRON_TOKEN", "worker-test-token");
    vi.mocked(processNextReport).mockResolvedValue(true);
    expect(await (await call("worker-test-token")).json()).toEqual({ processed: true });
    expect(encryptLegacyKeys).toHaveBeenCalledTimes(1);
    expect(processNextReport).toHaveBeenCalledTimes(1);
  });
});
