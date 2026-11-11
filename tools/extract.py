"""Extract real attacking moves that end in a shot from the Metrica Sports sample games.
Output: compact JSON templates in attacking-right coordinates (metres x10), 10 fps."""
import sys, json, numpy as np, pandas as pd
sys.path.insert(0, sys.path[0])
from load import tracking, events

FPS_IN, STEP = 25, 5          # 25 fps -> 5 fps keyframes (renderer interpolates smoothly)
MAXPRE, MINPRE = 11.0, 4.0     # seconds of build-up before the shot
POST = 0.2
out, stats = [], []

def cols(T, side):
    return [c[:-2] for c in T.columns if c.endswith('_x') and not c.startswith('Ball')]

for g in (1, 2):
    H, A, E = tracking(g, 'Home'), tracking(g, 'Away'), events(g)
    T = {'Home': H, 'Away': A}
    ball = H[['Ball_x', 'Ball_y']].interpolate(limit_direction='both').values
    for si, s in E[E.Type == 'SHOT'].iterrows():
        team, opp = s.Team, ('Away' if s.Team == 'Home' else 'Home')
        f_shot = int(s['Start Frame'])
        prev = E[(E['Start Frame'] <= f_shot) & (E.index < si)]
        # start of the uninterrupted possession
        start = f_shot
        for _, r in prev[::-1].iterrows():
            if r.Team != team or r.Type in ('BALL LOST', 'BALL OUT'): break
            if r.Type == 'SET PIECE': start = None; break
            start = int(r['Start Frame'])
        if start is None: continue  # corners/free kicks have their own scenes
        f0 = int(max(start - FPS_IN * 1.0, f_shot - FPS_IN * MAXPRE))
        f0 = int(min(f0, f_shot - FPS_IN * MINPRE))
        f1 = int(f_shot + FPS_IN * POST)
        win = E[(E['Start Frame'] >= f0) & (E['Start Frame'] <= f_shot)]
        if (win.Type == 'SET PIECE').any(): continue
        # attacking direction: shot end x
        right = (s['End X'] if not np.isnan(s['End X']) else s['Start X']) > 52.5
        def norm(x, y): return (x, y) if right else (105 - x, 68 - y)
        idx = np.arange(f0, f1 + 1, STEP) - 1  # frames are 1-based rows
        sh_i = (f_shot - 1 - idx[0]) // STEP
        def tracks(side, attacking):
            D = T[side]; res = []
            # role position: mean over this half, in the team's own attacking-right frame
            half = D[D.Period == s.Period]
            for p in cols(D, side):
                x, y = D[p + '_x'].values[idx], D[p + '_y'].values[idx]
                if np.isnan(x).mean() > 0.2: continue
                x = pd.Series(x).interpolate(limit_direction='both').values; y = pd.Series(y).interpolate(limit_direction='both').values
                mx, my = half[p + '_x'].mean(), half[p + '_y'].mean()
                if attacking: X, Y = norm(x, y); rx, ry = norm(mx, my)
                else:
                    X, Y = norm(x, y)  # same world frame as attackers
                    rx, ry = norm(mx, my); rx, ry = 105 - rx, 68 - ry  # role in defenders' own attacking-right frame
                res.append(dict(id=p, r=[round(rx, 1), round(ry, 1)], p=[int(round(v * 10)) for xy in zip(X, Y) for v in xy]))
            return res
        att, dfn = tracks(team, True), tracks(opp, False)
        if len(att) < 10 or len(dfn) < 10: continue
        # goalkeepers: role x smallest in own frame
        for L in (att, dfn): L.sort(key=lambda t: t['r'][0]); L[0]['gk'] = 1
        bx, by = ball[idx, 0], ball[idx, 1]
        BX, BY = norm(bx, by)
        shooter = s.From
        touches = []
        last_pass = None
        for _, r in win.iterrows():
            if r.Team != team or r.Type not in ('PASS', 'SHOT', 'RECOVERY'): continue
            fi = int(round((r['Start Frame'] - 1 - idx[0]) / STEP))
            ai = next((k for k, t in enumerate(att) if t['id'] == r.From), None)
            if ai is None: continue
            kind = 'shot' if r.Type == 'SHOT' else 'pass' if r.Type == 'PASS' else 'win'
            sub = str(r.Subtype) if isinstance(r.Subtype, str) else ''
            fe = int(round((r['End Frame'] - 1 - idx[0]) / STEP)) if r.Type == 'PASS' else fi
            d = float(np.hypot(r['End X'] - r['Start X'], r['End Y'] - r['Start Y'])) if r.Type == 'PASS' else 0
            lofted = ('CROSS' in sub or 'DEEP' in sub or 'CLEAR' in sub or d > 28)
            touches.append([fi, ai, kind, fe, 1 if lofted else 0, 1 if 'HEAD' in sub else 0])
            if r.Type == 'PASS': last_pass = r
        si_att = next((k for k, t in enumerate(att) if t['id'] == shooter), None)
        if si_att is None: continue
        att[si_att]['s'] = 1
        if last_pass is not None and last_pass.To == shooter:
            ai = next((k for k, t in enumerate(att) if t['id'] == last_pass.From), None)
            if ai is not None: att[ai]['a'] = 1
        sx, sy = norm(s['Start X'], s['Start Y'])
        dist = float(np.hypot(105 - sx, 34 - sy))
        tpl = dict(id=f'g{g}-{f_shot}', hdr=1 if 'HEAD' in str(s.Subtype) else 0, dist=round(dist, 1), n=len(idx), shot=int(sh_i),
                   att=[{k: v for k, v in t.items() if k != 'id'} for t in att], dfn=[{k: v for k, v in t.items() if k != 'id'} for t in dfn],
                   ball=[int(round(v * 10)) for xy in zip(BX, BY) for v in xy], tch=touches)
        # classify for scene labels
        npass = sum(1 for t in touches if t[2] == 'pass')
        startx = BX[0]
        lp = [t for t in touches if t[2] == 'pass'][-1:]
        wide = False; cross = False
        if lp:
            fi = lp[0][0]; py = BY[min(fi, len(BY) - 1)]; px = BX[min(fi, len(BX) - 1)]
            wide = abs(py - 34) > 18 and px > 70; cross = bool(lp[0][4]) and wide
        dur = (f_shot - f0) / FPS_IN
        tpl['kind'] = ('header' if tpl['hdr'] else 'cross' if cross else 'cutback' if wide else 'long' if dist > 19 else
                       'counter' if (startx < 45 and dur < 9) else 'through' if npass <= 3 else 'combo')
        tpl['dur'] = round(dur, 1)
        out.append(tpl)
        stats.append(dict(id=tpl['id'], kind=tpl['kind'], dur=dur, npass=npass, dist=dist, startx=startx))

st = pd.DataFrame(stats)
print(st.to_string())
print(st.kind.value_counts())
json.dump(out, open(sys.argv[1], 'w'), separators=(',', ':'))
