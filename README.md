progressively-enhance-web-components
===

[![npm](https://img.shields.io/npm/v/progressively-enhance-web-components.svg)](https://www.npmjs.com/package/progressively-enhance-web-components)

A template file preprocessor for [progressively enhancing](https://en.wikipedia.org/wiki/Progressive_enhancement) web components in Node.js.

It works by reading a directory of HTML templates for your web application, identifying any web components, and replacing custom element invocations with fallback markup that will work if JavaScript is disabled which will then be progressively enhanced into the desired web component when the JavaScript loads.

This allows you to use web components in server-side templating the same way you would with client-side templating without creating a hard dependency on JavaScript for server-side template renders and without having to write two different templates for each context.

This module was built and is maintained by the [Roosevelt web framework](https://github.com/rooseveltframework/roosevelt) [team](https://github.com/orgs/rooseveltframework/people), but it can be used independently of Roosevelt as well.

## Technique

To leverage this module's progressive enhancement technique, you will need to follow some simple rules when authoring your web component:

1. Always define the markup structure using a `<template>` element. The definition can exist anywhere in any of your templates, but the definition must exist.
2. The template element you create to define your web component must have an `id` matching the name of the web component. So `<my-component>` must have a corresponding `<template id="my-component">` somewhere in your templates.
3. Use `${templateLiteral}` values for values in your `<template>` markup. See how that works in the example below.

## Usage

We will demo this technique end-to-end using a `<word-count>` component that counts the number of words a user types into a `<textarea>`.

Suppose the intended use of the `<word-count>` component looks like this:

```html
<word-count text="Once upon a time... " id="story">
  <p slot="description">Type your story in the box above!</p>
</word-count>
```

And suppose also that you have an Express application with templates loaded into `mvc/views`.

So to leverage this module's progressive enhancement technique, you will need to define this component using a `<template>` element in any one of your templates as follows:

```html
<template id="word-count">
  <style>
    div {
      position: relative;
    }
    textarea {
      margin-top: 35px;
      width: 100%;
      box-sizing: border-box;
    }
    span {
      display: block;
      position: absolute;
      top: 0;
      right: 0;
      margin-top: 10px;
      font-weight: bold;
    }
  </style>
  <div>
    <textarea rows="10" cols="50" name="${id}" id="${id}">${text}</textarea>
    <slot name="description"></slot>
    <span class="word-count"></span>
  </div>
</template>
```

*Note: Any `${templateLiterals}` present in the template markup will be replaced with attribute values from the custom element invocation. More on that below.*

Then, in your Express application:

```javascript
const fs = require('fs-extra')

// load progressively-enhance-web-components.js
const editedFiles = require('progressively-enhance-web-components')({
  templatesDir: './mvc/views'
})

// copy unmodified templates to a modified templates directory
fs.copySync('mvc/views', 'mvc/.preprocessed_views')

// update the relevant templates
for (const file in editedFiles) {
  fs.writeFileSync(file.replace('mvc/views', 'mvc/.preprocessed_views'), editedFiles[file])
}

// configure express
const express = require('express')
const app = express()
app.engine('html', require('teddy').__express) // set teddy as view engine that will load html files
app.set('views', 'mvc/.preprocessed_views') // set template dir
app.set('view engine', 'html') // set teddy as default view engine

// start the server
const port = 3000
app.listen(port, () => {
  console.log(`🎧 express sample app server is running on http://localhost:${port}`)
})
```

*Note: The above example uses the [Teddy](https://github.com/rooseveltframework/teddy) templating system, but you can use any templating system you like, so long as your templates can survive being preprocessed by [jsdom](https://github.com/jsdom/jsdom), which is a core part of how this module does its progressive enhancement work.*

In the above sample Express application, the `mvc/views` folder is copied to `mvc/.preprocessed_views`, then any template files in there will be updated to replace any uses of `<word-count>` with a more progressive enhancement-friendly version of `<word-count>` instead.

So, for example, any web component in your templates that looks like this:

```html
<word-count text="Once upon a time... " id="story">
  <p slot="description">Type your story in the box above!</p>
</word-count>
```

Will be replaced with this:

```html
<word-count text="Once upon a time... " id="story">
  <div>
    <textarea rows="10" cols="50" name="story" id="story">Once upon a time... </textarea>
    <span class="word-count"></span>
  </div>
  <p slot="description">Type your story in the box above!</p>
</word-count>
```

The fallback markup is derived from the `<template>` element and is inserted into the "light DOM" of the web component, so it will display to users with JavaScript disabled.

Because the `<template>` element has `${templateLiteral}` values for the `name` attribute, the `id` attribute, and the contents of the `<textarea>`, those values are prefilled properly on the fallback markup.

Any tag in the `<template>` element that has a `slot` attribute will be moved to the top level of the fallback markup DOM because that is a requirement for the web component to work when JavaScript is enabled. That's why the `<p>` tag is not a child of the `<div>` in the replacement example like it is in the `<template>`. That is done intentionally by this module's preprocessing.

Then, once the frontend JavaScript takes over, the web component can be progressively enhanced into the JS-driven version.

Here's an example implementation for the frontend JS side:

```javascript
class WordCount extends window.HTMLElement {
  connectedCallback () { // called whenever a new instance of this element is inserted into the dom
    this.shadow = this.attachShadow({ mode: 'open' }) // create and attach a shadow dom to the custom element
    this.shadow.appendChild(document.getElementById('word-count').content.cloneNode(true)) // create the elements in the shadow dom from the template element

    // set textarea attributes
    const textarea = this.shadow.querySelector('textarea')
    textarea.value = this.getAttribute('text') || ''
    textarea.id = this.getAttribute('id') || ''
    textarea.name = this.getAttribute('id') || ''

    // function for updating the word count
    const updateWordCount = () => {
      this.shadow.querySelector('span').textContent = `Words: ${textarea.value.trim().split(/\s+/g).filter(a => a.trim().length > 0).length}`
    }

    // update count when textarea content changes
    textarea.addEventListener('input', updateWordCount)
    updateWordCount() // update it on load as well
  }
}

window.customElements.define('word-count', WordCount) // define the new element
```

Once that JS executes, the "light DOM" fallback markup will be hidden and the JS-enabled version of the web component will take over and behave as normal.

### Available options

When you call:

```javascript
const editedFiles = require('progressively-enhance-web-components')({
  templatesDir: './mvc/views'
})
```

There are other params you can pass to it besides `templatesDir`.

The full list of params available is:

- `templatesDir`: What folder to examine. This is required.
- `disableBeautify`: If set to true, this module will not beautify the HTML in the outputted markup. Default: `false`.
- `beautifyOptions`: Options to pass to [js-beautify](https://github.com/beautifier/js-beautify). Default: `{ indent_size: 2 }`.

### Sample app

Here's how to run the sample app:

- `cd sampleApps/express`

- `npm ci`

- `cd ../../`

- `npm run express-sample`

  - Or `npm run sample`

  - Or `cd` into `sampleApps/express` and run `npm ci` and `npm start`

- Go to [http://localhost:3000](http://localhost:3000)

  - The page with the web component is located at http://localhost:3000/pageWithForm
