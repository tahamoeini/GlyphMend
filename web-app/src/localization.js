import { en } from "./locales/en.js";
import { ru } from "./locales/ru.js";
import { zhCN } from "./locales/zh-CN.js";

export const LOCALE_METADATA = Object.freeze({
  en: Object.freeze({ lang: "en", dir: "ltr", nativeName: "English" }),
  ru: Object.freeze({ lang: "ru", dir: "ltr", nativeName: "Русский" }),
  "zh-CN": Object.freeze({ lang: "zh-CN", dir: "ltr", nativeName: "简体中文" }),
});

const catalogs = Object.freeze({ en, ru, "zh-CN": zhCN });
const localeStorageKey = "glyphmend-locale";
const textBindings = new Map();
const attributeBindings = new Map();
const protectedContent = "#fileName, #topFileName, #workspaceDocumentName, #markdownEditor, #renderedPreview, #logOutput, [data-generated-content], pre, code, textarea, [contenteditable='true']";
let activeLocale = "en";

function placeholderNames(message) {
  return [...message.matchAll(/\{([a-zA-Z][\w]*)\}/g)]
    .map((match) => match[1])
    .sort()
    .join("|");
}

function assertCatalogsAreComplete() {
  const keys = Object.keys(en).sort();
  for (const locale of Object.keys(LOCALE_METADATA)) {
    const catalogKeys = Object.keys(catalogs[locale]).sort();
    if (keys.join("\u0000") !== catalogKeys.join("\u0000")) {
      throw new Error(`The ${locale} translation catalog has missing or extra keys.`);
    }
    for (const key of keys) {
      if (placeholderNames(key) !== placeholderNames(catalogs[locale][key])) {
        throw new Error(`The ${locale} translation for “${key}” has different placeholders.`);
      }
    }
  }
}

assertCatalogsAreComplete();

export function t(message, values = {}, locale = activeLocale) {
  const translated = catalogs[locale]?.[message] ?? catalogs.en[message] ?? message;
  return translated.replace(/\{([a-zA-Z][\w]*)\}/g, (placeholder, name) =>
    Object.hasOwn(values, name)
      ? formatValue(values[name], locale)
      : placeholder,
  );
}

function formatValue(value, locale) {
  if (value && typeof value === "object" && value.message) {
    return t(value.message, value.values || {}, locale);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat(locale).format(value);
  }
  return String(value);
}

export function localePhrase(message, values = {}) {
  return Object.freeze({ message, values });
}

export function applyDocumentLocale(locale, metadata = LOCALE_METADATA[locale]) {
  if (!metadata || !["ltr", "rtl"].includes(metadata.dir)) return false;
  document.documentElement.lang = metadata.lang || locale;
  document.documentElement.dir = metadata.dir;
  return true;
}

function isProtected(node) {
  return !!node.parentElement?.closest(protectedContent);
}

function isProtectedAttribute(element) {
  if (element.closest("#renderedPreview, #logOutput, [data-generated-content], pre, code, [contenteditable='true']")) {
    return true;
  }
  return !!element.closest("#markdownEditor") && element.id !== "markdownEditor";
}

function saveTextBinding(node, source) {
  if (textBindings.has(node)) return;
  const leading = node.nodeValue.match(/^\s*/)?.[0] || "";
  const trailing = node.nodeValue.match(/\s*$/)?.[0] || "";
  const binding = { source, leading, trailing, rendered: node.nodeValue };
  textBindings.set(node, binding);
  node.nodeValue = `${leading}${t(source)}${trailing}`;
  binding.rendered = node.nodeValue;
}

export function registerUiText(root = document) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (isProtected(node)) continue;
    const source = node.nodeValue.trim();
    if (source && Object.hasOwn(en, source)) saveTextBinding(node, source);
  }

  const elements = root === document
    ? document.querySelectorAll("[aria-label], [title], [placeholder], [alt]")
    : [
        ...(root.matches?.("[aria-label], [title], [placeholder], [alt]") ? [root] : []),
        ...root.querySelectorAll("[aria-label], [title], [placeholder], [alt]"),
  ];
  for (const element of elements) {
    if (isProtectedAttribute(element)) continue;
    for (const attribute of ["aria-label", "title", "placeholder", "alt"]) {
      const source = element.getAttribute(attribute)?.trim();
      if (!source || !Object.hasOwn(en, source)) continue;
      if (!attributeBindings.has(element)) attributeBindings.set(element, new Map());
      const bindings = attributeBindings.get(element);
      if (bindings.has(attribute)) continue;
      bindings.set(attribute, { source, rendered: source });
      const value = t(source);
      element.setAttribute(attribute, value);
      bindings.get(attribute).rendered = value;
    }
  }
}

export function setLocalizedText(element, message, values = {}) {
  if (!element) return;
  const rendered = t(message, values);
  textBindings.set(element, { kind: "element", source: message, values, rendered });
  element.textContent = rendered;
}

export function setLocalizedAttribute(element, attribute, message, values = {}) {
  if (!element) return;
  const rendered = t(message, values);
  if (!attributeBindings.has(element)) attributeBindings.set(element, new Map());
  attributeBindings.get(element).set(attribute, {
    source: message,
    values,
    rendered,
  });
  element.setAttribute(attribute, rendered);
}

function applyRegisteredCopy() {
  for (const [node, binding] of textBindings) {
    if (!node.isConnected) {
      textBindings.delete(node);
      continue;
    }
    const current = binding.kind === "element" ? node.textContent : node.nodeValue;
    if (current !== binding.rendered) {
      textBindings.delete(node);
      continue;
    }
    const value = t(binding.source, binding.values || {});
    if (binding.kind === "element") node.textContent = value;
    else node.nodeValue = `${binding.leading}${value}${binding.trailing}`;
    binding.rendered = binding.kind === "element"
      ? node.textContent
      : node.nodeValue;
  }

  for (const [element, bindings] of attributeBindings) {
    if (!element.isConnected) {
      attributeBindings.delete(element);
      continue;
    }
    for (const [attribute, binding] of bindings) {
      if (element.getAttribute(attribute) !== binding.rendered) {
        bindings.delete(attribute);
        continue;
      }
      const value = t(binding.source, binding.values || {});
      element.setAttribute(attribute, value);
      binding.rendered = value;
    }
    if (!bindings.size) attributeBindings.delete(element);
  }
}

export function setLocale(locale) {
  if (!Object.hasOwn(LOCALE_METADATA, locale)) locale = "en";
  activeLocale = locale;
  registerUiText();
  applyDocumentLocale(locale);
  document.title = t("GlyphMend — Browser Edition", {}, locale);
  applyRegisteredCopy();
  const selector = document.getElementById("languageSelect");
  if (selector) selector.value = locale;
  try {
    localStorage.setItem(localeStorageKey, locale);
  } catch {
    // Private browsing can disable local storage; the current selection still applies.
  }
}

export function getLocale() {
  return activeLocale;
}

function initialLocale() {
  try {
    const saved = localStorage.getItem(localeStorageKey);
    return Object.hasOwn(LOCALE_METADATA, saved) ? saved : "en";
  } catch {
    return "en";
  }
}

activeLocale = initialLocale();
registerUiText();
applyDocumentLocale(activeLocale);
document.title = t("GlyphMend — Browser Edition");
applyRegisteredCopy();
const selector = document.getElementById("languageSelect");
if (selector) {
  selector.value = activeLocale;
  selector.addEventListener("change", () => setLocale(selector.value));
}
