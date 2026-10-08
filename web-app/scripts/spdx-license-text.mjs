// Keep packaging notices independent of missing .txt pages on spdx.org.
export const SPDX_DATA_COMMIT = "31ba1a50e5397e00a304dbadc76531740e89ee48";

export function createSpdxTextFetcher(fetchText = globalThis.fetch) {
  const cache = new Map();
  return async function getText(id) {
    if (!/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/.test(id)) throw new Error(`Invalid SPDX identifier: ${id}`);
    if (cache.has(id)) return cache.get(id);
    const url = `https://raw.githubusercontent.com/spdx/license-list-data/${SPDX_DATA_COMMIT}/text/${encodeURIComponent(id)}.txt`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response;
      try {
        response = await fetchText(url, { signal: AbortSignal.timeout(15000) });
      } catch (error) {
        if (attempt === 2) throw new Error(`Could not download SPDX text ${id}: ${error.message}`);
        continue;
      }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 2) continue;
        throw new Error(`SPDX text ${id} is unavailable (${response.status}) at pinned data commit ${SPDX_DATA_COMMIT}.`);
      }
      let contents;
      try {
        contents = await response.text();
      } catch (error) {
        if (attempt === 2) throw new Error(`Could not read SPDX text ${id}: ${error.message}`);
        continue;
      }
      if (!contents.trim() || /<(?:!doctype|html)\b/i.test(contents)) {
        throw new Error(`SPDX text ${id} is empty or contains an HTML response.`);
      }
      cache.set(id, contents);
      return contents;
    }
  };
}

export const getSpdxText = createSpdxTextFetcher();
