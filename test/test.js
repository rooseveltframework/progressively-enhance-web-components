/* eslint-env mocha */
const assert = require('assert')
const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const sampleAppDir = path.join(__dirname, '..', 'sampleApps', 'express')

before(async function () {
  await new Promise((resolve, reject) => {
    const serverProcess = exec('npm start', { cwd: sampleAppDir })
    serverProcess.stdout.on('data', (data) => {
      if (data.toString().includes('express sample app server is running')) resolve()
    })
    serverProcess.stderr.on('data', (data) => {
      console.error(data.toString())
      console.error('Make sure to `npm ci` in the sampleApp/express directory first!')
    })
    serverProcess.on('error', (error) => reject(error))
    this.serverProcess = serverProcess
  })
})

after(async function () {
  if (this.serverProcess) this.serverProcess.kill()
})

describe('progressively-enhance-web-components tests', function () {
  it('should progressively enhance the <word-count> invocation in the sample app', async function () {
    const filePath = path.join(sampleAppDir, 'mvc', '.preprocessed_views', 'pageWithForm.html')
    const fileContent = fs.readFileSync(filePath, 'utf8')
    assert(fileContent.includes(`<word-count text="Once upon a time... " elid="story">
  <div>
    <textarea rows="10" cols="50" name="story" id="story">Once upon a time... </textarea>
    <span class="word-count"></span>
  </div>
  <p slot="description">Type your story in the box above!</p>
</word-count>`), 'Expected markup not found')
  })
})
