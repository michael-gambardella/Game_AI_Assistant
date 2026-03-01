// next.config.mjs

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Security headers (fallback - middleware.ts is primary)
  // These are applied to static files and pages that middleware might miss
  // IMPORTANT: This is a fallback. Middleware.ts should be the primary source.
  async headers() {
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Build CSP directive
    const cspDirectives = [
      "default-src 'self'",
      isProduction
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://js.stripe.com https://checkout.stripe.com https://static.cloudflareinsights.com"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://api.openai.com https://*.openai.com https://api.igdb.com https://api.rawg.io https://api.stripe.com https://checkout.stripe.com https://www.google-analytics.com https://www.googletagmanager.com https://cloudflareinsights.com https://*.cloudflareinsights.com https://*.herokuapp.com wss: ws:",
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      ...(isProduction ? ["upgrade-insecure-requests"] : []),
    ].filter(Boolean);
    
    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()',
          },
          {
            key: 'Content-Security-Policy',
            value: cspDirectives.join('; '),
          },
          // HSTS only in production
          ...(isProduction ? [{
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          }, {
            key: 'Expect-CT',
            value: 'max-age=86400, enforce',
          }] : []),
        ],
      },
    ];
  },
  images: {
    // Allow images from cloud storage providers
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ik.imagekit.io', // ImageKit
      },
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com', // Cloudinary
      },
      {
        protocol: 'https',
        hostname: '**.amazonaws.com', // AWS S3
      },
    ],
    // Also allow local images
    unoptimized: false,
  },
  webpack: (config, { isServer }) => {
    // Make optional image storage dependencies external to prevent build errors
    // These are dynamically imported only when needed
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'cloudinary': 'commonjs cloudinary',
        'imagekit': 'commonjs imagekit',
        '@aws-sdk/client-s3': 'commonjs @aws-sdk/client-s3',
      });
    }
    return config;
  },
};

export default nextConfig;