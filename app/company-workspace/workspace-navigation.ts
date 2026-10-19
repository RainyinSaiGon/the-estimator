import {
  ClipboardList,
  FileText,
  History,
  Plug,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";

export type Panel =
  "requests" | "knowledge" | "settings" | "evaluation" | "members" | "connectors" | "audit";

export const panels = [
  { id: "requests", title: "Client work", icon: ClipboardList },
  { id: "knowledge", title: "Knowledge sources", icon: FileText },
  { id: "settings", title: "Company settings", icon: Settings2 },
  { id: "members", title: "Members", icon: Users },
  { id: "connectors", title: "Connectors", icon: Plug },
  { id: "evaluation", title: "Review & results", icon: ShieldCheck },
  { id: "audit", title: "Audit", icon: History },
] as const;

export const settingsGroups = [
  { title: "Company configuration", ids: ["knowledge", "settings"] },
  { title: "People & access", ids: ["members"] },
  { title: "Integrations", ids: ["connectors"] },
  { title: "Governance", ids: ["audit"] },
] as const;
