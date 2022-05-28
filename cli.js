#!/usr/bin/env node

const { resolve, relative, dirname, sep } = require("path");
const shebangRegEx = require("./utils/shebang");
const rimraf = require("rimraf");
const crypto = require("crypto");
const {
  writeFileSync,
  createWriteStream,
  existsSync,
  symlinkSync,
} = require("fs");
const archiver = require("archiver");
const mkdirp = require("mkdirp");
const minimatch = require("minimatch");
const { version: nccVersion } = require("@vercel/ncc/package.json");

// License and TypeScript plugins have Webpack deprecation warnings
// we don't want these on when running as a CLI utility
process.noDeprecation = true;

const usage = `Usage: ncc-zip <cmd> <opts>

Commands:
  build <input-file> [opts]
  run <input-file> [opts]
  cache clean|dir|size
  help
  version

Options:
  -o, --out [file]         Output filename for build (defaults to dist.zip)
  -f, --filename [file]    Name of the main file in the zip (defaults to index)
  -c, --config [file]      Path to the ncc.config.json file
  -i, --ignore [asset]     Ignore asset(s) with name or glob pattern to be included in zip
  --license [file]         Adds a file containing licensing information to the output
  --compression            Level of compression to use (default 5)
`;

// support an API mode for CLI testing
let api = false;
if (require.main === module) {
  runCmd(process.argv.slice(2), process.stdout, process.stderr)
    .then((watching) => {
      if (!watching) process.exit();
    })
    .catch((e) => {
      if (!e.silent) console.error(e.nccError ? e.message : e);
      process.exit(e.exitCode || 1);
    });
} else {
  module.exports = runCmd;
  api = true;
}

/**
 * Reads the config in the following order:
 * 1. Check if config path is present
 * 2. Lookup for ncc.config.json
 * 3. Lookup for "ncc" key in package.json
 */
function getConfig(cwd, configPath) {
  function lookupConfig(cwd, pathToFile) {
    const lookupPath = resolve(cwd, pathToFile);
    if (!existsSync(lookupPath)) {
      return null;
    }

    try {
      return require(lookupPath);
    } catch (error) {
      return false;
    }
  }

  // Custom config path provided
  if (configPath) {
    const config = lookupConfig(cwd, configPath);
    if (config === null) {
      throw new Error(`Could not find config at ${configPath}`);
    } else if (config === false) {
      throw new Error(`Error parsing config at ${configPath}`);
    }

    return config;
  }

  // Check for ncc.config.json
  const config = lookupConfig(cwd, "ncc.config.json");
  if (config) {
    return config;
  }

  // Check for ncc key in package.json
  const packageJson = lookupConfig(cwd, "package.json");
  if (packageJson && packageJson.ncc) {
    return packageJson.ncc;
  }

  return {};
}

function renderSummary(code, map, assets, ext, outDir, buildTime) {
  if (outDir && !outDir.endsWith(sep)) outDir += sep;
  const codeSize = Math.round(Buffer.byteLength(code, "utf8") / 1024);
  const mapSize = map ? Math.round(Buffer.byteLength(map, "utf8") / 1024) : 0;
  const assetSizes = Object.create(null);
  let totalSize = codeSize;
  let maxAssetNameLength = 8 + (map ? 4 : 0); // length of index.js(.map)?
  for (const asset of Object.keys(assets)) {
    const assetSource = assets[asset].source;
    const assetSize = Math.round(
      (assetSource.byteLength || Buffer.byteLength(assetSource, "utf8")) / 1024
    );
    assetSizes[asset] = assetSize;
    totalSize += assetSize;
    if (asset.length > maxAssetNameLength) maxAssetNameLength = asset.length;
  }
  const orderedAssets = Object.keys(assets).sort((a, b) =>
    assetSizes[a] > assetSizes[b] ? 1 : -1
  );

  const sizePadding = totalSize.toString().length;

  let indexRender = `${codeSize
    .toString()
    .padStart(sizePadding, " ")}kB  ${outDir}index${ext}`;
  let indexMapRender = map
    ? `${mapSize
        .toString()
        .padStart(sizePadding, " ")}kB  ${outDir}index${ext}.map`
    : "";

  let output = "",
    first = true;
  for (const asset of orderedAssets) {
    if (first) first = false;
    else output += "\n";
    if (codeSize < assetSizes[asset] && indexRender) {
      output += indexRender + "\n";
      indexRender = null;
    }
    if (mapSize && mapSize < assetSizes[asset] && indexMapRender) {
      output += indexMapRender + "\n";
      indexMapRender = null;
    }
    output += `${assetSizes[asset]
      .toString()
      .padStart(sizePadding, " ")}kB  ${outDir}${asset}`;
  }

  if (indexRender) {
    output += (first ? "" : "\n") + indexRender;
    first = false;
  }
  if (indexMapRender) output += (first ? "" : "\n") + indexMapRender;

  output += `\n${totalSize}kB  [${buildTime}ms] - ncc ${nccVersion}`;

  return output;
}

function nccError(msg, exitCode = 1) {
  const err = new Error(msg);
  err.nccError = true;
  err.exitCode = exitCode;
  throw err;
}

async function runCmd(argv, stdout, stderr) {
  let args;
  try {
    args = require("arg")(
      {
        "--ignore": [String],
        "-i": "--ignore",
        "--out": String,
        "-o": "--out",
        "--filename": String,
        "-f": "--filename",
        "--license": String,
        "--stats-out": String,
        "--quiet": Boolean,
        "-q": "--quiet",
      },
      {
        permissive: false,
        argv,
      }
    );
  } catch (e) {
    if (e.message.indexOf("Unknown or unexpected option") === -1) throw e;
    nccError(e.message + `\n${usage}`, 2);
  }

  if (args._.length === 0) nccError(`Error: No command specified\n${usage}`, 2);

  let run = false;
  let outDir = args["--out"];
  const quiet = args["--quiet"];
  const statsOutFile = args["--stats-out"];
  const outFileName = args["--filename"] || "index";

  switch (args._[0]) {
    case "cache":
      if (args._.length > 2) errTooManyArguments("cache");

      const flags = Object.keys(args).filter((arg) => arg.startsWith("--"));
      if (flags.length) errFlagNotCompatible(flags[0], "cache");

      const cacheDir = require("./utils/ncc-cache-dir");
      switch (args._[1]) {
        case "clean":
          rimraf.sync(cacheDir);
          break;
        case "dir":
          stdout.write(cacheDir + "\n");
          break;
        case "size":
          require("get-folder-size")(cacheDir, (err, size) => {
            if (err) {
              if (err.code === "ENOENT") {
                stdout.write("0MB\n");
                return;
              }
              throw err;
            }
            stdout.write(`${(size / 1024 / 1024).toFixed(2)}MB\n`);
          });
          break;
        default:
          errInvalidCommand("cache " + args._[1]);
      }

      break;
    case "run":
      if (args._.length > 2) errTooManyArguments("run");

      if (args["--out"]) errFlagNotCompatible("--out", "run");

      if (args["--watch"]) errFlagNotCompatible("--watch", "run");

      outDir = resolve(
        require("os").tmpdir(),
        crypto
          .createHash("md5")
          .update(resolve(args._[1] || "."))
          .digest("hex")
      );
      if (existsSync(outDir)) rimraf.sync(outDir);
      run = true;

    // fallthrough
    case "build":
      if (args._.length > 2) errTooManyArguments("build");

      let startTime = Date.now();
      let ps;
      const buildFile = eval("require.resolve")(resolve(args._[1] || "."));
      const ext = buildFile.endsWith(".cjs") ? ".cjs" : ".js";
      const nccConfig = getConfig(process.cwd(), args["--config"]);

      // Override quiet config from CLI
      if (quiet !== undefined) {
        nccConfig.quiet = quiet;
      }

      // Override license config from CLI
      if (args["--license"] !== undefined) {
        nccConfig.license = args["--license"];
      }

      const ncc = require("@vercel/ncc")(buildFile, nccConfig);

      async function handler({ err, code, map, assets, symlinks, stats }) {
        // handle watch errors
        if (err) {
          stderr.write(err + "\n");
          stdout.write("Watching for changes...\n");
          return;
        }

        const archive = archiver("zip", {
          zlib: { level: args["--compression"] || 5 },
        });
        const outputFile = createWriteStream(outDir || "dist.zip");
        archive.pipe(outputFile);

        // When zipping other files should be written to `dist/`
        outDir = resolve(eval("'dist'"));
        mkdirp.sync(outDir);

        const ignorePatterns = args["--ignore"];

        await new Promise((resolve, reject) => {
          outputFile.on("close", resolve);
          outputFile.on("error", reject);

          archive.append(Buffer.from(code), {
            name: `${outFileName}${ext}`,
            mode: code.match(shebangRegEx) ? 0o777 : 0o666,
          });

          if (map) writeFileSync(`${outDir}/index${ext}.map`, map);

          for (const asset of Object.keys(assets)) {
            // Do not pack license file
            if (asset === args["--license"]) {
              writeFileSync(`${outDir}/${asset}`, assets[asset].source);
              continue;
            }

            if (
              ignorePatterns &&
              !ignorePatterns.some((ignorePattern) => {
                return minimatch(asset, ignorePattern);
              })
            ) {
              archive.append(Buffer.from(assets[asset].source), {
                name: asset,
                mode: assets[asset].permissions,
              });
            }
          }

          for (const symlink of Object.keys(symlinks)) {
            archive.symlink(symlink, symlinks[symlink]);
          }

          archive.finalize();
        });

        if (!quiet) {
          stdout.write(
            renderSummary(
              code,
              map,
              assets,
              ext,
              run ? "" : relative(process.cwd(), outDir),
              Date.now() - startTime
            ) + "\n"
          );

          if (args["--watch"]) stdout.write("Watching for changes...\n");
        }

        if (statsOutFile)
          writeFileSync(statsOutFile, JSON.stringify(stats.toJson()));

        if (run) {
          // find node_modules
          const root = resolve("/node_modules");
          let nodeModulesDir = dirname(buildFile) + "/node_modules";
          do {
            if (nodeModulesDir === root) {
              nodeModulesDir = undefined;
              break;
            }
            if (existsSync(nodeModulesDir)) break;
          } while (
            (nodeModulesDir = resolve(nodeModulesDir, "../../node_modules"))
          );
          if (nodeModulesDir)
            symlinkSync(nodeModulesDir, outDir + "/node_modules", "junction");
          ps = require("child_process").fork(`${outDir}/index${ext}`, {
            stdio: api ? "pipe" : "inherit",
          });
          if (api) {
            ps.stdout.pipe(stdout);
            ps.stderr.pipe(stderr);
          }
          return new Promise((resolve, reject) => {
            function exit(code) {
              require("rimraf").sync(outDir);
              if (code === 0) resolve();
              else reject({ silent: true, exitCode: code });
              process.off("SIGTERM", exit);
              process.off("SIGINT", exit);
            }
            ps.on("exit", exit);
            process.on("SIGTERM", exit);
            process.on("SIGINT", exit);
          });
        }
      }
      if (args["--watch"]) {
        ncc.handler(handler);
        ncc.rebuild(() => {
          if (ps) ps.kill();
          startTime = Date.now();
          stdout.write("File change, rebuilding...\n");
        });
        return true;
      } else {
        return ncc.then(handler);
      }
      break;

    case "help":
      nccError(usage, 2);

    case "version":
      stdout.write(require("./package.json").version + "\n");
      break;

    default:
      errInvalidCommand(args._[0], 2);
  }

  function errTooManyArguments(cmd) {
    nccError(`Error: Too many ${cmd} arguments provided\n${usage}`, 2);
  }

  function errFlagNotCompatible(flag, cmd) {
    nccError(
      `Error: ${flag} flag is not compatible with ncc ${cmd}\n${usage}`,
      2
    );
  }

  function errInvalidCommand(cmd) {
    nccError(`Error: Invalid command "${cmd}"\n${usage}`, 2);
  }

  // remove me when node.js makes this the default behavior
  process.on("unhandledRejection", (e) => {
    throw e;
  });
}
