import { probePlugin } from '../probe.mjs'
export default {
  stories: ['../sb/**/*.stories.tsx'],
  addons: [],
  framework: '@storybook/react-vite',
  core: { disableTelemetry: true, allowedHosts: ['.e2b.app'] },
  viteFinal(config) {
    return {
      ...config,
      base: './',
      experimental: { ...config.experimental, relativeDevBase: true },
      plugins: [...config.plugins, probePlugin('storybook')],
      server: {
        ...config.server,
        allowedHosts: true,
        ws: { server: config.server?.hmr?.server },
        hmr: {},
        watch: { usePolling: true, interval: 100 },
      },
    }
  },
}
