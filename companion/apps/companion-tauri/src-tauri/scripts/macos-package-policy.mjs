function parts(version) {
  if (!/^\d+(?:\.\d+){1,2}$/.test(version || "")) throw new Error(`Invalid macOS version: ${version}`);
  return version.split(".").map(Number);
}

export function isNewerMacVersion(actual, supported) {
  const left = parts(actual);
  const right = parts(supported);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0);
  }
  return false;
}

// Hosted Homebrew libraries can require the runner's patch release. Advertise
// that conservative floor instead of changing the libraries' load commands.
export function selectMacPackageMinimum(configured, host) {
  return isNewerMacVersion(host, configured) ? host : configured;
}
