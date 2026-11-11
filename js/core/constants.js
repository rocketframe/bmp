// Formation slots in "attacking right" coordinates: x 0..105 (own goal at 0), y 0..68 (left side = high y).
// [role, label, x, y]
export const FORMATIONS = {
  '4-4-2':   [['GK','GK',4,34],['DF','RB',24,8],['DF','CB',18,26],['DF','CB',18,42],['DF','LB',24,60],['MF','RM',44,9],['MF','CM',38,27],['MF','CM',38,41],['MF','LM',44,59],['FW','ST',58,28],['FW','ST',58,40]],
  '4-3-3':   [['GK','GK',4,34],['DF','RB',24,8],['DF','CB',18,26],['DF','CB',18,42],['DF','LB',24,60],['MF','CM',36,20],['MF','DM',32,34],['MF','CM',36,48],['FW','RW',58,11],['FW','ST',62,34],['FW','LW',58,57]],
  '4-2-3-1': [['GK','GK',4,34],['DF','RB',24,8],['DF','CB',18,26],['DF','CB',18,42],['DF','LB',24,60],['MF','DM',32,27],['MF','DM',32,41],['MF','RAM',48,12],['MF','AM',50,34],['MF','LAM',48,56],['FW','ST',62,34]],
  '3-5-2':   [['GK','GK',4,34],['DF','CB',18,20],['DF','CB',16,34],['DF','CB',18,48],['MF','RWB',38,6],['MF','CM',36,25],['MF','DM',32,34],['MF','CM',36,43],['MF','LWB',38,62],['FW','ST',58,28],['FW','ST',58,40]],
  '5-3-2':   [['GK','GK',4,34],['DF','RWB',26,6],['DF','CB',17,21],['DF','CB',15,34],['DF','CB',17,47],['DF','LWB',26,62],['MF','CM',38,22],['MF','CM',36,34],['MF','CM',38,46],['FW','ST',57,28],['FW','ST',57,40]],
};
export const FORMATION_KEYS = Object.keys(FORMATIONS);
export const MENTALITIES = {
  defensive: { label: 'Park the bus', att: 0.9, def: 1.08, danger: -0.05 },
  cautious:  { label: 'Cautious',     att: 0.96, def: 1.04, danger: -0.02 },
  balanced:  { label: 'Balanced',     att: 1, def: 1, danger: 0 },
  positive:  { label: 'Positive',     att: 1.04, def: 0.97, danger: 0.02 },
  attacking: { label: 'All out attack', att: 1.09, def: 0.91, danger: 0.05 },
};
export const ROLE_ORDER = { GK: 0, DF: 1, MF: 2, FW: 3 };
export const POS_LABEL = { GK: 'Goalkeeper', DF: 'Defender', MF: 'Midfielder', FW: 'Forward' };

export const TRAINING_FOCUS = {
  balanced:  { label: 'Balanced session', desc: 'Small gains everywhere, normal fatigue.', fit: 0, gain: 1, attrs: ['pace','shooting','passing','defending','keeping'] },
  fitness:   { label: 'Fitness & recovery', desc: 'Players recover faster. Little skill gain.', fit: 10, gain: 0.35, attrs: ['pace'] },
  attacking: { label: 'Finishing drills', desc: 'Forwards and midfielders improve shooting.', fit: -4, gain: 1.3, attrs: ['shooting','passing'] },
  defending: { label: 'Defensive shape', desc: 'Defenders and keepers get sharper.', fit: -4, gain: 1.3, attrs: ['defending','keeping'] },
  tactics:   { label: 'Tactical walkthrough', desc: 'Light session that boosts team cohesion for the next match.', fit: 4, gain: 0.5, attrs: ['passing'], cohesion: 4 },
};

export const LEAGUE = {
  clubsPerDivision: 12,
  divisions: [
    { id: 'd1', name: 'Crown League', tv: 180000, prizeTop: 6000000, repRange: [66, 82] },
    { id: 'd2', name: 'Shield League', tv: 45000, prizeTop: 1500000, repRange: [52, 67] },
  ],
  promote: 2,
  squadMax: 30,
  squadMin: 16,
};

export const CURRENCY = '€';
