const configuredApiBase = (
  import.meta.env.VITE_API_BASE_URL as string | undefined
)?.trim();
const shouldUseDevProxy =
  import.meta.env.DEV &&
  String(import.meta.env.VITE_USE_API_PROXY ?? "true").toLowerCase() !==
    "false";

export const API_BASE = shouldUseDevProxy
  ? ""
  : configuredApiBase || "http://127.0.0.1:8000";
export const TOKEN_KEY = "authToken";
export const REFRESH_TOKEN_KEY = "refreshToken";
const USER_KEY = "authUser";

export interface AuthCredentials {
  email: string;
  fscCode: string;
}

export interface OtpVerification {
  email: string;
  otp: string;
}

export interface OtpResponse {
  sent: boolean;
  expiresIn: number;
}

export interface AuthService {
  requestOtp(credentials: AuthCredentials): Promise<OtpResponse>;
  verifyOtp(verification: OtpVerification): Promise<void>;
  signOut(): Promise<void>;
  forceSignOutLocal(redirectTo?: string): void;
  getCurrentUser(): AuthUser | null;
  ensureSession(forceRefresh?: boolean): Promise<boolean>;
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void;
}

export type AuthUser = {
  uid: string;
  email: string | null;
  accessLevel?: string;
  nickname?: string;
  fullName?: string;
};

export interface AuthError {
  code: string;
  message: string;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

type AuthedRequestOptions = {
  defaultErrorMessage?: string;
  suppressUnauthorizedSignOut?: boolean;
};

type VerifyOtpApiResponse = {
  token: string;
  refreshToken?: string;
  user?: {
    id: string | number;
    email?: string;
    accessLevel?: string;
    nickname?: string;
    fullName?: string;
  };
};

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Validate OTP format (6 digits)
 */
export function validateOtp(otp: string): string {
  const trimmed = otp.trim();

  if (!trimmed) {
    return "OTP is required";
  }

  if (!trimmed.match(/^[0-9]{6}$/)) {
    return "OTP must be exactly 6 digits";
  }

  return "";
}

/**
 * Validate FSC code format (exactly 5 digits)
 */
export function validateFscCode(fscCode: string): string {
  const trimmed = fscCode.trim();

  if (!trimmed) {
    return "FSC code is required";
  }

  if (!trimmed.match(/^[0-9]{5}$/)) {
    return "FSC code must be exactly 5 digits";
  }

  return "";
}

class ApiAuthService implements AuthService {
  private token: string | null = localStorage.getItem(TOKEN_KEY);
  private refreshToken: string | null = localStorage.getItem(REFRESH_TOKEN_KEY);
  private currentUser: AuthUser | null = safeJsonParse<AuthUser>(
    localStorage.getItem(USER_KEY),
  );
  private subscribers = new Set<(user: AuthUser | null) => void>();
  private refreshPromise: Promise<boolean> | null = null;

  constructor() {
    if (!this.token && !this.refreshToken && this.currentUser) {
      this.clearAuth(false);
      return;
    }

    if (this.token && !this.currentUser) {
      void this.refreshCurrentUser();
      return;
    }

    if (!this.token && this.refreshToken) {
      void this.refreshAccessToken();
    }
  }

  private notify(): void {
    this.subscribers.forEach((subscriber) => subscriber(this.currentUser));
  }

  private toAuthUser(
    raw: VerifyOtpApiResponse["user"] | null | undefined,
  ): AuthUser {
    return {
      uid: String(raw?.id ?? ""),
      email: raw?.email || null,
      accessLevel: raw?.accessLevel || "",
      nickname: raw?.nickname || "",
      fullName: raw?.fullName || "",
    };
  }

  private saveAuth(token: string, user: AuthUser, refreshToken?: string): void {
    this.token = token;
    this.currentUser = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (refreshToken) {
      this.refreshToken = refreshToken;
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
    this.notify();
  }

  private clearAuth(notify: boolean = true): void {
    this.token = null;
    this.refreshToken = null;
    this.currentUser = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (notify) this.notify();
  }

  forceSignOutLocal(redirectTo: string = "/"): void {
    this.clearAuth();
    if (typeof window !== "undefined") {
      window.location.replace(redirectTo);
    }
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) {
      this.clearAuth();
      return false;
    }
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        });

        let payload: VerifyOtpApiResponse | null = null;
        try {
          payload = (await response.json()) as VerifyOtpApiResponse;
        } catch {
          payload = null;
        }

        if (!response.ok || !payload?.token) {
          if (isRefreshAuthFailure(response.status)) {
            this.clearAuth();
          }
          return false;
        }

        const user = this.toAuthUser(payload.user);
        this.saveAuth(payload.token, user, payload.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    requiresAuth: boolean = false,
    isRetry: boolean = false,
  ): Promise<T> {
    const headers = new Headers(init.headers || {});
    headers.set("Content-Type", "application/json");

    if (requiresAuth && !this.token) {
      const ok = await this.refreshAccessToken();
      if (!ok || !this.token) {
        throw new Error("Session expired. Please sign in again.");
      }
    }

    if (requiresAuth && this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }

    let response: Response;
    try {
      response = await fetch(resolveApiUrl(path), {
        ...init,
        headers,
      });
    } catch (error) {
      if (requiresAuth) {
        throw new Error(
          "Unable to reach server. Please check your connection and try again.",
        );
      }
      throw error;
    }

    let payload: any = null;
    let fallbackText: string | null = null;
    try {
      payload = await response.clone().json();
    } catch {
      payload = null;
      try {
        const raw = await response.text();
        fallbackText = raw.trim() || null;
      } catch {
        fallbackText = null;
      }
    }

    if (!response.ok) {
      if (requiresAuth && response.status === 401 && !isRetry) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          return this.requestJson<T>(path, init, requiresAuth, true);
        }
        if (!this.token) {
          this.forceSignOutLocal("/");
        }
      } else if (response.status === 401) {
        this.forceSignOutLocal("/");
      }

      const message =
        firstValidationMessage(payload?.errors) ||
        payload?.message ||
        fallbackText ||
        (response.status === 429
          ? "Too many attempts. Please wait and try again"
          : "Something went wrong. Please try again");
      throw new Error(message);
    }

    if (response.status !== 204 && payload === null) {
      throw new Error("Server returned an unexpected response.");
    }

    return payload as T;
  }

  private async refreshCurrentUser(): Promise<void> {
    if (!this.token) {
      const ok = await this.refreshAccessToken();
      if (!ok) {
        this.clearAuth(false);
      }
      return;
    }

    try {
      const payload = await this.requestJson<{
        id: string | number;
        email?: string;
        accessLevel?: string;
        nickname?: string;
        fullName?: string;
      }>("/api/auth/me", { method: "GET" }, true);

      const mapped = this.toAuthUser({
        id: payload.id,
        email: payload.email,
        accessLevel: payload.accessLevel,
        nickname: payload.nickname,
        fullName: payload.fullName,
      });
      this.currentUser = mapped;
      localStorage.setItem(USER_KEY, JSON.stringify(mapped));
      this.notify();
    } catch (error) {
      if (
        error instanceof Error &&
        isLikelyConnectivityErrorMessage(error.message)
      ) {
        return;
      }
      this.clearAuth();
    }
  }

  async requestOtp(credentials: AuthCredentials): Promise<OtpResponse> {
    return this.requestJson<OtpResponse>(
      "/api/auth/request-otp",
      {
        method: "POST",
        body: JSON.stringify({
          email: credentials.email,
          fscCode: credentials.fscCode,
        }),
      },
      false,
    );
  }

  async verifyOtp(verification: OtpVerification): Promise<void> {
    const payload = await this.requestJson<VerifyOtpApiResponse>(
      "/api/auth/verify-otp",
      {
        method: "POST",
        body: JSON.stringify({
          email: verification.email,
          otp: verification.otp,
        }),
      },
      false,
    );

    if (!payload?.token) {
      throw new Error("Missing authentication token");
    }

    const user = this.toAuthUser(payload.user);
    this.saveAuth(payload.token, user, payload.refreshToken);
  }

  async signOut(): Promise<void> {
    try {
      if (this.token) {
        await this.requestJson<{ success: boolean }>(
          "/api/auth/logout",
          { method: "POST" },
          true,
        );
      }
    } finally {
      this.forceSignOutLocal("/");
    }
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  async ensureSession(forceRefresh: boolean = false): Promise<boolean> {
    const persistedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (persistedRefresh && persistedRefresh !== this.refreshToken) {
      this.refreshToken = persistedRefresh;
    }

    const persisted = localStorage.getItem(TOKEN_KEY);
    if (!persisted) {
      this.token = null;
    } else if (!this.token) {
      this.token = persisted;
    }

    if (forceRefresh) {
      return this.refreshAccessToken();
    }

    if (this.token) {
      return true;
    }
    return this.refreshAccessToken();
  }

  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
    this.subscribers.add(callback);
    callback(this.currentUser);

    return () => {
      this.subscribers.delete(callback);
    };
  }
}

export const authService: AuthService = new ApiAuthService();

function normalizeApiPath(path: string): string {
  let normalized = path.startsWith("/") ? path : `/${path}`;

  // Guard against accidental SPA-route paths being passed into API fetches.
  if (normalized === "/admin" || normalized.startsWith("/admin/")) {
    normalized = normalized.replace(/^\/admin/, "");
    if (!normalized) normalized = "/";
  }

  // Preserve compatibility with the old report-template path.
  const normalizedWithoutTrailingSlash =
    normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  if (normalizedWithoutTrailingSlash === "/report-templates") {
    return "/api/reports";
  }

  if (
    normalized !== "/api" &&
    !normalized.startsWith("/api/") &&
    normalized !== "/sanctum" &&
    !normalized.startsWith("/sanctum/")
  ) {
    normalized = `/api${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
  }

  return normalized;
}

function resolveApiUrl(path: string): string {
  const rawPath = String(path || "").trim();
  if (!rawPath) {
    throw new Error("Invalid API path");
  }

  if (/^https?:\/\//i.test(rawPath)) {
    try {
      const parsed = new URL(rawPath);
      const pathnameWithoutTrailingSlash =
        parsed.pathname.length > 1
          ? parsed.pathname.replace(/\/+$/, "")
          : parsed.pathname;
      const isAdminRoute =
        parsed.pathname === "/admin" || parsed.pathname.startsWith("/admin/");
      const isLegacyReportTemplatesRoute =
        pathnameWithoutTrailingSlash === "/report-templates";

      if (isAdminRoute || isLegacyReportTemplatesRoute) {
        const normalizedPath = normalizeApiPath(parsed.pathname);
        const base = API_BASE || parsed.origin;
        return `${base}${normalizedPath}${parsed.search}`;
      }
    } catch {
      return rawPath;
    }

    return rawPath;
  }

  return `${API_BASE}${normalizeApiPath(rawPath)}`;
}

function withAuthHeaders(init: RequestInit, token: string): Headers {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  const body = init.body;
  const isFormData =
    typeof FormData !== "undefined" && body instanceof FormData;
  if (body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

export async function authFetch(
  path: string,
  init: RequestInit = {},
  isRetry: boolean = false,
  options: AuthedRequestOptions = {},
): Promise<Response> {
  let token = getAuthToken();
  if (!token) {
    const ok = await authService.ensureSession();
    if (ok) token = getAuthToken();
  }
  if (!token) {
    throw new Error("Not authenticated");
  }

  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      ...init,
      headers: withAuthHeaders(init, token),
    });
  } catch (error) {
    throw new Error(
      "Unable to reach server. Please check your connection and try again.",
    );
  }

  if (response.status === 401 && !isRetry) {
    const refreshed = await authService.ensureSession(true);
    if (refreshed) {
      return authFetch(path, init, true, options);
    }
    if (!options.suppressUnauthorizedSignOut && !getAuthToken()) {
      authService.forceSignOutLocal("/");
    }
  } else if (response.status === 401) {
    if (!options.suppressUnauthorizedSignOut) {
      authService.forceSignOutLocal("/");
    }
  }

  return response;
}

export async function authJson<T>(
  path: string,
  init: RequestInit = {},
  options: AuthedRequestOptions = {},
): Promise<T> {
  const response = await authFetch(path, init, false, options);

  let payload: any = null;
  let fallbackText: string | null = null;
  try {
    payload = await response.clone().json();
  } catch {
    payload = null;
    try {
      const raw = await response.text();
      fallbackText = raw.trim() || null;
    } catch {
      fallbackText = null;
    }
  }

  if (!response.ok) {
    const message =
      firstValidationMessage(payload?.errors) ||
      payload?.message ||
      fallbackErrorMessage(fallbackText) ||
      (response.status === 401
        ? "Unauthenticated."
        : options.defaultErrorMessage || "Request failed");
    throw new Error(message);
  }

  return payload as T;
}

function isRefreshAuthFailure(status: number): boolean {
  return status === 401 || status === 403 || status === 422;
}

function isLikelyConnectivityErrorMessage(message: string): boolean {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("unable to reach server") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("network request failed") ||
    normalized.includes("load failed")
  );
}

function firstValidationMessage(errors: unknown): string | null {
  if (!errors || typeof errors !== "object") {
    return null;
  }

  for (const value of Object.values(errors as Record<string, unknown>)) {
    if (typeof value === "string") {
      const text = value.trim();
      if (text) return text;
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const text = String(item || "").trim();
        if (text) return text;
      }
    }
  }

  return null;
}

function fallbackErrorMessage(rawText: string | null): string | null {
  const text = String(rawText || "").trim();
  if (!text) {
    return null;
  }

  if (text.startsWith("<")) {
    const htmlMessage = extractHtmlErrorMessage(text);
    return htmlMessage ? truncateMessage(htmlMessage) : null;
  }

  const [firstLine] = text.split(/\r?\n/, 1);
  return truncateMessage(firstLine?.trim() || text);
}

function extractHtmlErrorMessage(html: string): string | null {
  const sqlStateMatch = html.match(/SQLSTATE\[[^\r\n<]+/i);
  if (sqlStateMatch?.[0]) {
    return sqlStateMatch[0].trim();
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    return decodeHtmlEntities(titleMatch[1]).trim();
  }

  const headingMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (headingMatch?.[1]) {
    return decodeHtmlEntities(headingMatch[1]).trim();
  }

  return null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function truncateMessage(text: string, maxLength: number = 220): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}
