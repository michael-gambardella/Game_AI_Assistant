import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Security Headers Configuration
 * 
 * This module contains the security headers logic that can be used
 * by Next.js Edge Middleware or API route middleware.
 * 
 * See SECURITY_REVIEW.md and SECURITY_HEADERS_IMPLEMENTATION.md for details.
 */

/**
 * Get security headers configuration
 * Returns an object with all security headers and their values
 */
export function getSecurityHeaders(request: NextRequest): Record<string, string> {
  const isProduction = process.env.NODE_ENV === 'production';
  const origin = request.headers.get('origin');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://assistant.videogamewingman.com/';

  const headers: Record<string, string> = {};

  // ============================================
  // 1. X-Frame-Options: Prevent clickjacking
  // ============================================
  headers['X-Frame-Options'] = 'DENY';

  // ============================================
  // 2. X-Content-Type-Options: Prevent MIME sniffing
  // ============================================
  headers['X-Content-Type-Options'] = 'nosniff';

  // ============================================
  // 3. X-XSS-Protection: Legacy XSS protection
  // ============================================
  headers['X-XSS-Protection'] = '1; mode=block';

  // ============================================
  // 4. Referrer-Policy: Control referrer information
  // ============================================
  headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';

  // ============================================
  // 5. Permissions-Policy: Control browser features
  // ============================================
  headers['Permissions-Policy'] = [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'interest-cohort=()', // Disable FLoC tracking
    'payment=()',
    'usb=()',
  ].join(', ');

  // ============================================
  // 6. Strict-Transport-Security (HSTS): Force HTTPS
  // ============================================
  if (isProduction) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
  }

  // ============================================
  // 7. Content-Security-Policy: Prevent XSS and injection
  // ============================================
  const cspDirectives = [
    // Default source: only allow same-origin
    "default-src 'self'",
    
    // Scripts: allow same-origin, inline scripts (Next.js requires this), and eval (for development)
    // Include Google Tag Manager, Stripe, and Cloudflare Insights for production
    process.env.NODE_ENV === 'production'
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://js.stripe.com https://checkout.stripe.com https://static.cloudflareinsights.com"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://static.cloudflareinsights.com",
    
    // Styles: allow same-origin and inline styles (required for CSS-in-JS)
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    
    // Fonts: allow same-origin and Google Fonts
    "font-src 'self' https://fonts.gstatic.com data:",
    
    // Images: allow same-origin, data URIs, and your image CDNs
    "img-src 'self' data: blob: https:",
    
    // Connect: allow same-origin and API endpoints
    // Include Google Analytics and Cloudflare Insights for data collection
    // Include Heroku backend for splash page API calls
    "connect-src 'self' https://api.openai.com https://*.openai.com https://api.igdb.com https://api.rawg.io https://api.stripe.com https://checkout.stripe.com https://www.google-analytics.com https://www.googletagmanager.com https://cloudflareinsights.com https://*.cloudflareinsights.com https://*.herokuapp.com wss: ws:",
    
    // Media: allow same-origin
    "media-src 'self' blob:",
    
    // Object: deny all (prevents Flash, etc.)
    "object-src 'none'",
    
    // Base URI: restrict to same-origin
    "base-uri 'self'",
    
    // Form action: restrict to same-origin
    "form-action 'self'",
    
    // Frame ancestors: deny all (redundant with X-Frame-Options but more modern)
    "frame-ancestors 'none'",
    
    // Upgrade insecure requests: upgrade HTTP to HTTPS
    isProduction ? "upgrade-insecure-requests" : "",
  ].filter(Boolean); // Remove empty strings

  headers['Content-Security-Policy'] = cspDirectives.join('; ');

  // ============================================
  // 8. Expect-CT: Certificate Transparency (Production only)
  // ============================================
  if (isProduction) {
    headers['Expect-CT'] = 'max-age=86400, enforce';
  }

  return headers;
}

/**
 * Get CORS headers for API routes
 */
export function getCorsHeaders(request: NextRequest): Record<string, string> {
  const isProduction = process.env.NODE_ENV === 'production';
  const origin = request.headers.get('origin');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://assistant.videogamewingman.com/';
  
  const headers: Record<string, string> = {};

  // Only set CORS headers for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Allow credentials for authenticated requests
    headers['Access-Control-Allow-Credentials'] = 'true';
    
    // Set allowed origin (only in production, be specific)
    if (isProduction && origin) {
      // You can configure allowed origins via environment variable
      const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [appUrl];
      if (allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
      }
    } else if (!isProduction) {
      // In development, allow localhost
      headers['Access-Control-Allow-Origin'] = origin || '*';
    }
    
    // Set allowed methods
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH';
    
    // Set allowed headers
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With, Cookie';
    
    // Set max age for preflight requests
    headers['Access-Control-Max-Age'] = '86400'; // 24 hours
  }

  return headers;
}

/**
 * Apply all security headers to a NextResponse
 * This is the main function used by Edge Middleware
 */
export function applySecurityHeaders(request: NextRequest, response: NextResponse): NextResponse {
  // Get security headers
  const securityHeaders = getSecurityHeaders(request);
  const corsHeaders = getCorsHeaders(request);

  // Apply all headers to the response
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Remove server information disclosure
  response.headers.set('X-Powered-By', ''); // Next.js will override this, but we try

  return response;
}

