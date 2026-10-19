import { requestTypes, type CompanyConfig } from "./client-workflow-types";

export const defaultConfig = (): CompanyConfig => ({
  version: 1,
  fields: [
    {
      key: "requester",
      label: "Requester and organization",
      requestTypes: [...requestTypes],
      required: false,
    },
    {
      key: "current_process",
      label: "Current process or tools",
      requestTypes: [...requestTypes],
      required: false,
    },
    { key: "timeline", label: "Target timeline", requestTypes: [...requestTypes], required: false },
    {
      key: "volume",
      label: "Scale or volume",
      requestTypes: ["setup", "migration", "integration", "customization"],
      required: false,
    },
  ],
  products: [],
  capabilities: [],
  tasks: [
    {
      id: "discovery",
      label: "Discovery and requirements",
      baseHours: 4,
      lowFactor: 0.75,
      highFactor: 1.6,
    },
    { id: "design", label: "Solution design", baseHours: 6, lowFactor: 0.75, highFactor: 1.7 },
    {
      id: "configuration",
      label: "Configuration and data preparation",
      baseHours: 8,
      lowFactor: 0.7,
      highFactor: 1.8,
    },
    {
      id: "implementation",
      label: "Implementation",
      baseHours: 16,
      lowFactor: 0.65,
      highFactor: 2,
    },
    {
      id: "validation",
      label: "Validation and acceptance",
      baseHours: 8,
      lowFactor: 0.7,
      highFactor: 1.8,
    },
    {
      id: "release",
      label: "Release and handover",
      baseHours: 4,
      lowFactor: 0.75,
      highFactor: 1.6,
    },
  ],
});
