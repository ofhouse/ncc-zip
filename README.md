# ncc-zip

Wrapper around [ncc](https://github.com/vercel/ncc) that pipes the output in a zip archive.
Requires ncc as peer dependency.

## Usage

```sh
npm i -g ncc-zip @vercel/ncc

ncc-zip <cmd> <opts>
```

E.g.

```sh
ncc build input.js -o dist.zip
```

### Options

```plain
  -o, --out [file]         Output filename for build (defaults to dist.zip)
  -f, --filename [file]    Name of the main file in the zip (defaults to index)
  -c, --config [file]      Path to the ncc.config.json file
  -i, --ignore [asset]     Ignore asset(s) with name or glob pattern to be included in zip
  --license [file]         Adds a file containing licensing information to the output
  --compression            Level of compression to use (default 5)
```

### Configuration of ncc

To configure ncc, you can create a `ncc.config.json` file (or add a "ncc" key to your `package.json`).
For all available configuration options, see the ["Programmatically From Node.js
" section in the readme of the ncc package](https://www.npmjs.com/package/@vercel/ncc).

```javascript
// ncc.config.json
{
  "externals": {
    "aws-sdk": "aws-sdk",
    "/aws-sdk(/.*)/": "aws-sdk$1"
  },
  "minify": true
}
```

## License

MIT - see [LICENSE](./LICENSE) for details.
