# Changelog

## Next version

- Put your changes here...

## 1.0.3

- Fixed another bug that caused errors to print to the console if inline CSS existed in a scanned template.

## 1.0.2

- Fixed a bug that could cause templates to be significantly altered by this preprocessor due to having been fully ingested by a DOM parser and then re-serialized back into a string. As of this version, only the custom elements that are progressively enhanced will be ingested by the DOM parser and re-serialized back into a string.
- Fixed a bug that caused errors to print to the console if inline CSS existed in a scanned template.
- Updated various dependencies.

## 1.0.1

- Fixed a bug that prevented camelCase attribute names from replacing `${templateLiteral}` values for values in <template> markup.
- Updated various dependencies.

## 1.0.0

- Initial commit.
