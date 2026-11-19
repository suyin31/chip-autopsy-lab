"""Load LSWMD.pkl (old pandas pickle) and export labeled wafers to JSONL + split.json.

Run inside the data directory: cd /path/to/wm811k && python3 /path/to/repo/tools/wm811k-export.py
Writes labeled.jsonl and split.json next to LSWMD.pkl (never into the repo)."""
import pickle, sys, json, random, time
import numpy as np
import pandas as pd

t0 = time.time()
class Shim(pickle.Unpickler):
    def find_class(self, module, name):
        if module.startswith('pandas.indexes'):
            module = module.replace('pandas.indexes', 'pandas.core.indexes')
        if module == 'pandas.core.indexes.numeric' and name in ('Int64Index', 'Float64Index', 'UInt64Index'):
            return pd.Index
        return super().find_class(module, name)

try:
    df = pd.read_pickle('LSWMD.pkl')
    print('read_pickle ok', flush=True)
except Exception as e:
    print('read_pickle failed:', repr(e)[:300], flush=True)
    with open('LSWMD.pkl', 'rb') as f:
        df = Shim(f, encoding='latin1').load()
print('loaded', type(df), df.shape, list(df.columns), time.time() - t0, flush=True)

def lab(v):
    try:
        a = np.asarray(v)
        if a.size == 0:
            return None
        return str(a.ravel()[0])
    except Exception:
        return None

ft = df['failureType'].map(lab)
tt_col = 'trianTestLabel' if 'trianTestLabel' in df.columns else 'trainTestLabel'
tt = df[tt_col].map(lab)
print(ft.value_counts(dropna=False).to_dict(), flush=True)
print(tt.value_counts(dropna=False).to_dict(), flush=True)

NAME = {'none': 'None'}
labeled = ft.notna() & (ft != '') & (ft != '0')
idxs = np.nonzero(labeled.values)[0]
print('labeled', len(idxs), flush=True)
by_class = {}
with open('labeled.jsonl', 'w') as out:
    for i in idxs:
        r = df.iloc[i]
        wm = np.asarray(r['waferMap'], dtype=np.uint8)
        label = NAME.get(ft.iloc[i], ft.iloc[i])
        h, w = wm.shape
        out.write(json.dumps({'id': int(df.index[i]), 'label': label, 'tt': tt.iloc[i],
                              'lot': str(r['lotName']), 'h': h, 'w': w,
                              'm': ''.join(map(str, wm.ravel().tolist()))}) + '\n')
        by_class.setdefault(label, []).append(int(df.index[i]))

# Stratified 70/30 split, fixed seed
rng = random.Random(20261120)
train, test = [], []
for c in sorted(by_class):
    ids = sorted(by_class[c]); rng.shuffle(ids)
    k = int(round(len(ids) * 0.7))
    train += ids[:k]; test += ids[k:]
json.dump({'seed': 20261120, 'method': 'stratified random 70/30 per failureType class over all labeled wafers; ids = original DataFrame row index of LSWMD.pkl',
           'counts': {c: len(v) for c, v in by_class.items()},
           'train': sorted(train), 'test': sorted(test)}, open('split.json', 'w'))
print('done', len(train), len(test), time.time() - t0, flush=True)
