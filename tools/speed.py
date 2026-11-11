import sys; sys.path.insert(0, sys.path[0])
from load import *
out={}
for g in (1,2):
  H=tracking(g,'Home'); A=tracking(g,'Away')
  for T in (H,A):
    ps=[c[:-2] for c in T.columns if c.endswith('_x') and not c.startswith('Ball')]
    for p in ps:
      x=T[p+'_x'].values; y=T[p+'_y'].values
      k=10  # 0.4 s smoothing
      xs=pd.Series(x).rolling(k,center=True).mean().values; ys=pd.Series(y).rolling(k,center=True).mean().values
      v=np.hypot(np.diff(xs),np.diff(ys))*25
      v=v[np.isfinite(v)]
      if len(v)<25*600: continue
      a=np.diff(pd.Series(v).rolling(10,center=True).mean().values)*25; a=a[np.isfinite(a)]
      out[(g,p)]=dict(max=np.percentile(v,99.9), p50=np.median(v), p90=np.percentile(v,90), sprintshare=(v>7).mean(), acc=np.percentile(a,99.5), dec=np.percentile(a,0.5))
r=pd.DataFrame(out).T
print(r.describe().round(2))
