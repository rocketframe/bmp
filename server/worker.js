// bmp's rules server for the Rocketframe Hub. Deployed by .github/workflows/rules-server.yml:
// live https://bmp-rules.rocketframe.workers.dev, staging https://bmp-rules-staging.rocketframe.workers.dev.
// HUB_GAME_SECRET is the secret the hub's admin page shows for bmp (set as a GitHub secret).
import { handleHubRequest, rulesRoom } from './rules-server.js';
import rules from './rules.js';

// The league (about 1 MB) stays here, one Durable Object per hub room and round; the hub sends only events.
export const RulesRoom = rulesRoom(rules);

export default {
  fetch: (req, env) => handleHubRequest(rules, req, env.HUB_GAME_SECRET, { rooms: env.ROOMS }),
};
