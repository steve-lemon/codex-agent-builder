// Demo entrypoint covering product-facing flow design and runtime approval flows.
import { createRuntime, FlowDesignProduct } from './index';

async function runDemo() {
    const product = new FlowDesignProduct();
    const runtime = createRuntime();

    console.log('\n=== A) Product preflight run ===');
    const preflight = await product.preflight('이메일을 확인해서 답장 해줘');
    console.log({
        status: preflight.status,
        summary: preflight.summary,
        payload: preflight.preflightPayload,
    });

    console.log('\n=== B) Product flow design run ===');
    const design = await product.design('키워드를 줄테니 블로그 타이틀 여러개 만들기');
    console.log({
        status: design.status,
        summary: design.summary,
        flowDesign: design.flowDesign,
        nodeConfiguration: design.nodeConfiguration,
    });

    console.log('\n=== C) Normal completed runtime run ===');
    const normal = await runtime.run('Please review this customer case and summarize next steps.');
    console.log({ status: normal.status, final: normal.finalResult });

    console.log('\n=== D) Run that suspends for approval ===');
    const waiting = await runtime.run('Customer requested a refund for order o_100.');
    console.log({ status: waiting.status, waitingApproval: waiting.waitingApproval });

    if (waiting.status === 'waiting_for_approval') {
        console.log('\n=== E) Resume after approval ===');
        const resumed = await runtime.resume(waiting.runId, { decision: 'approve' });
        console.log({ status: resumed.status, final: resumed.finalResult });
    }
}

runDemo().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
