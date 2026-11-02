import { loadConfig } from './config.js';
import { Runner, RUNS_DIR } from './runner.js';

const roleArg = process.argv.find((a) => a.startsWith('--role='));
const roles = roleArg ? roleArg.slice(7).split(',') : [];

const runner = new Runner();
runner.on('event', (e) => {
  if (e.type === 'log') console.log(e.msg);
  if (e.type === 'done') {
    console.log(`Report: ${RUNS_DIR}\\${e.runId}\\report.html`);
    process.exit(0);
  }
});
runner.start(loadConfig(), roles);
