import {interviewer} from './interviewer.mjs';
import {archivist} from './archivist.mjs';
import {editor} from './editor.mjs';
import {verifier} from './verifier.mjs';
import {discovery} from './discovery.mjs';
import {artDirector} from './art-director.mjs';

export const agents = {interviewer, archivist, editor, verifier, discovery, artDirector};

export function agentForTask(task) {
  const agent = Object.values(agents).find(agent => Object.hasOwn(agent.instructions, task));
  if (!agent) throw new Error('No Witness agent is configured for this task.');
  return agent;
}
