import numpy as np, pandas as pd
D='/tmp/claude-0/-home-user/a6a4046c-73d6-5549-bbde-99e042a55cd0/scratchpad/met'
def tracking(g, side):
    f=f'{D}/Sample_Game_{g}_RawTrackingData_{side}_Team.csv'
    hdr=pd.read_csv(f, skiprows=2, nrows=0).columns
    cols=['Period','Frame','Time']
    names=list(hdr[3:])
    for i in range(0,len(names),2):
        n=names[i]; cols += [n+'_x', n+'_y']
    df=pd.read_csv(f, skiprows=3, header=None, names=cols)
    for c in df.columns:
        if c.endswith('_x'): df[c]=df[c]*105
        if c.endswith('_y'): df[c]=df[c]*68
    return df
def events(g):
    e=pd.read_csv(f'{D}/Sample_Game_{g}_RawEventsData.csv')
    for c in ['Start X','End X']: e[c]=e[c]*105
    for c in ['Start Y','End Y']: e[c]=e[c]*68
    return e
