import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDailyReports } from "@/lib/report";
import { POST } from "./route";

vi.mock("@/lib/report", () => ({ generateDailyReports: vi.fn() }));
const generate = vi.mocked(generateDailyReports);

const call = (auth?: string) => POST(new Request("http://app/api/reports/daily", { method: "POST", headers: auth ? { authorization: auth } : {} }));

describe("POST /api/reports/daily", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    generate.mockReset();
  });

  it("sans en-tête ou mauvais jeton : 401", async () => {
    vi.stubEnv("CRON_TOKEN", "secret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer faux!!")).status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });

  it("CRON_TOKEN vide : tout est refusé", async () => {
    vi.stubEnv("CRON_TOKEN", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });

  it("bon jeton : 200 avec le nombre de rapports créés", async () => {
    vi.stubEnv("CRON_TOKEN", "secret");
    generate.mockResolvedValue(2);
    const r = await call("Bearer secret");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ created: 2 });
    expect(generate).toHaveBeenCalledWith(expect.any(Date));
  });
});
