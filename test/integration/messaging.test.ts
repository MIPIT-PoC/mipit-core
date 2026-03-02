import { AckConsumer } from '../../src/messaging/consumer.js';
import { Publisher } from '../../src/messaging/publisher.js';

describe('Messaging (integration)', () => {
  describe('Publisher', () => {
    it.todo('should publish a message to the PIX routing key');

    it.todo('should publish a message to the SPEI routing key');

    it.todo('should set persistent and content-type headers');
  });

  describe('AckConsumer', () => {
    it.todo('should update payment to COMPLETED on ACCEPTED ack');

    it.todo('should update payment to REJECTED on REJECTED ack');

    it.todo('should update payment to FAILED on ERROR ack');

    it.todo('should log audit event with adapter and latency metadata');

    it.todo('should acknowledge the message after processing');
  });
});
