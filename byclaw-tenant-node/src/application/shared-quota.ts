/** Published limits are shared data; consumers retain their own database usage and write transactions. */
export interface SharedQuota {
  schemaVersion: 1;
  enterpriseId: string;
  revision: string;
  mode: "LIMITED" | "UNLIMITED";
  limits: {
    memberLimit: number;
    groupLimit: number;
    groupMemberLimit: number;
    agentLimit: number;
  };
  updatedAt: string;
  accessMode?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface SharedQuotaReader {
  read(enterpriseId: string): Promise<SharedQuota | null>;
}

export interface QuotaMember {
  memObjType: "USER" | "AGENT";
  memObjId: string;
}
