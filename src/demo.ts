// Demo entrypoint covering normal, suspended, and resumed runs.
import { createRuntime } from './index';

async function runDemo() {
  const runtime = createRuntime();

  console.log('\n=== A) Normal completed run ===');
  const normal = await runtime.run('Please review this customer case and summarize next steps.');
  console.log({ status: normal.status, final: normal.finalResult });

  console.log('\n=== B) Run that suspends for approval ===');
  const waiting = await runtime.run('Customer requested a refund for order o_100.');
  console.log({ status: waiting.status, waitingApproval: waiting.waitingApproval });

  if (waiting.status === 'waiting_for_approval') {
    console.log('\n=== C) Resume after approval ===');
    const resumed = await runtime.resume(waiting.runId, { decision: 'approve' });
    console.log({ status: resumed.status, final: resumed.finalResult });
  }
}

runDemo().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
