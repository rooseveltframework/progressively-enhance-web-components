When you call:

```javascript
const editedFiles = require('progressively-enhance-web-components')({
  templatesDir: './mvc/views'
})
```

There are other params you can pass to it besides `templatesDir`.

The full list of params available is:

- `templatesDir` *[String]*: What folder to examine. This is required.
- `disableBeautify` *[Boolean]*: If set to true, this module will not beautify the HTML in the outputted markup. Default: `false`.
- `beautifyOptions` *[Object]*: Options to pass to [js-beautify](https://github.com/beautifier/js-beautify). Default: `{ indent_size: 2 }`.
