const fs = require('fs-extra')
const path = require('path')

const viewsDir = path.join('mvc', 'views')
const preprocessedViewsDir = path.join('mvc', '.preprocessed_views')

// load progressively-enhance-web-components.js
const editedFiles = require('../../progressively-enhance-web-components')({
  templatesDir: viewsDir
})

// copy unmodified templates to a modified templates directory
fs.copySync(viewsDir, preprocessedViewsDir)

// update the relevant templates
//
// the keys are file paths built with path.join, so they are written with whatever separator the platform uses. rebuilding each destination from the path relative to the templates directory is what keeps that working on windows, where a string replace of 'mvc/views' matches nothing in 'mvc\views\pageWithForm.html' and every template is left unenhanced
for (const file in editedFiles) {
  fs.writeFileSync(path.join(preprocessedViewsDir, path.relative(viewsDir, file)), editedFiles[file])
}

// configure express
const express = require('express')
const app = express()
app.use(express.urlencoded({ extended: true })) // populates req.body on requests

app.engine('html', require('teddy').__express) // set teddy as view engine that will load html files
app.set('views', preprocessedViewsDir) // set template dir
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
