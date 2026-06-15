/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'export' is only needed for electron:build (generates static out/ folder).
  ...(process.env.NODE_ENV === 'production' ? { output: 'export' } : {}),
  typescript: {
    // Type errors fail the build. Run `npm run typecheck` to check both the
    // Next.js app and the Electron project without building.
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {},
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Prevent webpack from watching non-app directories.
      config.watchOptions = {
        ...config.watchOptions,
        poll: false,
        aggregateTimeout: 1000,
        ignored: [
          '**/node_modules/**',
          '**/.next/**',
          '**/dist-electron/**',
          '**/dist/**',
          '**/out/**',
          '**/.git/**',
          '**/electron/**',
        ],
      }

      // postcss-loader spawns a child process per CSS file by default on
      // Windows, leaking hundreds of node.exe processes. Force it to run
      // in-process instead.
      for (const rule of config.module.rules) {
        if (!rule || typeof rule !== 'object') continue
        const uses = Array.isArray(rule.use) ? rule.use : rule.use ? [rule.use] : []
        for (const use of uses) {
          if (use?.loader?.includes('postcss-loader')) {
            use.options = { ...use.options, workerThreads: false, parallel: false }
          }
        }
        // Also check nested oneOf rules (Next.js wraps rules this way)
        const oneOf = rule.oneOf
        if (Array.isArray(oneOf)) {
          for (const r of oneOf) {
            const innerUses = Array.isArray(r?.use) ? r.use : r?.use ? [r.use] : []
            for (const use of innerUses) {
              if (use?.loader?.includes('postcss-loader')) {
                use.options = { ...use.options, workerThreads: false, parallel: false }
              }
            }
          }
        }
      }
    }
    return config
  },
}

export default nextConfig
