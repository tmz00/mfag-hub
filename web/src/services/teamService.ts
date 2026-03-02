import { authService, authJson } from "./authService";

// ============ Types ============

export type TeamUser = {
  id: string;
  nickname?: string;
  fullName?: string;
  email?: string;
  accessLevel?: string;
  fscCode?: string;
  agencyCode?: string;
  birthMonth?: number;
  birthDay?: number;
  birthYear?: number;
  contractMonth?: number;
  contractDay?: number;
  contractYear?: number;
};

export type TeamAgency = {
  code: string;
  name: string;
  isActive?: boolean;
  isDeleted?: boolean;
};

export type TeamData = {
  users: TeamUser[];
  agencies: TeamAgency[];
  updatedBy?: string;
  updatedAt?: string;
};

export type TeamBackup = {
  id: string;
  data: TeamData;
  createdAt?: Date;
  expiresAt?: Date;
};

export type CreateUserPayload = {
  email: string;
  fscCode: string;
  agencyCode: string;
  accessLevel?: string;
};

export type UpdateUserPayload = {
  uid: string;
  email: string;
  fscCode: string;
  nickname?: string;
  fullName?: string;
  agencyCode: string;
  accessLevel?: string;
  birthDate?: string;
  contractDate?: string;
};

export type BulkUpdateUsersPayload = {
  updates: Array<{ uid: string; agencyCode: string }>;
};

// ============ Helpers ============

export const isStaffUser = (fscCode?: string | null) =>
  String(fscCode || "").startsWith("00");

// ============ Service ============

type TeamApiResponse = {
  users?: Array<Record<string, unknown>>;
  agencies?: Array<Record<string, unknown>>;
};

type TeamDataOptions = {
  includeDeletedAgencies?: boolean;
};

class TeamService {
  private readonly refreshMs = 15000;
  private cachedTeamData: TeamData | null = null;

  private toBoolean(value: unknown, defaultValue = true): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return defaultValue;
      if (["1", "true", "yes", "y"].includes(normalized)) return true;
      if (["0", "false", "no", "n"].includes(normalized)) return false;
      return defaultValue;
    }
    return defaultValue;
  }

  private normalizeBirthParts(data: any) {
    const toNumber = (value: any) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : undefined;
    };

    let birthMonth = toNumber(data.birthMonth ?? data.birth_month);
    let birthDay = toNumber(data.birthDay ?? data.birth_day);
    let birthYear = toNumber(data.birthYear ?? data.birth_year);

    const birthDateStr = (data.birthDate as string) || "";
    const matches = birthDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if ((!birthMonth || !birthDay) && matches) {
      const [, year, month, day] = matches;
      birthMonth = birthMonth || toNumber(month);
      birthDay = birthDay || toNumber(day);
      birthYear = birthYear || toNumber(year);
    }

    const compact = (data.birthDate as string) || "";
    const compactMatch = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
    if ((!birthMonth || !birthDay) && compactMatch) {
      const [, year, month, day] = compactMatch;
      birthYear = birthYear || toNumber(year);
      birthMonth = birthMonth || toNumber(month);
      birthDay = birthDay || toNumber(day);
    }

    return { birthMonth, birthDay, birthYear };
  }

  private normalizeContractParts(data: any) {
    const toNumber = (value: any) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : undefined;
    };

    let contractMonth = toNumber(data.contractMonth ?? data.contract_month);
    let contractDay = toNumber(data.contractDay ?? data.contract_day);
    let contractYear = toNumber(data.contractYear ?? data.contract_year);

    const contractDateStr = (data.contractDate ?? data.contract_date) || "";
    const matches = contractDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if ((!contractMonth || !contractDay) && matches) {
      const [, year, month, day] = matches;
      contractMonth = contractMonth || toNumber(month);
      contractDay = contractDay || toNumber(day);
      contractYear = contractYear || toNumber(year);
    }

    const compact = (data.contractDate as string) || "";
    const compactMatch = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
    if ((!contractMonth || !contractDay) && compactMatch) {
      const [, year, month, day] = compactMatch;
      contractYear = contractYear || toNumber(year);
      contractMonth = contractMonth || toNumber(month);
      contractDay = contractDay || toNumber(day);
    }

    return { contractMonth, contractDay, contractYear };
  }

  private mapUser(data: any): TeamUser {
    const birth = this.normalizeBirthParts(data);
    const contract = this.normalizeContractParts(data);
    const nicknameValue =
      data.nickname !== undefined && data.nickname !== null
        ? data.nickname
        : data.name;

    return {
      id: String(data.id || ""),
      nickname: String(nicknameValue || ""),
      fullName: data.fullName || data.name || "",
      email: data.email || "",
      accessLevel: data.accessLevel || "",
      fscCode: data.fscCode || data.fsc || data.fsc_code || "",
      agencyCode: data.agencyCode || data.agencyId || "",
      birthMonth: birth.birthMonth,
      birthDay: birth.birthDay,
      birthYear: birth.birthYear,
      contractMonth: contract.contractMonth,
      contractDay: contract.contractDay,
      contractYear: contract.contractYear,
    };
  }

  private mapUsers(list: any[], isAdmin: boolean): TeamUser[] {
    return list.map((item) => {
      const user = this.mapUser(item || {});
      if (!isAdmin) {
        delete user.email;
        delete user.accessLevel;
      }
      return user;
    });
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    return authJson<T>(path, init, {
      defaultErrorMessage: "Request failed",
    });
  }

  private parseTeamData(raw: TeamApiResponse): TeamData {
    const users = Array.isArray(raw.users)
      ? raw.users.map((u) => this.mapUser(u))
      : [];

    const agencies = Array.isArray(raw.agencies)
      ? raw.agencies.map((a: any) => {
          const hasIsDeleted =
            a?.isDeleted !== undefined ||
            a?.is_delete !== undefined ||
            a?.is_deleted !== undefined;
          const hasIsActive =
            a?.isActive !== undefined ||
            a?.is_active !== undefined;
          const isDeleted = hasIsDeleted
            ? this.toBoolean(a.isDeleted ?? a.is_delete ?? a.is_deleted, false)
            : false;
          const isActive = hasIsActive
            ? this.toBoolean(a.isActive ?? a.is_active, !isDeleted)
            : !isDeleted;

          return {
            code: String(a.code || a.agencyCode || a.id || ""),
            name: String(a.name || a.agencyName || ""),
            isActive,
            isDeleted,
          };
        })
      : [];

    return { users, agencies };
  }

  // ============ Auth Helpers ============

  async getCurrentUserAccessLevel(): Promise<{ isAdmin: boolean; accessLevel: string }> {
    const current = authService.getCurrentUser();
    const accessLevel = String(current?.accessLevel || "").toLowerCase();
    return { isAdmin: accessLevel === "admin", accessLevel };
  }

  // ============ Team Data Operations ============

  async getTeamData(options: TeamDataOptions = {}): Promise<TeamData> {
    const path = options.includeDeletedAgencies
      ? "/api/team?includeDeletedAgencies=1"
      : "/api/team";
    const raw = await this.requestJson<TeamApiResponse>(path, { method: "GET" });
    const parsed = this.parseTeamData(raw);
    if (!options.includeDeletedAgencies) {
      this.cachedTeamData = parsed;
    }
    return parsed;
  }

  subscribeToTeamData(
    onChange: (data: TeamData) => void,
    onError?: (error: unknown) => void
  ): () => void {
    let active = true;

    const pull = async () => {
      try {
        const data = await this.getTeamData();
        if (!active) return;
        onChange(data);
      } catch (error) {
        if (!active) return;
        if (onError) onError(error);
      }
    };

    void pull();
    const interval = window.setInterval(() => void pull(), this.refreshMs);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }

  async saveTeamData(data: TeamData): Promise<void> {
    const agencies = (data.agencies || []).map((agency, index) => ({
      code: String(agency.code || "").trim(),
      name: String(agency.name || "").trim() || String(agency.code || "").trim(),
      position: index,
      isDeleted: agency.isDeleted ?? (agency.isActive === false),
    })).filter((agency) => agency.code);

    await this.requestJson<{ updated: number }>("/api/agencies", {
      method: "PUT",
      body: JSON.stringify({ agencies }),
    });

    this.cachedTeamData = {
      ...data,
      agencies: agencies.map((a) => ({
        code: a.code,
        name: a.name,
        isDeleted: a.isDeleted,
        isActive: !a.isDeleted,
      })),
    };
  }

  async getBackups(): Promise<TeamBackup[]> {
    return [];
  }

  async restoreFromBackup(_backup: TeamBackup): Promise<void> {
    throw new Error("Team backups are not migrated yet");
  }

  async deleteBackup(_id: string): Promise<void> {
    throw new Error("Team backups are not migrated yet");
  }

  // ============ User Operations ============

  async getUsers(_forceRefresh = false): Promise<TeamUser[]> {
    const { isAdmin } = await this.getCurrentUserAccessLevel();
    const data = await this.getTeamData();
    return this.mapUsers(data.users, isAdmin);
  }

  subscribeUsers(
    onChange: (users: TeamUser[]) => void,
    onError?: (error: unknown) => void
  ): () => void {
    let active = true;

    const start = async (): Promise<() => void> => {
      try {
        const { isAdmin } = await this.getCurrentUserAccessLevel();
        if (!active) return () => {};

        return this.subscribeToTeamData(
          (data) => onChange(this.mapUsers(data.users, isAdmin)),
          onError
        );
      } catch (error) {
        if (onError) onError(error);
        return () => {};
      }
    };

    let unsubscribe = () => {};
    void start().then((unsub) => {
      if (!active) {
        unsub();
        return;
      }
      unsubscribe = unsub;
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }

  async getUserProfile(uid: string): Promise<TeamUser | null> {
    const data = this.cachedTeamData || (await this.getTeamData());
    const user = data.users.find((u) => u.id === uid);
    return user || null;
  }

  async getUserFscCode(uid: string): Promise<string | null> {
    const profile = await this.getUserProfile(uid);
    return profile?.fscCode || null;
  }

  async createUser(payload: CreateUserPayload): Promise<void> {
    await this.requestJson<{ uid: string }>("/api/team/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateUser(payload: UpdateUserPayload): Promise<void> {
    await this.requestJson<{ uid: string }>(`/api/team/users/${encodeURIComponent(payload.uid)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    this.cachedTeamData = null;
  }

  async bulkUpdateUsers(payload: BulkUpdateUsersPayload): Promise<void> {
    await this.requestJson<{ updated: number }>("/api/team/users/bulk-agency", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  async deleteUser(uid: string): Promise<void> {
    await this.requestJson<{ uid: string }>(`/api/team/users/${encodeURIComponent(uid)}`, {
      method: "DELETE",
    });
  }

  // ============ Agency Operations ============

  async getAgencies(): Promise<TeamAgency[]> {
    const data = await this.getTeamData();
    return data.agencies;
  }

  async getAgencyNames(): Promise<Record<string, string>> {
    const data = await this.getTeamData();
    const map: Record<string, string> = {};
    data.agencies.forEach((a) => {
      map[a.code] = a.name;
    });
    return map;
  }

  async upsertAgency(agency: TeamAgency): Promise<void> {
    const trimmedCode = agency.code.trim();
    if (!trimmedCode) return;

    const currentData = await this.getTeamData();
    const existingIndex = currentData.agencies.findIndex((a) => a.code === trimmedCode);
    const existingAgency = existingIndex >= 0 ? currentData.agencies[existingIndex] : undefined;
    const isDeleted =
      agency.isDeleted ??
      (agency.isActive === false
        ? true
        : existingAgency?.isDeleted ?? false);
    const newAgency = {
      code: trimmedCode,
      name: agency.name?.trim() || trimmedCode,
      isDeleted,
      isActive: !isDeleted,
    };

    if (existingIndex >= 0) {
      currentData.agencies[existingIndex] = newAgency;
    } else {
      currentData.agencies.push(newAgency);
    }

    await this.saveTeamData(currentData);
  }

  async removeAgency(code: string): Promise<void> {
    const trimmedCode = code.trim();
    if (!trimmedCode) return;

    await this.requestJson<{ deleted: boolean }>(`/api/agencies/${encodeURIComponent(trimmedCode)}`, {
      method: "DELETE",
    });

    if (this.cachedTeamData) {
      this.cachedTeamData = {
        ...this.cachedTeamData,
        agencies: this.cachedTeamData.agencies.filter((a) => a.code !== trimmedCode),
      };
    }
  }
}

export const teamService = new TeamService();
