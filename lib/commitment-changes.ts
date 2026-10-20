export type CommitmentChange = {
  id: string;
  baselineId?: string;
  baselineSha256?: string;
  description: string;
  reason: string;
  effortImpact: string;
  createdBy: string;
  createdAt: string;
  status: "proposed" | "approved" | "rejected";
  createdName?: string;
  reviewedBy?: string;
  reviewedName?: string;
  reviewedAt?: string;
  reviewNotes?: string;
};
