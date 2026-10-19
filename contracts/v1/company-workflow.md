# Company workflow API

The native web BFF exposes these company-neutral endpoints. All responses containing company data use `Cache-Control: no-store`. Browser mutations require a same-origin request and a verified first-party session. Membership is checked in the Go service on every operation.

| Method | Path under `/api/workflow` | Contract |
| --- | --- | --- |
| GET, POST | `/companies` | List memberships / create `{"name":"Company"}` |
| GET, DELETE | `/companies/{id}` | Sanitized company aggregate / admin cascade deletion |
| POST | `/companies/{id}/actions` | Typed action envelope; see below |
| POST | `/companies/{id}/intake` | Multipart: title, text, up to ten files |
| POST | `/companies/{id}/analyze/{requestId}` | Start AI processing for the current revision |
| GET | `/companies/{id}/attachments/{fileId}` | Authorized encrypted-original download |
| GET | `/companies/{id}/knowledge?q=...` | `{"passages":[...]}` from approved sources only |
| POST | `/companies/{id}/knowledge/fetch` | Admin: `{"url":"https://...","title":"...","replacesId":""}`; creates draft |
| POST | `/companies/{id}/knowledge/upload` | Admin multipart file/title; creates draft |
| GET | `/companies/{id}/schema` | Company's intake JSON Schema 2020-12 |
| GET | `/companies/{id}/evaluation` | Separated holdout cohorts, exclusions and limitations |
| GET | `/companies/{id}/export` | Delivery records as owner-authorized JSONL |
| GET | `/companies/{id}/gmail/connect` | Admin: OAuth redirect |
| POST | `/companies/{id}/gmail/sync`, `/gmail/disconnect` | Admin mailbox operations |
| GET | `/gmail/callback` | Nonce/session-bound OAuth callback |
| GET | `/companies/{id}/webhook-secret` | Admin explicit secret access for adapter setup |
| POST | `/inbound/{id}` | HMAC-authenticated provider submission; see workflow guide |
| POST, GET, DELETE | `/companies/{id}/mcp` | Official MCP Streamable HTTP protocol; provisioned read-only bearer or session; unsupported transport methods may return 405 |
| POST | `/worker` | Internal derived bearer, never a browser credential |

## Action envelope

```json
{"action":"review","requestId":"<uuid>","expectedVersion":7,"review":{}}
```

`expectedVersion` is optional optimistic concurrency control; the UI sends it. `expectedRevision` is used by internal analysis to reject stale output. The Go decoder rejects unknown envelope fields. Successful actions return `{"company":{...},"objectId":"..."}`; errors return `{"error":"..."}` with a non-2xx status.

Browser action names:

- Admin: `config`, `member`, `removeMember`, `knowledge.add`, `knowledge.approve`, `knowledge.retire`, `knowledge.token.rotate`, `knowledge.token.revoke`, `gmail.configure`, `webhook.rotate`, `request.delete`.
- Company members: `request.update`, `analysis.retry`, `review`, `estimate`, `freeze`, `delivery`.
- Designated independent reviewer/admin: `delivery.review`.

The original submitter can use `delivery.revise` on rejected actuals. The prior submission and reviewer decisions are retained in `deliveryHistory` and excluded from training/evaluation; corrected actuals require a new independent decision. Approved actuals cannot be rewritten through this action.

The wire types are maintained in `apps/web/lib/workflow-types.ts` and the Go domain structs in `company_workflow.go`. Request-specific configured field types are machine-readable at the schema endpoint. This document does not replace the runtime validation of review, freeze, or delivery transitions.

Internal `/v1/workflow` service routes require short-lived signed service JWTs. Read, write, connector-secret, and worker scopes are distinct. The BFF does not forward arbitrary internal actions from browser requests. OpenAI credentials are supplied only to Python; mailbox secrets remain encrypted in Go storage and are available to the connector worker through scoped internal routes.

## Knowledge passage

Each passage contains `sourceId`, `title`, `url` (empty for uploaded internal docs), `passage`, `retrievedAt`, `sha256`, and lexical `score`. A source version cannot be edited after approval; replacement creates a draft, and approval retires the old version. A retired source cannot enter new retrieval or MCP results. Frozen baselines retain their original evidence.

## Independent delivery

Submission includes a frozen `baselineId`, exact task-keyed `actualHours`, separate `additionalScopeHours`, completion time, evidence source/reference, `synthetic`, and a different `reviewerId`. Approval needs the designated actor, company reviewer/admin role and a review note. Eligibility, baseline digest, split and submitter identity are server derived. Client-supplied eligibility is rejected.
