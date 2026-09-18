We will demo this technique end-to-end using a `<word-count>` component that counts the number of words a user types into a `<textarea>`.

Suppose the intended use of the `<word-count>` component looks like this:

```html
<word-count text="Once upon a time... " id="story">
  <p slot="description">Type your story in the box above!</p>
</word-count>
```

And suppose also that you have an Express application with templates loaded into `mvc/views`.

To leverage this module's progressive enhancement technique, you will need to define this component using a `<template>` element in any one of your templates as follows:

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
const path = require('path')

const viewsDir = path.join('mvc', 'views')
const preprocessedViewsDir = path.join('mvc', '.preprocessed_views')

// load progressively-enhance-web-components.js
const editedFiles = require('progressively-enhance-web-components')({
  templatesDir: viewsDir
})

// copy unmodified templates to a modified templates directory
fs.copySync(viewsDir, preprocessedViewsDir)

// update the relevant templates
for (const file in editedFiles) {
  fs.writeFileSync(path.join(preprocessedViewsDir, path.relative(viewsDir, file)), editedFiles[file])
}

// configure express
const express = require('express')
const app = express()
app.engine('html', require('teddy').__express) // set teddy as view engine that will load html files
app.set('views', preprocessedViewsDir) // set template dir
app.set('view engine', 'html') // set teddy as default view engine

// start the server
const port = 3000
app.listen(port, () => {
  console.log(`🎧 express sample app server is running on http://localhost:${port}`)
})
```

*Note: The above example uses the [Teddy](https://rooseveltframework.org/docs/teddy) templating system, but you can use any templating system you like.*

In the above sample Express application, the `mvc/views` folder is copied to `mvc/.preprocessed_views`, then any template files in there will be updated to replace any uses of `<word-count>` with a more progressive enhancement-friendly version of `<word-count>` instead.

What that version looks like depends on the mode. There are three modes: `light`, `shadow`, and `both`. You can declare a mode with the `mode` attribute in your template element:

```html
<template id="word-count" mode="shadow">
```

Or set `mode` as a param instead to change the default for every component at once.

Whichever mode is used, the `${templateLiterals}` in the definition are replaced with the attribute values of the invocation, which is how the `name` attribute, the `id` attribute and the contents of the `<textarea>` come to be filled in below. The `<template>` element defining the component is also left in the page in every mode, so a component created in JavaScript still has something to render from.

### Modes

#### `both`

The default. The component's markup is written into a [declarative shadow root](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/template#shadowrootmode), and a copy of it is kept beside that as fallback content. So a web component in your templates that looks like this:

```html
<word-count text="Once upon a time... " id="story">
  <p slot="description">Type your story in the box above!</p>
</word-count>
```

Will be replaced with this:

```html
<word-count text="Once upon a time... " id="story" data-enhanced>
  <template shadowrootmode="open">
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
      <textarea rows="10" cols="50" name="story" id="story">Once upon a time... </textarea>
      <slot name="description"></slot>
      <span class="word-count"></span>
    </div>
  </template>
  <div slot="pewc-fallback">
    <textarea rows="10" cols="50" name="story" id="story">Once upon a time... </textarea>
    <span class="word-count"></span>
  </div>

  <p slot="description">Type your story in the box above!</p>
</word-count>
```

This mode is the default because it is the most progressive enhancement-friendly: it is the only one that renders the component before any JavaScript loads whatever the browser supports, and where declarative shadow DOM is supported what it renders is the finished component, styled and with its slots filled, rather than a stand-in that appears unstyled and is then replaced. The tradeoff is it serves the most verbose amount of markup to the page, but that cost is trivial, especially when taking compression into consideration.

#### `shadow`

The declarative shadow root alone, with no fallback copy:

```html
<word-count text="Once upon a time... " id="story" data-enhanced>
  <template shadowrootmode="open">
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
      <textarea rows="10" cols="50" name="story" id="story">Once upon a time... </textarea>
      <slot name="description"></slot>
      <span class="word-count"></span>
    </div>
  </template>

  <p slot="description">Type your story in the box above!</p>
</word-count>
```

Smaller, and worth choosing for a component whose content nobody would miss before the JavaScript loads, such as a tab bar or a toggle. The cost is that a browser which does not support declarative shadow DOM renders nothing at all, an unsupported `<template>` being inert. The same is true of anything that parses HTML without building shadow roots, such as a crawler that does not run a browser engine.

#### `light`

The fallback markup alone, written into the light DOM:

```html
<word-count text="Once upon a time... " id="story" data-enhanced>
  <div>
    <textarea rows="10" cols="50" name="story" id="story">Once upon a time... </textarea>
    <span class="word-count"></span>
  </div>
  <p slot="description">Type your story in the box above!</p>
</word-count>
```

This displays to users with JavaScript disabled in every browser, but it is unstyled, the content given to a slot is not projected into it, and once the component upgrades the markup is shadowed and stays in the DOM unused.

### How to ensure a custom element you want left untouched by this library is ignored

Apply a `data-enhanced` attribute:

```html
<word-count text="Once upon a time... " id="story" data-enhanced>
  <!-- whatever you wrote here is what stays here -->
</word-count>
```

Alternatively, if a `<template shadowrootmode>` exists in your custom element invocation, that will also cause this library to ignore it.

This library will also apply the `data-enhanced` attribute to any custom element it enhances to prevent re-enhancing on a second pass. 

### Writing the frontend JavaScript

Then, once the frontend JavaScript takes over, the web component can be progressively enhanced into the JS-driven version.

Here's an example implementation for the frontend JS side:

```javascript
class WordCount extends window.HTMLElement {
  connectedCallback () { // called whenever a new instance of this element is inserted into the dom
    // this.shadowRoot will exist already, except in light mode or for an element created in javascript
    this.shadow = this.shadowRoot || this.attachShadow({ mode: 'open' })

    // add the markup of the component if it is not already populated
    if (!this.shadow.childElementCount) {
      const markup = document.createElement('div')
      markup.appendChild(document.getElementById('word-count').content.cloneNode(true))

      // fill in its ${templateLiterals} from this element's attributes
      for (const attrib of this.attributes) markup.innerHTML = markup.innerHTML.replace(new RegExp(`\\$\\{${attrib.name}\\}`, 'gi'), attrib.value)

      this.shadow.append(...markup.childNodes)
    }

    const textarea = this.shadow.querySelector('textarea')

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

### Sample app

The sample app takes the default mode, so you can see each half of it working. See an end-to-end demo by running it:

- `cd sampleApps/express`
- `npm ci`
- `cd ../../`
- `npm run express-sample`
  - Or `npm run sample`
  - Or `cd` into `sampleApps/express` and run `npm ci` and `npm start`
- Go to [http://localhost:3000](http://localhost:3000)
  - The page with the web component is located at [http://localhost:3000/pageWithForm](http://localhost:3000/pageWithForm)

Look at `mvc/.preprocessed_views/pageWithForm.html` to see what the invocation was turned into. Then turn JavaScript off and load the page again: the component still renders, still has its styles, and still shows the content given to its slot, because the browser's parser built the shadow root without being asked to run anything. Only the word counter is missing, that being the part JavaScript is there for.
