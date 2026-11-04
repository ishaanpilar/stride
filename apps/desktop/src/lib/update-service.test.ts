import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdates,
  findPortableZipAsset,
  getFlatpakInstallChannel,
  MS_STORE_UPDATES_URL,
  normalizeInstallSource,
  UPDATE_RATE_LIMIT_MESSAGE,
  UpdateRateLimitedError,
} from "./update-service";
import tauriConfig from "../../src-tauri/tauri.conf.json";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const atomResponse = (tags: string[], status = 200): Response =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${tags
      .map(
        (tag) =>
          `<entry><id>tag:github.com,2008:Repository/1/${tag}</id><link type="text/html" rel="alternate" href="https://github.com/ishaanpilar/stride/releases/tag/${tag}"/><title>${tag}</title></entry>`,
      )
      .join("")}</feed>`,
    { status, headers: { "Content-Type": "application/atom+xml" } },
  );

const originalFetch = globalThis.fetch;
const originalUserAgent = navigator.userAgent;

describe("update-service channel selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: originalUserAgent,
    });
  });

  it("falls back to github when managed source lookup fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("itunes.apple.com/lookup")) {
        return jsonResponse({}, 500);
      }
      if (
        url.includes("api.github.com/repos/ishaanpilar/stride/releases/latest")
      ) {
        return jsonResponse({
          tag_name: "v1.2.0",
          html_url: "https://github.com/ishaanpilar/stride/releases/tag/v1.2.0",
          body: "latest notes",
          assets: [],
        });
      }
      return jsonResponse({}, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await checkForUpdates("1.0.0", {
      installSource: "mac-app-store",
    });

    expect(result.hasUpdate).toBe(true);
    expect(result.source).toBe("github-release");
    expect(result.latestVersion).toBe("1.2.0");
  });

  it.each([
    "mac-app-store",
    "homebrew",
    "winget",
    "chocolatey",
    "aur-bin",
    "aur-source",
    "microsoft-store",
  ] as const)(
    "checks only GitHub releases of ishaanpilar/stride for %s installs",
    async (installSource) => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.github.com/repos/ishaanpilar/stride/releases/latest")) {
          return jsonResponse({
            tag_name: "v9.0.0",
            html_url: "https://github.com/ishaanpilar/stride/releases/tag/v9.0.0",
            body: "notes",
            assets: [],
          });
        }
        return jsonResponse({}, 404);
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await checkForUpdates("1.0.0", { installSource });

      expect(result.source).toBe("github-release");
      expect(result.latestVersion).toBe("9.0.0");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toContain("ishaanpilar/stride");
    },
  );

  it("normalizes scoop and chocolatey installs", () => {
    expect(normalizeInstallSource("scoop")).toBe("scoop");
    expect(normalizeInstallSource("SCOOP")).toBe("scoop");
    expect(normalizeInstallSource("chocolatey")).toBe("chocolatey");
    expect(normalizeInstallSource("choco")).toBe("chocolatey");
  });

  it("reports the GitHub release for scoop manual checks without a bucket lookup", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url.includes("api.github.com/repos/ishaanpilar/stride/releases/latest")
      ) {
        return jsonResponse({
          tag_name: "v1.9.0",
          html_url: "https://github.com/ishaanpilar/stride/releases/tag/v1.9.0",
          body: "latest notes",
          assets: [],
        });
      }
      return jsonResponse({}, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await checkForUpdates("1.0.0", { installSource: "scoop" });

    expect(result.hasUpdate).toBe(true);
    expect(result.source).toBe("github-release");
    expect(result.latestVersion).toBe("1.9.0");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes flatpak branch installs while keeping the branch available for UI display", () => {
    expect(normalizeInstallSource("flatpak:test")).toBe("flatpak");
    expect(normalizeInstallSource("flatpak:master")).toBe("flatpak");
    expect(getFlatpakInstallChannel("flatpak:test")).toBe("test");
    expect(getFlatpakInstallChannel("flatpak:master")).toBe("master");
  });

  it("prefers the portable zip asset for portable windows installs", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url.includes("api.github.com/repos/ishaanpilar/stride/releases/latest")
      ) {
        return jsonResponse({
          tag_name: "v1.2.0",
          html_url: "https://github.com/ishaanpilar/stride/releases/tag/v1.2.0",
          body: "latest notes",
          assets: [
            {
              name: "stride_1.2.0_x64-setup.exe",
              browser_download_url:
                "https://example.com/stride_1.2.0_x64-setup.exe",
            },
            {
              name: "stride_1.2.0_windows_x64_portable.zip",
              browser_download_url:
                "https://example.com/stride_1.2.0_windows_x64_portable.zip",
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await checkForUpdates("1.0.0", {
      installSource: "portable",
    });

    expect(result.downloadUrl).toBe(
      "https://example.com/stride_1.2.0_windows_x64_portable.zip",
    );
    expect(normalizeInstallSource("portable")).toBe("portable");
  });

  it("allows the Microsoft Store updates page through the Tauri shell scope", () => {
    const openScope = tauriConfig.plugins.shell.open;

    expect(new RegExp(openScope).test(MS_STORE_UPDATES_URL)).toBe(true);
  });

  it("prefers explicitly windows-named portable assets when multiple portable zips exist", () => {
    const asset = findPortableZipAsset([
      { name: "stride_1.2.0_portable.zip", url: "https://example.com/generic.zip" },
      {
        name: "stride_1.2.0_windows_x64_portable.zip",
        url: "https://example.com/windows.zip",
      },
    ]);

    expect(asset?.name).toBe("stride_1.2.0_windows_x64_portable.zip");
  });

  it("falls back to the releases.atom feed when the GitHub API is rate-limited (newer version)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.github.com/repos/ishaanpilar/stride/releases/latest")) {
        return jsonResponse({}, 403);
      }
      if (url.includes("github.com/ishaanpilar/stride/releases.atom")) {
        return atomResponse(["v1.9.0", "v1.8.0"]);
      }
      return jsonResponse({}, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await checkForUpdates("1.0.0", {
      installSource: "github-release",
    });

    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe("1.9.0");
    expect(result.source).toBe("github-release");
    expect(result.releaseNotes).toBe("");
    expect(result.assets).toEqual([]);
    expect(result.downloadUrl).toBeNull();
    expect(result.releaseUrl).toBe(
      "https://github.com/ishaanpilar/stride/releases/tag/v1.9.0",
    );
  });

  it("falls back to the releases.atom feed when rate-limited (already up to date)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.github.com/repos/ishaanpilar/stride/releases/latest")) {
        return jsonResponse({}, 429);
      }
      if (url.includes("github.com/ishaanpilar/stride/releases.atom")) {
        return atomResponse(["v1.0.0"]);
      }
      return jsonResponse({}, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await checkForUpdates("1.0.0", {
      installSource: "github-release",
    });

    expect(result.hasUpdate).toBe(false);
    expect(result.releaseNotes).toBe("");
    expect(result.assets).toEqual([]);
    expect(result.downloadUrl).toBeNull();
  });

  it("does not consult the atom feed when the GitHub API succeeds", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.github.com/repos/ishaanpilar/stride/releases/latest")) {
        return jsonResponse({
          tag_name: "v1.9.0",
          html_url: "https://github.com/ishaanpilar/stride/releases/tag/v1.9.0",
          body: "latest notes",
          assets: [],
        });
      }
      return jsonResponse({}, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await checkForUpdates("1.0.0", {
      installSource: "github-release",
    });

    expect(result.hasUpdate).toBe(true);
    expect(result.releaseNotes).toBe("latest notes");
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("releases.atom"),
      ),
    ).toBe(false);
  });

  it("surfaces a calm rate-limit message when both the API and the atom feed are rate-limited", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.github.com/repos/ishaanpilar/stride/releases/latest")) {
        return jsonResponse({}, 403);
      }
      if (url.includes("github.com/ishaanpilar/stride/releases.atom")) {
        return atomResponse([], 429);
      }
      return jsonResponse({}, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      checkForUpdates("1.0.0", { installSource: "github-release" }),
    ).rejects.toMatchObject(
      expect.objectContaining({
        message: UPDATE_RATE_LIMIT_MESSAGE,
      }),
    );
    await expect(
      checkForUpdates("1.0.0", { installSource: "github-release" }),
    ).rejects.toBeInstanceOf(UpdateRateLimitedError);
  });

  it("leaves non-403 GitHub API errors unchanged (no atom fallback attempted)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.github.com/repos/ishaanpilar/stride/releases/latest")) {
        return jsonResponse({}, 500);
      }
      return jsonResponse({}, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      checkForUpdates("1.0.0", { installSource: "github-release" }),
    ).rejects.toThrow("GitHub API error: 500");
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes("releases.atom"),
      ),
    ).toBe(false);
  });
});
