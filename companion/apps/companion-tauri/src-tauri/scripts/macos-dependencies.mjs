import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

export function collectMacDependencyGraph({ executable, pdfium, cellar, inspect }) {
  const libraries = new Map();
  const packages = new Set();
  const queue = [pdfium, executable];
  const visited = new Set();
  const executableRpaths = inspect(executable).rpaths.map((rpath) => expandPath(rpath, executable, executable));
  const cellarRoot = realpathSync(cellar);
  while (queue.length) {
    const file = realpathSync(queue.pop());
    if (visited.has(file)) continue;
    visited.add(file);
    const { dependencies, rpaths } = inspect(file);
    for (const dependency of dependencies) {
      if (dependency.startsWith("/System/") || dependency.startsWith("/usr/lib/")) continue;
      const searchPaths = [...rpaths.map((rpath) => expandPath(rpath, file, executable)), ...executableRpaths];
      let source = resolveDependency(dependency, file, executable, searchPaths);
      let resolved = realpathSync(source);
      if (resolved === file) continue; // A dylib's own install name is included in otool -L.
      const name = path.basename(dependency);
      // A previously relocated PDFium may refer to a bundled copy. The freshly
      // built executable's dependency graph provides its original Homebrew source.
      if (path.relative(cellarRoot, resolved).startsWith("..") && libraries.has(name)) {
        source = libraries.get(name);
        resolved = realpathSync(source);
      }
      const previous = libraries.get(name);
      if (previous && realpathSync(previous) !== resolved) {
        throw new Error(`macOS dependency name collision: ${previous} and ${source}`);
      }
      libraries.set(name, source);
      const relative = path.relative(cellarRoot, resolved);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`macOS dependency has no Homebrew license provenance: ${resolved}`);
      }
      packages.add(relative.split(path.sep)[0]);
      queue.push(resolved);
    }
  }
  return { libraries, packages };
}

function resolveDependency(dependency, file, executable, rpaths) {
  const candidates = dependency.startsWith("@rpath/")
    ? rpaths.map((rpath) => path.join(rpath, dependency.slice("@rpath/".length)))
    : [expandPath(dependency, file, executable)];
  const source = candidates.find((candidate) => path.isAbsolute(candidate) && existsSync(candidate));
  if (!source) {
    throw new Error(`Cannot resolve macOS runtime dependency ${dependency} required by ${file}; searched ${candidates.join(", ")}`);
  }
  return source;
}

function expandPath(value, file, executable) {
  return value.replace(/^@loader_path(?=\/|$)/, path.dirname(file))
    .replace(/^@executable_path(?=\/|$)/, path.dirname(executable));
}
