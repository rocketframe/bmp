// Product switches. Turn DEV_TOOLS off before a public launch.
export const GAME_TITLE = 'Matchday Legends';
export const DEV_TOOLS = true;          // shows "skip to the next day" in Options for testing
export const SAVE_KEY = 'ml.save.v1';
export const PREFS_KEY = 'ml.prefs.v1';
// Game hub servers this game may join a shared league on. A launch link (#hub=...) naming any other
// server is ignored, because the game would import and run that server's script.
// A hub on localhost / 127.0.0.1 is accepted only while the game itself is served from there (development).
export const HUB_ORIGINS = ['https://game-hub.rocketframe.workers.dev', 'https://game-hub-staging.rocketframe.workers.dev'];
