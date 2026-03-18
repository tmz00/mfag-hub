import { beforeEach, describe, expect, it, vi } from "vitest";

const loadAuthModule = async () => {
  vi.resetModules();
  return import("./authService");
};

describe("authService", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("stores token, refresh token, and user after verifyOtp", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "access-token",
          refreshToken: "refresh-token",
          user: {
            id: 7,
            email: "user@example.test",
            accessLevel: "editor",
            nickname: "Tester",
            fullName: "Test User",
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();
    const subscriber = vi.fn();
    const unsubscribe = mod.authService.onAuthStateChanged(subscriber);

    await mod.authService.verifyOtp({
      email: "user@example.test",
      otp: "123456",
    });

    expect(localStorage.getItem(mod.TOKEN_KEY)).toBe("access-token");
    expect(localStorage.getItem(mod.REFRESH_TOKEN_KEY)).toBe("refresh-token");
    expect(mod.authService.getCurrentUser()).toEqual({
      uid: "7",
      email: "user@example.test",
      accessLevel: "editor",
      nickname: "Tester",
      fullName: "Test User",
    });
    expect(subscriber).toHaveBeenLastCalledWith({
      uid: "7",
      email: "user@example.test",
      accessLevel: "editor",
      nickname: "Tester",
      fullName: "Test User",
    });

    unsubscribe();
  });

  it("adds Authorization header for authFetch when token exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();
    localStorage.setItem(mod.TOKEN_KEY, "token-1");

    await mod.authFetch("/api/team", { method: "GET" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer token-1");
  });

  it("retries once after 401 when refresh succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Unauthenticated." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();
    localStorage.setItem(mod.TOKEN_KEY, "old-token");

    const ensureSpy = vi
      .spyOn(mod.authService, "ensureSession")
      .mockImplementation(async (forceRefresh?: boolean) => {
        if (forceRefresh) {
          localStorage.setItem(mod.TOKEN_KEY, "new-token");
        }
        return true;
      });

    const response = await mod.authFetch("/api/team", { method: "GET" });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ensureSpy).toHaveBeenCalledWith(true);

    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondHeaders = new Headers(secondInit.headers);
    expect(secondHeaders.get("Authorization")).toBe("Bearer new-token");
  });

  it("forces sign-out after 401 when refresh fails", async () => {
    const fetchMock = vi.mocked(vi.fn()).mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthenticated." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();
    localStorage.setItem(mod.TOKEN_KEY, "old-token");

    vi.spyOn(mod.authService, "ensureSession").mockImplementation(
      async (forceRefresh?: boolean) => {
        if (forceRefresh) {
          localStorage.removeItem(mod.TOKEN_KEY);
        }
        return false;
      },
    );
    const signOutSpy = vi
      .spyOn(mod.authService, "forceSignOutLocal")
      .mockImplementation(() => {});

    const response = await mod.authFetch("/api/team", { method: "GET" });

    expect(response.status).toBe(401);
    expect(signOutSpy).toHaveBeenCalledWith("/");
  });

  it("does not force sign-out after 401 when refresh fails but token still exists", async () => {
    const fetchMock = vi.mocked(vi.fn()).mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthenticated." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();
    localStorage.setItem(mod.TOKEN_KEY, "old-token");

    vi.spyOn(mod.authService, "ensureSession").mockResolvedValue(false);
    const signOutSpy = vi
      .spyOn(mod.authService, "forceSignOutLocal")
      .mockImplementation(() => {});

    const response = await mod.authFetch("/api/team", { method: "GET" });

    expect(response.status).toBe(401);
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it("keeps local auth tokens when refresh request fails due network", async () => {
    localStorage.setItem("authToken", "old-token");
    localStorage.setItem("refreshToken", "refresh-token");

    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();
    const ok = await mod.authService.ensureSession(true);

    expect(ok).toBe(false);
    expect(localStorage.getItem(mod.TOKEN_KEY)).toBe("old-token");
    expect(localStorage.getItem(mod.REFRESH_TOKEN_KEY)).toBe("refresh-token");
  });

  it("uses backend validation message in authJson errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: {
            email: ["Email invalid"],
          },
        }),
        {
          status: 422,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();
    localStorage.setItem(mod.TOKEN_KEY, "token-1");

    await expect(mod.authJson("/api/team", { method: "GET" })).rejects.toThrow(
      "Email invalid",
    );
  });

  it("validates FSC codes as exactly five digits", async () => {
    const mod = await loadAuthModule();

    expect(mod.validateFscCode("")).toBe("FSC code is required");
    expect(mod.validateFscCode("1234")).toBe("FSC code must be exactly 5 digits");
    expect(mod.validateFscCode("12A45")).toBe("FSC code must be exactly 5 digits");
    expect(mod.validateFscCode("12345")).toBe("");
  });

  it("surfaces a useful message from html error responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        "<!doctype html><html><head><title>SQLSTATE[42S02]: Base table or view not found</title></head><body>Server Error</body></html>",
        {
          status: 500,
          headers: { "Content-Type": "text/html" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();
    localStorage.setItem(mod.TOKEN_KEY, "token-1");

    await expect(mod.authJson("/api/team", { method: "GET" })).rejects.toThrow(
      "SQLSTATE[42S02]: Base table or view not found",
    );
  });

  it("throws a clear message when authFetch receives an SG captcha challenge", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><title>Captcha</title></html>", {
        status: 202,
        headers: {
          "Content-Type": "text/html",
          "sg-captcha": "challenge",
          "x-robots-tag": "noindex",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();
    localStorage.setItem(mod.TOKEN_KEY, "token-1");

    await expect(mod.authFetch("/api/team", { method: "GET" })).rejects.toThrow(
      "Open the main website https://mfag.sg",
    );
  });

  it("throws a clear message when OTP request receives an SG captcha challenge", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><title>Captcha</title></html>", {
        status: 202,
        headers: {
          "Content-Type": "text/html",
          "sg-captcha": "challenge",
          "x-robots-tag": "noindex",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();

    await expect(
      mod.authService.requestOtp({
        email: "user@example.test",
        fscCode: "12345",
      }),
    ).rejects.toThrow("Open the main website https://mfag.sg");
  });

  it("throws a clear message when refresh token request receives an SG captcha challenge", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><title>Captcha</title></html>", {
        status: 202,
        headers: {
          "Content-Type": "text/html",
          "sg-captcha": "challenge",
          "x-robots-tag": "noindex",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();
    localStorage.setItem(mod.REFRESH_TOKEN_KEY, "refresh-token");

    await expect(mod.authService.ensureSession(true)).rejects.toThrow(
      "Open the main website https://mfag.sg",
    );
    expect(localStorage.getItem(mod.REFRESH_TOKEN_KEY)).toBe("refresh-token");
  });

  it("surfaces captcha guidance when authFetch needs refresh before request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html><title>Captcha</title></html>", {
        status: 202,
        headers: {
          "Content-Type": "text/html",
          "sg-captcha": "challenge",
          "x-robots-tag": "noindex",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await loadAuthModule();
    localStorage.setItem(mod.REFRESH_TOKEN_KEY, "refresh-token");

    await expect(mod.authFetch("/api/team", { method: "GET" })).rejects.toThrow(
      "Open the main website https://mfag.sg",
    );
  });
});
