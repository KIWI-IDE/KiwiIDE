import { describe, expect, it, vi } from "vitest";

const { DockerService } = require("../electron/services/docker-service.cjs");

describe("DockerService", () => {
  it("detects installed Docker version", async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: "Docker version 27.1.1, build 6312585\n", stderr: "" }));
    const service = new DockerService(null, { run });
    const status = await service.checkInstalled();
    expect(status).toEqual({
      available: true,
      version: "Docker version 27.1.1, build 6312585",
    });
  });

  it("parses container and image JSON lines", async () => {
    const run = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "ps") {
        return {
          code: 0,
          stdout: `${JSON.stringify({
            ID: "c12345",
            Names: "kiwi-postgres",
            Image: "postgres:16",
            Status: "Up 2 hours",
            State: "running",
            Ports: "5432/tcp",
            CreatedAt: "2026-10-31",
          })}\n`,
          stderr: "",
        };
      }
      return {
        code: 0,
        stdout: `${JSON.stringify({
          ID: "img987",
          Repository: "postgres",
          Tag: "16",
          Size: "412MB",
          CreatedSince: "2 weeks ago",
        })}\n`,
        stderr: "",
      };
    });

    const service = new DockerService(null, { run });
    const containers = await service.listContainers(true);
    expect(containers).toEqual([
      {
        id: "c12345",
        names: "kiwi-postgres",
        image: "postgres:16",
        status: "Up 2 hours",
        state: "running",
        ports: "5432/tcp",
        created: "2026-10-31",
      },
    ]);

    const images = await service.listImages();
    expect(images).toEqual([
      {
        id: "img987",
        repository: "postgres",
        tag: "16",
        size: "412MB",
        created: "2 weeks ago",
      },
    ]);
  });

  it("validates container IDs and actions before running docker commands", async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: "c12345\n", stderr: "" }));
    const service = new DockerService(null, { run });

    await expect(service.containerAction("c12345", "invalid")).rejects.toThrow("Ungültige Docker-Aktion");
    await expect(service.containerAction("bad;id", "start")).rejects.toThrow("Ungültige Container-ID");

    const res = await service.containerAction("c12345", "restart");
    expect(res.success).toBe(true);
    expect(run).toHaveBeenCalledWith("docker", ["restart", "c12345"]);
  });

  it("executes docker compose actions within guarded workspace root", async () => {
    const guard = { assertWorkspace: vi.fn((r: string) => r) };
    const run = vi.fn(async () => ({ code: 0, stdout: "Started", stderr: "" }));
    const service = new DockerService(guard, { run });

    await expect(service.composeAction("/proj", "rm")).rejects.toThrow("Ungültige Compose-Aktion");
    const up = await service.composeAction("/proj", "up");
    expect(up).toEqual({ success: true, output: "Started" });
    expect(guard.assertWorkspace).toHaveBeenCalledWith("/proj");
    expect(run).toHaveBeenCalledWith("docker", ["compose", "up", "-d"], { cwd: "/proj" });
  });
});
