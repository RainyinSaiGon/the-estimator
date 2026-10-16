import type { Answers } from "./estimator-types.ts";
export function sourceAnswers(brief: string, suggested: Answers): Answers {
  const answers = { ...suggested };
  if (!/one.way|unidirectional|two.way|bi.?directional|both directions|only (?:from|to)/i.test(brief)) answers.direction = "unknown";
  const apiUnconfirmed = /(?:haven't|have not|not (?:yet )?)\s*(?:shared|provided|confirmed|available)|unconfirmed|documentation (?:is )?pending/i.test(brief);
  if (apiUnconfirmed) answers.api = "unknown";
  else if (answers.api === "custom" && !/\b(?:build|implement|create|develop|custom|new)\s+(?:(?:a|an|the)\s+)?(?:\w+\s+){0,2}(?:api|endpoints?)\b/i.test(brief)) answers.api = "unknown";
  else if (answers.api === "documented" && (!/documented api|api doc(?:umentation|s)/i.test(brief) || !/access|credentials|available|provided/i.test(brief))) answers.api = "unknown";
  if (!/standard (?:fields|mapping)|direct mapping|custom fields|business rules|transform/i.test(brief)) answers.mapping = "unknown";
  return answers;
}
