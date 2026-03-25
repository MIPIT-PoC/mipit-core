jest.mock('../../../src/observability/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    })),
  },
}));

jest.mock('../../../src/observability/metrics.js', () => ({
  startLatencyTimer: jest.fn(() => jest.fn()),
  recordTranslationError: jest.fn(),
}));

jest.mock('../../../src/translation/pix-to-canonical.js', () => ({
  pixToCanonical: jest.fn(),
}));

jest.mock('../../../src/translation/spei-to-canonical.js', () => ({
  speiToCanonical: jest.fn(),
}));

jest.mock('../../../src/translation/canonical-to-pix.js', () => ({
  canonicalToPix: jest.fn(),
}));

jest.mock('../../../src/translation/canonical-to-spei.js', () => ({
  canonicalToSpei: jest.fn(),
}));

import { Translator } from '../../../src/translation/translator.js';
import type { MappingLoader } from '../../../src/translation/mapping-loader.js';
import { TranslationError } from '../../../src/domain/errors/index.js';
import { pixToCanonical } from '../../../src/translation/pix-to-canonical.js';
import { speiToCanonical } from '../../../src/translation/spei-to-canonical.js';
import { canonicalToPix } from '../../../src/translation/canonical-to-pix.js';
import { canonicalToSpei } from '../../../src/translation/canonical-to-spei.js';
import { startLatencyTimer, recordTranslationError } from '../../../src/observability/metrics.js';

const fakeCanonical = {
  payment_id: 'PMT-TEST1234567890ABCDEF',
  origin: { rail: 'PIX' },
  amount: { value: 100, currency: 'BRL' },
} as any;

const mockMappingLoader = {
  loadMappings: jest.fn().mockResolvedValue(new Map()),
  clearCache: jest.fn(),
} as unknown as jest.Mocked<MappingLoader>;

describe('Translator', () => {
  let translator: Translator;

  beforeEach(() => {
    translator = new Translator(mockMappingLoader);
    jest.clearAllMocks();
  });

  describe('toCanonical', () => {
    it('should delegate PIX to pixToCanonical', async () => {
      (pixToCanonical as jest.Mock).mockResolvedValue(fakeCanonical);

      const result = await translator.toCanonical('PIX', {}, 'PMT-TEST1234567890ABCDEF');
      expect(result).toBe(fakeCanonical);
      expect(pixToCanonical).toHaveBeenCalledWith({}, 'PMT-TEST1234567890ABCDEF', mockMappingLoader, undefined);
    });

    it('should delegate SPEI to speiToCanonical', async () => {
      (speiToCanonical as jest.Mock).mockResolvedValue(fakeCanonical);

      const result = await translator.toCanonical('SPEI', {}, 'PMT-TEST1234567890ABCDEF', 'trace-1');
      expect(result).toBe(fakeCanonical);
      expect(speiToCanonical).toHaveBeenCalledWith({}, 'PMT-TEST1234567890ABCDEF', mockMappingLoader, 'trace-1');
    });

    it('should throw TranslationError for unsupported rail', async () => {
      await expect(translator.toCanonical('SWIFT', {}, 'PMT-TEST1234567890ABCDEF'))
        .rejects.toThrow(TranslationError);
      expect(recordTranslationError).toHaveBeenCalledWith('SWIFT', 'validation');
    });

    it('should record unexpected error metric on delegate failure', async () => {
      (pixToCanonical as jest.Mock).mockRejectedValue(new Error('boom'));

      await expect(translator.toCanonical('PIX', {}, 'PMT-TEST1234567890ABCDEF'))
        .rejects.toThrow('boom');
      expect(recordTranslationError).toHaveBeenCalledWith('PIX', 'unexpected');
    });

    it('should start and stop latency timer', async () => {
      const stopFn = jest.fn();
      (startLatencyTimer as jest.Mock).mockReturnValue(stopFn);
      (pixToCanonical as jest.Mock).mockResolvedValue(fakeCanonical);

      await translator.toCanonical('PIX', {}, 'PMT-TEST1234567890ABCDEF');
      expect(startLatencyTimer).toHaveBeenCalledWith('translation_to_canonical');
      expect(stopFn).toHaveBeenCalled();
    });
  });

  describe('fromCanonical', () => {
    it('should delegate PIX to canonicalToPix', async () => {
      const pixPayload = { endToEndId: 'E2E-1' };
      (canonicalToPix as jest.Mock).mockResolvedValue(pixPayload);

      const result = await translator.fromCanonical('PIX', fakeCanonical);
      expect(result).toBe(pixPayload);
      expect(canonicalToPix).toHaveBeenCalledWith(fakeCanonical);
    });

    it('should delegate SPEI to canonicalToSpei', async () => {
      const speiPayload = { claveRastreo: 'CR-1' };
      (canonicalToSpei as jest.Mock).mockResolvedValue(speiPayload);

      const result = await translator.fromCanonical('SPEI', fakeCanonical);
      expect(result).toBe(speiPayload);
      expect(canonicalToSpei).toHaveBeenCalledWith(fakeCanonical);
    });

    it('should throw TranslationError for unsupported destination', async () => {
      await expect(translator.fromCanonical('SWIFT', fakeCanonical))
        .rejects.toThrow(TranslationError);
    });

    it('should start and stop latency timer on fromCanonical', async () => {
      const stopFn = jest.fn();
      (startLatencyTimer as jest.Mock).mockReturnValue(stopFn);
      (canonicalToPix as jest.Mock).mockResolvedValue({});

      await translator.fromCanonical('PIX', fakeCanonical);
      expect(startLatencyTimer).toHaveBeenCalledWith('translation_from_canonical');
      expect(stopFn).toHaveBeenCalled();
    });
  });
});
