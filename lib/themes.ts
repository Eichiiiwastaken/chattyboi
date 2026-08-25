const DARK_THEME_NAMES = new Set([
  "dark",
  "rose",
  "ocean",
  "forest",
  "sunset",
  "midnight",
]);

export function isDarkTheme(theme: string | undefined) {
  return theme ? DARK_THEME_NAMES.has(theme) : false;
}
