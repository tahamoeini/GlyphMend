const DEFAULT_SOURCE_URL = "https://github.com/tahamoeini/glyph-mend/tree/main/web-app";
const DEFAULT_LICENSE_URL = "https://github.com/tahamoeini/glyph-mend/blob/main/web-app/LICENSE";

const sourceLink = document.getElementById("sourceCodeLink");
const licenseLink = document.getElementById("licenseLink");
const sourceUrl = import.meta.env.VITE_SOURCE_URL || DEFAULT_SOURCE_URL;
const licenseUrl = import.meta.env.VITE_LICENSE_URL || DEFAULT_LICENSE_URL;

if (sourceLink) sourceLink.href = sourceUrl;
if (licenseLink) licenseLink.href = licenseUrl;
