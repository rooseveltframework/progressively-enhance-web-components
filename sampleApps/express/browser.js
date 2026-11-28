class WordCount extends window.HTMLElement {
  connectedCallback () { // called whenever a new instance of this element is inserted into the dom
    // this.shadowRoot will exist already, except in light mode or for an element created in javascript
    this.shadow = this.shadowRoot || this.attachShadow({ mode: 'open' })

    // add the markup of the component if it is not already populated
    if (!this.shadow.childElementCount) {
      const markup = document.getElementById('word-count').content.cloneNode(true)

      // fill in its ${templateLiterals} from this element's attributes
      //
      // the text and attribute values are set directly rather than by editing markup, so that a value holding a quote or an angle bracket is written as text instead of being parsed as html
      const fill = text => text.replace(/\$\{([^}]+)\}/g, (literal, name) => this.getAttribute(name) ?? literal)
      const walker = document.createTreeWalker(markup, window.NodeFilter.SHOW_ELEMENT | window.NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (node.nodeType === window.Node.TEXT_NODE) node.data = fill(node.data)
        else for (const attrib of node.attributes) attrib.value = fill(attrib.value)
      }

      this.shadow.append(markup)
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
