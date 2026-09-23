import { enterpriseInferenceAllowed, publicOnlyTask } from './safe-call.mjs';

const MAX_TOPICS = 12;
const MAX_TOPIC_CHARS = 200;

function topic(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TOPIC_CHARS) : '';
}

function topics(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(topic).filter(Boolean))].slice(0, MAX_TOPICS);
}

export function researchEvidenceContext(session, environment = process.env) {
  const empty = { coveredSubtopics: [], missingSubtopics: [] };
  if (!publicOnlyTask(session?.task) && !enterpriseInferenceAllowed(environment)) return empty;
  const branches = Array.isArray(session?.research?.branches) ? session.research.branches : [];
  const done = branches.filter((branch) => branch && branch.status === 'done');
  const answered = new Set(done.map((branch) => topic(branch.query)).filter(Boolean));
  const coveredSubtopics = topics(done.map((branch) => branch.researchGoal || branch.query));
  const missingSubtopics = topics([
    ...(Array.isArray(session?.task?.followups) ? session.task.followups : []),
    ...done.flatMap((branch) => Array.isArray(branch.followups) ? branch.followups : []),
  ].filter((value) => !answered.has(topic(value))));
  return { coveredSubtopics, missingSubtopics };
}
