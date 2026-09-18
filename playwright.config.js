// drives the express sample app in a real browser
//
// the node tests check what the preprocessor writes. they cannot check that what it writes works: a declarative shadow root is built by a browser's parser, and jsdom does not build one, so the shadow root, the slots and the fallback markup all only mean something here. the component class is the sharp edge in particular, calling attachShadow on an element the parser has already given a shadow root throwing rather than degrading
//
// the server is started and stopped by playwright rather than by a test, which is what the old sample app test got wrong: it spawned `npm start` itself, left the child running with the test's pipes open, and so never finished even when its assertion passed
const { defineConfig, devices } = require('@playwright/test')

const port = 3000

module.exports = defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'node server.js',
    cwd: 'sampleApps/express',
    url: `http://localhost:${port}/pageWithForm`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
})
