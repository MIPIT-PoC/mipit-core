import { PaymentPipeline } from '../../src/pipeline/payment-pipeline.js';

describe('PaymentPipeline (integration)', () => {
  it.todo('should execute the full 7-step pipeline for a PIX→SPEI payment');

  it.todo('should execute the full 7-step pipeline for a SPEI→PIX payment');

  it.todo('should persist payment with RECEIVED status on step 2');

  it.todo('should update canonical payload after translation (step 4)');

  it.todo('should update route and destination after routing (step 6)');

  it.todo('should publish message to RabbitMQ and set QUEUED status (step 7)');

  it.todo('should throw on unknown rail alias prefix');
});
