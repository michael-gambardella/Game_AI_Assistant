import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { LRUCache, cacheManager } from './cacheManager';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

let openaiInstance: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is missing or empty. Please set it in your .env or .env.local file.');
    }
    openaiInstance = new OpenAI({
      apiKey: apiKey,
      timeout: 28000, // Default for fast models; some models use a longer per-request timeout (see openaiRequestOptionsForModel)
      maxRetries: 1, // Reduce retries to avoid compounding delays
    });
  }
  return openaiInstance;
}

/** gpt-5.6-terra (reasoning) and gpt-5-search-api (browsing) can take longer per request than the default client timeout. */
const OPENAI_EXTENDED_TIMEOUT_MS = 120_000;
const EXTENDED_TIMEOUT_MODELS = new Set(['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5-search-api']);

/**
 * Per-request options for models that need more time. Avoids doubling wall-clock on timeout
 * (SDK retries timeouts by default).
 */
export function openaiRequestOptionsForModel(model: string | undefined): { timeout: number; maxRetries: number } | undefined {
  if (model && EXTENDED_TIMEOUT_MODELS.has(model)) {
    return { timeout: OPENAI_EXTENDED_TIMEOUT_MS, maxRetries: 0 };
  }
  return undefined;
}

/**
 * Models confirmed to accept a custom `temperature` value. gpt-5.6-terra and
 * gpt-5-search-api reject anything but the default (1) — passing temperature to
 * them 400s the request, so callers must check this before setting it.
 */
const CUSTOM_TEMPERATURE_MODELS = new Set(['gpt-4o', 'gpt-4o-mini']);

export function modelSupportsCustomTemperature(model: string | undefined): boolean {
  return !!model && CUSTOM_TEMPERATURE_MODELS.has(model);
}

/**
 * gpt-5.6 models (reasoning models) burn their ENTIRE max_completion_tokens budget on
 * hidden reasoning tokens by default, regardless of budget size, leaving zero tokens for
 * visible output (finish_reason: 'length', empty content) — confirmed empirically at
 * 300/500/800 token caps. Passing reasoning_effort: 'none' fixes this and lets the model
 * actually answer. gpt-5-search-api does NOT accept this param at all (400s if sent).
 */
const NO_REASONING_EFFORT_MODELS = new Set(['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna']);

export function reasoningEffortForModel(model: string | undefined): 'none' | undefined {
  return model && NO_REASONING_EFFORT_MODELS.has(model) ? 'none' : undefined;
}

export class AICacheMetrics {
  private cache: LRUCache<any>;
  private static instance: AICacheMetrics;

  // Default max size: 2000 entries (adjust based on memory constraints)
  // Each entry is roughly 1-5KB, so 2000 entries = ~2-10MB
  private readonly MAX_CACHE_SIZE = 2000;
  private readonly DEFAULT_TTL = 60 * 60 * 1000; // 1 hour

  private constructor() {
    this.cache = new LRUCache<any>(
      this.MAX_CACHE_SIZE,
      this.DEFAULT_TTL,
      5 * 60 * 1000 // Cleanup every 5 minutes
    );

    // Register with cache manager for monitoring
    cacheManager.registerCache('AICache', this.cache);
  }

  public static getInstance(): AICacheMetrics {
    if (!AICacheMetrics.instance) {
      AICacheMetrics.instance = new AICacheMetrics();
    }
    return AICacheMetrics.instance;
  }

  set(key: string, value: any, ttl: number = this.DEFAULT_TTL): void {
    this.cache.set(key, value, ttl);
  }

  get(key: string): any {
    return this.cache.get(key);
  }

  getMetrics() {
    const metrics = this.cache.getMetrics();
    return {
      hits: metrics.hits,
      misses: metrics.misses,
      hitRate: metrics.hitRate,
      cacheSize: metrics.size,
      maxSize: metrics.maxSize,
      evictions: metrics.evictions,
      expiredRemovals: metrics.expiredRemovals,
      utilization: this.cache.getUtilization().toFixed(2) + '%'
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCache(): LRUCache<any> {
    return this.cache;
  }
}

export const aiCache = AICacheMetrics.getInstance();

export const getAICache = () => aiCache;
