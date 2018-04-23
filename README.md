# OpenAPI Generator, eller?

Generate OpenAPI v3 clients and servers from the command line with nothing more
than Node.js.

Just run:

```
npm i -g openapi-eller
```

See `openapi-eller --help` for usage details.

- [Documentation](https://technocreatives.github.io/openapi-eller)

<!-- ---

Looking for an easy way to generate a mock server from an OpenAPI v3 spec? We've got you covered.

Try [openapi-mock-eller](https://github.com/technocreatives/openapi-mock-eller) today!

--- -->

**PLEASE NOTE: This codebase is still a work-in-progress, but it does produce production-grade code
for those targets listed as supported. Behaviour is subject to change between variants until 1.0.0.**

## Features

- Supports* the full OpenAPI v3 specification
- Uses an interceptor pattern for handling security schemas in clients
- OAuth 2 clients comply with [RFC6749](https://tools.ietf.org/html/rfc6749) and 
  [RFC6750](https://tools.ietf.org/html/rfc6750) (Bearer Token Usage)
- Targets can be configured with a JSON file for simple, reproducable generations
- Easily extensible Handlebars templates for core structure of files, with TypeScript 
  target-specific code for handling with pointy bits

## Supported targets

- Clients:
  - JavaScript (browser and backend)
  - Kotlin (Android)
  - Swift
- Servers:
  - ASP.NET (MVC Framework 4.5)

There are other targets in the tree, though they are a work-in-progress.

## Users

- The Techno Creatives

## Roadmap

- Abstract class for handling targets
- Modularise and clean up the messy generator code
- Support for nested anonymous objects (there's already partial support but it's patchy)
- A template generator for building new targets with ease
- A template checklist for generator compliance
- Documentation for the internal representation of the schemas to ease development

## Contributing

We happily accept contributions! We simply ask that you please make sure that any dependencies 
of your targets use a permissive license compatible with the ISC license (which means no AGPL or 
GPL dependencies, unfortunately.)

If you're unsure, open an issue and we can help you out!

## License

ISC license - see LICENSE file.

Any code outputted by this generator is the license of your choice.
