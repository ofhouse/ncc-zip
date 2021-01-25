# ncc-zip

Wrapper around [ncc](https://github.com/vercel/ncc) that pipes the output in a zip archive. Requires ncc as peer dependency.

## Usage

```sh
npm i -g ncc-zip @vercel/ncc

ncc-zip <cmd> <opts>
```

E.g.

```sh
ncc build input.js -o dist.zip
```

## License

MIT - see [LICENSE](./LICENSE) for details.
