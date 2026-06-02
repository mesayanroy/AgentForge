import createMDX from '@next/mdx';

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],

  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },

  // Prevent Next.js from bundling native Node.js modules (stellar-sdk uses
  // sodium-native which is a native addon). This keeps them as external
  // Node.js requires inside serverless functions instead of being inlined
  // by webpack, which would fail on Vercel/Edge environments.
  serverExternalPackages: ['stellar-sdk', '@stellar/stellar-base', 'sodium-native'],

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});

export default withMDX(nextConfig);
