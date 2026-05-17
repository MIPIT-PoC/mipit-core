/**
 * P06 — RabbitMQ Reconnection with Exponential Backoff + Consumer Re-attach.
 *
 * Provides automatic reconnection when the RabbitMQ connection drops.
 * Uses exponential backoff with jitter to prevent thundering herd.
 *
 * IMPORTANT P06 fix: consumers must be re-registered on the new channel
 * after reconnect (previously they were bound to the dead channel and ACKs
 * silently accumulated). Use `registerConsumerBootstrap()` to register a
 * callback that re-binds your consumer to the channel each time we
 * reconnect.
 *
 * Backoff: min(baseMs * 2^attempt + jitter, maxMs)
 */

import amqplib from 'amqplib';
import type { ChannelModel, Channel, ConfirmChannel } from 'amqplib';
import { logger } from '../observability/logger.js';

interface ReconnectOptions {
  baseMs?: number;
  maxMs?: number;
  maxAttempts?: number;
  /** Use a confirm channel (P06: publisher confirms). Defaults to true. */
  useConfirmChannel?: boolean;
  /** Callback when the topology must be re-asserted on a fresh channel. */
  onReconnect?: (connection: ChannelModel, channel: Channel | ConfirmChannel) => Promise<void>;
  onGiveUp?: (error: Error) => void;
}

type ConsumerBootstrap = (channel: Channel | ConfirmChannel) => Promise<void>;

const DEFAULT_OPTIONS: Required<Omit<ReconnectOptions, 'onReconnect' | 'onGiveUp'>> = {
  baseMs: 1000,
  maxMs: 30_000,
  maxAttempts: Infinity,
  useConfirmChannel: true,
};

export class RabbitMQReconnector {
  private connection: ChannelModel | null = null;
  private channel: Channel | ConfirmChannel | null = null;
  private attempt: number = 0;
  private reconnecting: boolean = false;
  private readonly consumerBootstraps: ConsumerBootstrap[] = [];
  private readonly opts: Required<Omit<ReconnectOptions, 'onReconnect' | 'onGiveUp'>>;
  private readonly onReconnect?: ReconnectOptions['onReconnect'];
  private readonly onGiveUp?: ReconnectOptions['onGiveUp'];

  constructor(
    private readonly url: string,
    options?: ReconnectOptions,
  ) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.onReconnect = options?.onReconnect;
    this.onGiveUp = options?.onGiveUp;
  }

  /**
   * P06 — Register a callback that will be invoked every time we (re)connect.
   * Use this to bind consumers (AckConsumer, DlqHandler) to the channel.
   * Previously consumers were bound once at startup to a channel that died
   * on reconnect; ACKs accumulated invisibly.
   */
  registerConsumerBootstrap(fn: ConsumerBootstrap): void {
    this.consumerBootstraps.push(fn);
  }

  async connect(): Promise<{ connection: ChannelModel; channel: Channel | ConfirmChannel }> {
    this.connection = await amqplib.connect(this.url);
    this.channel = this.opts.useConfirmChannel
      ? await this.connection.createConfirmChannel()
      : await this.connection.createChannel();
    this.attempt = 0;

    this.attachConnectionHandlers();

    logger.info({ confirms: this.opts.useConfirmChannel }, 'RabbitMQ connected with auto-reconnect');
    return { connection: this.connection, channel: this.channel };
  }

  /**
   * P06 — Remove any previously-registered listeners before attaching, to
   * avoid the leak that surfaced as "MaxListenersExceededWarning" on the
   * 11th reconnect.
   */
  private attachConnectionHandlers(): void {
    if (!this.connection) return;
    this.connection.removeAllListeners('error');
    this.connection.removeAllListeners('close');
    this.connection.on('error', (err) => {
      logger.error({ err }, 'RabbitMQ connection error');
    });
    this.connection.on('close', () => {
      logger.warn('RabbitMQ connection closed — initiating reconnect');
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;

    const doReconnect = async () => {
      while (this.attempt < this.opts.maxAttempts) {
        const delay = this.calculateDelay();
        logger.info({ attempt: this.attempt + 1, delayMs: delay }, 'Attempting RabbitMQ reconnect');

        await this.sleep(delay);
        this.attempt++;

        try {
          this.connection = await amqplib.connect(this.url);
          this.channel = this.opts.useConfirmChannel
            ? await this.connection.createConfirmChannel()
            : await this.connection.createChannel();

          this.attachConnectionHandlers();

          logger.info({ attempt: this.attempt }, 'RabbitMQ reconnected — re-asserting topology + consumers');
          this.attempt = 0;
          this.reconnecting = false;

          if (this.onReconnect) {
            await this.onReconnect(this.connection, this.channel);
          }

          // P06 — Re-register all consumers on the fresh channel.
          for (const bootstrap of this.consumerBootstraps) {
            try {
              await bootstrap(this.channel);
            } catch (err) {
              logger.error({ err }, 'Consumer bootstrap failed during reconnect');
            }
          }
          logger.info({ consumers: this.consumerBootstraps.length }, 'Re-registered consumers after reconnect');

          return;
        } catch (err) {
          logger.warn({ err, attempt: this.attempt }, 'RabbitMQ reconnect attempt failed');
        }
      }

      this.reconnecting = false;
      const error = new Error(`Failed to reconnect to RabbitMQ after ${this.opts.maxAttempts} attempts`);
      logger.fatal({ maxAttempts: this.opts.maxAttempts }, error.message);
      if (this.onGiveUp) {
        this.onGiveUp(error);
      }
    };

    doReconnect().catch((err) => {
      logger.fatal({ err }, 'Unexpected error during RabbitMQ reconnection');
    });
  }

  private calculateDelay(): number {
    const exponential = this.opts.baseMs * Math.pow(2, this.attempt);
    const jitter = Math.random() * this.opts.baseMs;
    return Math.min(exponential + jitter, this.opts.maxMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getChannel(): Channel | ConfirmChannel {
    if (!this.channel) throw new Error('RabbitMQ not connected');
    return this.channel;
  }

  getConnection(): ChannelModel {
    if (!this.connection) throw new Error('RabbitMQ not connected');
    return this.connection;
  }

  isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }
}
