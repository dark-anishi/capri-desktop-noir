// Recent views derive from the existing library; they are not writable categories.
export const RECENT_GAMES = 'recent-games';
export const RECENT_APPS = 'recent-apps';
const isGames = (category) => category.id === 'games' || /^(игры|games)$/i.test(category.name.trim());
export const isRecent = (id) => id === RECENT_GAMES || id === RECENT_APPS;
export function categoryViews(library) {
  return [
    { id: RECENT_GAMES, name: 'Недавно запущенные игры', virtual: true },
    { id: RECENT_APPS, name: 'Недавно запущенные приложения', virtual: true },
    ...library.categories.filter((c) => c.id !== 'other'),
    ...library.categories.filter((c) => c.id === 'other'),
    { id: 'all', name: 'Все приложения', virtual: true },
  ];
}
export function viewEntries(library, id) {
  const games = new Set(library.categories.filter(isGames).map((c) => c.id));
  if (isRecent(id)) return library.entries.filter((e) => Number.isFinite(e.lastLaunchedAt) && e.lastLaunchedAt > 0 && (id === RECENT_GAMES ? games.has(e.category) : !games.has(e.category))).sort((a, b) => b.lastLaunchedAt - a.lastLaunchedAt);
  return library.entries.filter((e) => id === 'all' || e.category === id);
}
export function importCategory(library, id) {
  if (library.categories.some((c) => c.id === id)) return id;
  if (id === RECENT_GAMES && library.categories.some(isGames)) return library.categories.find(isGames).id;
  if (id === RECENT_APPS) return library.categories.find((c) => !isGames(c))?.id || library.categories[0]?.id;
  return library.categories[0]?.id;
}
