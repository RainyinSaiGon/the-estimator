import type { Configuration } from "./workflow-types";

// A reference configuration, not a statement of internal Anduin delivery effort.
export const anduinReference: Omit<Configuration, "version"> = {
  fields: [
    { key: "requester", label: "Who is asking", type: "string", required: true, requestTypes: [], options: [], requiredWhen: {} },
    { key: "organization", label: "Company and contact", type: "string", required: true, requestTypes: [], options: [], requiredWhen: {} },
    { key: "fundDetails", label: "Fund type, vehicles, and jurisdictions", type: "string", required: true, requestTypes: ["setup", "migration"], options: [], requiredWhen: {} },
    { key: "investors", label: "Approximate investor count", type: "number", required: false, requestTypes: [], options: [], requiredWhen: {} },
    { key: "outcome", label: "Requested outcome", type: "string", required: true, requestTypes: [], options: [], requiredWhen: {} },
    { key: "currentProcess", label: "Current process", type: "string", required: false, requestTypes: [], options: [], requiredWhen: {} },
    { key: "systems", label: "Systems to connect", type: "string", required: true, requestTypes: ["integration"], options: [], requiredWhen: {} },
    { key: "timeline", label: "Target date", type: "string", required: false, requestTypes: [], options: [], requiredWhen: {} },
    { key: "budget", label: "Budget, when supplied", type: "string", required: false, requestTypes: [], options: [], requiredWhen: {} },
  ],
  products: [
    ["subscription", "Fund Subscription"], ["data-room", "Data Room"], ["investor-data", "Investor Data Management"],
    ["extraction", "Data Extraction"], ["integration", "Integration Hub"], ["portal", "Investor Portal"],
    ["engagement", "Engagement Hub"], ["advisor", "Advisor Advantage"],
  ].map(([id, name]) => ({ id, name, description: "Reference product label. Approve official supporting knowledge before claiming feature fit." })),
  tasks: [
    { id: "discovery", label: "Discovery and scope confirmation", requestTypes: [], baseHours: 4, lowFactor: .75, highFactor: 1.5 },
    { id: "configuration", label: "Product configuration", requestTypes: ["setup", "integration"], baseHours: 8, lowFactor: .75, highFactor: 1.75 },
    { id: "mapping", label: "Data mapping and cleanup", requestTypes: ["migration", "integration"], baseHours: 12, lowFactor: .75, highFactor: 2 },
    { id: "validation", label: "Testing and customer acceptance", requestTypes: [], baseHours: 6, lowFactor: .75, highFactor: 1.5 },
    { id: "handover", label: "Launch and handover", requestTypes: [], baseHours: 4, lowFactor: .75, highFactor: 1.5 },
  ],
  capabilities: [],
  approvedDomains: ["anduintransact.com", "www.anduintransact.com", "developers.anduintransact.com"],
  retentionDays: 90, hoursPerDay: 6,
};
