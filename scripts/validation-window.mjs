// Keep owned automated windows off the working desktop while retaining actual
// Electron rendering, DOM input, CSP and isolated storage. No production hook.
export const validationArgs = [
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
];
export const parkWindow = (app) =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSkipTaskbar(true);
    window.setPosition(-10000, -10000);
  });
