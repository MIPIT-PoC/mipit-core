/**
 * RabbitMQ Reconnection with Exponential Backoff
 *
 * Provides automatic reconnection when the RabbitMQ connection drops.
 * Uses exponential backoff with jitter to prevent thundering herd.
 *
 * Backoff formula: min(baseMs * 2^attempt + jitter, maxMs)
 *   attempt 0: ~1s
 *   attempt 1: ~2s
 *   attempt 2: ~4s
 *   attempt 3: ~8s
 *   ...
 *   max: 30s
 */

import amqplib from 'amqplib';
import type { ChannelModel, Channel } from 'amqplib';
import { logger } from '../observability/logger.js';

interface ReconnectOptions {
  /** Base delay in ms (default: 1000) */
  baseMs?: number;
  /** Maximum delay in ms (default: 30000) */
  maxMs?: number;
  /** Maximum reconnection attempts (default: Infinity) */
  maxAttempts?: number;
  /** Callback when connection is restored */
  onReconnect?: (connection: ChannelModel, channel: Channel) => Promise<void>;
  /** Callback when connection is permanently lost */
  onGiveUp?: (error: Error) => void;
}

const DEFAULT_OPTIONS: Required<Omit<ReconnectOptions, 'onReconnect' | 'onGiveUp'>> = {
  baseMs: 1000,
  maxMs: 30_000,
  maxAttempts: Infinity,
};

export class RabbitMQReconnector {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private attempt: number = 0;
  private reconnecting: boolean = false;
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
   * Initial connection with automatic reconnect on close/error.
   */
  async connect(): Promise<{ connection: ChannelModel; channel: Channel }> {
    this.connection = await amqplib.connect(this.url);
    this.channel = await this.connection.createChannel();
    this.attempt = 0;

    // Set up automatic reconnection
    this.connection.on('error', (err) => {
      logger.error({ err }, 'RabbitMQ connection error');
    });

    this.connection.on('close', () => {
      logger.warn('RabbitMQ connection closed — initiating reconnect');
      this.scheduleReconnect();
    });

    logger.info('RabbitMQ connected with auto-reconnect enabled');
    return { connection: this.connection, channel: this.channel };
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
          this.channel = await this.connection.createChannel();

          // Re-register close handler
          this.connection.on('close', () => {
            logger.warn('RabbitMQ connection closed again — reconnecting');
            this.reconnecting = false;
            this.scheduleReconnect();
          });

          logger.info({ attempt: this.attempt }, 'RabbitMQ reconnected successfully');
          this.attempt = 0;
          this.reconnecting = false;

          // Notify caller to re-setup topology
          if (this.onReconnect) {
            await this.onReconnect(this.connection, this.channel);
          }

          return;
        } catch (err) {
          logger.warn({ err, attempt: this.attempt }, 'RabbitMQ reconnect attempt failed');
        }
      }

      // Exceeded max attempts
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

  getChannel(): Channel {
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
