const fs = require('fs-extra')

// load progressively-enhance-web-components.js
const editedFiles = require('../../progressively-enhance-web-components')({
  templatesDir: './mvc/views'
})

// copy unmodified templates to a modified templates directory
fs.copySync('mvc/views', 'mvc/.preprocessed_views')

// update the relevant templates
for (const file in editedFiles) {
  fs.writeFileSync(file.replace('mvc/views', 'mvc/.preprocessed_views'), editedFiles[file])
}

// configure express
const path = require('path')
const express = require('express')
const app = express()
app.use(require('body-parser').urlencoded({ extended: true })) // populates req.body on requests
app.engine('html', require('teddy').__express) // set teddy as view engine that will load html files
app.set('views', 'mvc/.preprocessed_views') // set template dir
app.set('view engine', 'html') // set teddy as default view engine
if (!fs.existsSync('public')) fs.mkdirSync('public') // make the public folder if it does not exist
app.use(express.static('public')) // make public folder serve static files

// load express routes
require('./mvc/routes')(app)

// bundle frontend js
const webpack = require('webpack')
const webpackConfig = {
  mode: 'production',
  entry: './browser.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'public'),
    libraryTarget: 'umd'
  },
  devtool: 'source-map'
}
const compiler = webpack(webpackConfig)
compiler.run((err, stats) => {
  if (err || stats.hasErrors()) {
    console.error('Webpack build failed:', err || stats.toJson().errors)
  } else {
    // start express server
    const port = 3000
    app.listen(port, () => {
      console.log(`🎧 express sample app server is running on http://localhost:${port}`)
    })
  }
})
