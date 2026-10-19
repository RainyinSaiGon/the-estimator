import type { CompanyConfig, KnowledgeSource } from "./client-workflow-types";

export type KnowledgeSourceRetrieval = { retrievedAt?: string; sha256?: string };

export function searchApprovedKnowledge(sources: KnowledgeSource[], query: string, retrieval: Record<string, KnowledgeSourceRetrieval> = {}) {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])].slice(0, 30);
  return sources.filter(source => source.status === "approved").flatMap(source => {
    const paragraphs = source.text.match(/[\s\S]{1,2000}/g) ?? [];
    const sourceMetadata = retrieval[source.id];
    return paragraphs.map((text, index) => ({ sourceId: source.id, passageId: `${source.id}:${index + 1}`, title: source.title, url: source.url, text, sha256: sourceMetadata?.sha256 ?? source.sha256, approvedAt: source.approvedAt, addedAt: source.addedAt, ...(sourceMetadata?.retrievedAt ? { retrievedAt: sourceMetadata.retrievedAt } : {}), score: terms.filter(term => text.toLowerCase().includes(term)).length }));
  }).filter(passage => passage.score > 0).sort((a, b) => b.score - a.score || a.passageId.localeCompare(b.passageId)).slice(0, 10);
}

export function configuredIntakeSchema(config: CompanyConfig) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `urn:estimator:intake:v${config.version}`,
    title: "Reviewed company request fields",
    configurationVersion: config.version,
    type: "object", additionalProperties: false,
    required: ["requestType", "answers"],
    properties: { requestType: { enum: ["demo", "setup", "migration", "integration", "customization", "support"] }, answers: { type: "object", additionalProperties: false, properties: Object.fromEntries(config.fields.map(field => [field.key, { type: "string", maxLength: 2000, title: field.label, ...(field.required ? { minLength: 1 } : {}) }])) } },
    allOf: config.fields.filter(field => field.required).map(field => ({ if: { properties: { requestType: { enum: field.requestTypes } }, required: ["requestType"] }, then: { properties: { answers: { required: [field.key] } } } })),
  };
}
