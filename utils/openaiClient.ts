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
      timeout: 28000, // Default for fast models; gpt-4o-search-preview uses a longer per-request timeout (see openaiRequestOptionsForModel)
      maxRetries: 1, // Reduce retries to avoid compounding delays
    });
  }
  return openaiInstance;
}

/** gpt-4o-search-preview runs browsing/search and often exceeds the default client timeout. */
const OPENAI_SEARCH_PREVIEW_TIMEOUT_MS = 120_000;

/**
 * Per-request options for models that need more time. Avoids doubling wall-clock on timeout
 * (SDK retries timeouts by default).
 */
export function openaiRequestOptionsForModel(model: string | undefined): { timeout: number; maxRetries: number } | undefined {
  if (model === 'gpt-4o-search-preview') {
    return { timeout: OPENAI_SEARCH_PREVIEW_TIMEOUT_MS, maxRetries: 0 };
  }
  if (model === 'gpt-5.2') {
    return { timeout: OPENAI_SEARCH_PREVIEW_TIMEOUT_MS, maxRetries: 0 };
  }
  return undefined;
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
