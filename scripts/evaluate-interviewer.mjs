import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {INTERVIEW_FIXTURES,fixtureById} from '../web/demo-fixtures.js';
import {newProject,addAnswer,setInterviewer} from '../web/domain.js';
import {projectInput} from '../web/ai-client.js';
import {runMockTask} from '../web/mock-ai.js';
import {validateAIResult} from '../web/ai-contracts.js';
import {runMetaTask} from '../server/ai/meta.mjs';

// Small fictional interviewer check: one follow-up request per conversation,
// recording the exact input and the generated follow-up for human review.
// Mock runs prove the harness only; live quality needs a human reader.
// SH-01 is a holdout fixture: it appears here because post-change human-review
// evaluation is what the holdout is reserved for, never for automated asserts.
function buildConversation(entries, topic, intents = []) {
  const p = newProject(topic);
  entries.forEach((e, i) => {
    setInterviewer(p, {result: {question: e.q, ...(intents[i] ? {intent: intents[i]} : {})}, provider: 'prompt', model: null});
    addAnswer(p, e.text);
  });
  return p;
}

export function interviewerCases() {
  const topicChange = [
    ...fixtureById('CO-01').entries.slice(0, 2),
    {q: 'What is new in your life instead?', text: fixtureById('MV-01').entries[0].text},
  ];
  return [
    {id: 'brief', title: 'A brief answer', fixtures: ['SH-01'], holdout: true, entries: fixtureById('SH-01').entries, intents: ['opening', 'detail', 'detail']},
    {id: 'rich', title: 'A rich memory', fixtures: ['FW-01'], holdout: false, entries: fixtureById('FW-01').entries, intents: ['opening', 'detail', 'people', 'meaning']},
    {id: 'uncertain', title: 'Uncertainty', fixtures: ['UN-01'], holdout: false, entries: fixtureById('UN-01').entries, intents: ['opening', 'detail']},
    {id: 'diary', title: 'An ordinary diary entry', fixtures: ['EJ-01'], holdout: false, entries: fixtureById('EJ-01').entries, intents: ['opening', 'meaning']},
    {id: 'refusal', title: 'A refusal', fixtures: ['RF-01'], holdout: false, entries: fixtureById('RF-01').entries, intents: ['opening']},
    {id: 'topic-change', title: 'A topic change', fixtures: ['CO-01', 'MV-01'], holdout: false, entries: topicChange, intents: ['opening', 'people', 'detail']},
    {id: 'finish', title: 'An explicit request to finish', fixtures: ['EJ-01'], holdout: false, note: 'Appends one explicit fictional finish line after the EJ-01 entries.', entries: [...fixtureById('EJ-01').entries, {q: 'What else comes back?', text: "That's everything from me. I want to finish here."}], intents: ['opening', 'meaning', 'detail']},
  ];
}

export async function evaluateInterviewer(cases, {live = false, apiKey, maxCalls = cases.length, timeoutMs = 180000, fetcher = globalThis.fetch} = {}) {
  if (live && !apiKey) throw Error('Live evaluation requires a server API key.');
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw Error('Set a positive call budget and timeout.');
  const started = Date.now(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(Error('Evaluation deadline reached.')), timeoutMs);
  const report = {mode: live ? 'meta-live' : 'mock', model: live ? 'muse-spark-1.3' : null, fictional: true, maxCalls, timeoutMs, calls: 0, cases: [], limitations: ['Mock output does not measure Muse quality.', 'Each follow-up needs human review against the conversation.']};
  const reserve = () => {
    controller.signal.throwIfAborted();
    if (report.calls >= maxCalls) throw Error('Evaluation call budget reached.');
    report.calls++;
  };
  try {
    for (const conversation of cases) {
      const input = projectInput(buildConversation(conversation.entries, 'small-moment', conversation.intents));
      const before = JSON.stringify(input);
      const result = {id: conversation.id, title: conversation.title, fixtures: conversation.fixtures, holdout: conversation.holdout, note: conversation.note || null, input, output: null, provider: null, model: null, status: 'incomplete'};
      report.cases.push(result);
      try {
        reserve();
        const signal = controller.signal;
        signal.throwIfAborted();
        const run = live
          ? await runMetaTask('interview', input, {apiKey, fetcher: (url, options) => fetcher(url, options), signal, timeoutMs: Math.min(60000, timeoutMs - (Date.now() - started))})
          : await runMockTask('interview', input);
        signal.throwIfAborted();
        if (JSON.stringify(input) !== before) throw Error('Source input changed during evaluation.');
        result.output = validateAIResult('interview', run.result, input.answers);
        result.provider = run.provider;
        result.model = run.model;
        result.status = 'ready_for_human_review';
      } catch (error) { result.status = 'error'; result.error = error.message; }
      if (controller.signal.aborted || report.calls >= maxCalls) break;
    }
  } finally { clearTimeout(timer); }
  report.elapsedMs = Date.now() - started;
  report.completedCases = report.cases.length;
  report.requestedCases = cases.length;
  return report;
}

export function interviewerOptions(args) {
  const {values} = parseArgs({args, options: {live: {type: 'boolean'}, 'allow-paid-api': {type: 'boolean'}, case: {type: 'string'}, 'max-calls': {type: 'string'}, 'timeout-ms': {type: 'string'}, output: {type: 'string'}}});
  if (values.live && (!values['allow-paid-api'] || !values['max-calls'])) throw Error('Live mode requires --allow-paid-api and --max-calls.');
  const all = interviewerCases();
  const cases = values.case ? all.filter(c => c.id === values.case) : all;
  if (!cases.length) throw Error('Unknown conversation. Use brief, rich, uncertain, diary, refusal, topic-change, or finish.');
  const maxCalls = Number(values['max-calls'] || cases.length);
  const timeoutMs = Number(values['timeout-ms'] || 180000);
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 100 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw Error('Use 1–100 calls and a timeout of 1–600000 milliseconds.');
  return {cases, live: !!values.live, maxCalls, timeoutMs, output: values.output || 'exports/interviewer-evaluation.json'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = interviewerOptions(process.argv.slice(2));
    // The default mock run does not load .env or read API credentials.
    if (options.live) process.loadEnvFile('.env');
    const report = await evaluateInterviewer(options.cases, {...options, apiKey: options.live ? process.env.MODEL_API_KEY : undefined});
    const destination = path.resolve(options.output);
    await mkdir(path.dirname(destination), {recursive: true});
    await writeFile(destination, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
    console.log(`${report.mode}: ${report.completedCases}/${report.requestedCases} cases, ${report.calls}/${report.maxCalls} calls. Human review required. Report: ${destination}`);
    if (report.cases.some(c => c.status === 'error') || report.completedCases < report.requestedCases) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
