export async function runWithBrowserFallback({ companion, browser, onFallback = () => {} }) {
  try {
    return await companion();
  } catch (error) {
    if (error?.aborted) throw error;
    onFallback(error);
    return browser(error);
  }
}
