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

### Options

```plain
  -o, --out [file]         Output filename for build (defaults to dist.zip)
  -f, --filename [file]    The name of the main file in the zip (defaults to index)
  -m, --minify             Minify output
  -C, --no-cache           Skip build cache population
  -s, --source-map         Generate source map
  --no-source-map-register Skip source-map-register source map support
  -e, --external [mod]     Skip bundling 'mod'. Can be used many times
  -i, --ignore [asset]     Ignore asset with name or glob pattern to be included in zip
  -q, --quiet              Disable build summaries / non-error outputs
  -w, --watch              Start a watched build
  -t, --transpile-only     Use transpileOnly option with the ts-loader
  --v8-cache               Emit a build using the v8 compile cache
  --license [file]         Adds a file containing licensing information to the output
  --stats-out [file]       Emit webpack stats as json to the specified output file
  --target                  What build target to use for webpack (default: es6)
```

## License

MIT - see [LICENSE](./LICENSE) for details.
