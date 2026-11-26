import sqlite3, json, sys
path = r'C:\Users\KNNY\Desktop\Code\kiss-translator\mobile\scripts\RKStorage.db'
db = sqlite3.connect(path)
video = sys.argv[1]
track = sys.argv[2] if len(sys.argv) > 2 else 'en'
key = f'kissmobile:captions:v2:{video}:{track}'
data = json.loads(db.execute('select value from catalystLocalStorage where key=?', (key,)).fetchone()[0])
cues = data['value']['cues']
out = [{'start': c['start'], 'end': c['end'], 'text': c['text']} for c in cues]
with open(r'C:\Users\KNNY\Desktop\Code\kiss-translator\mobile\scripts\seg-input.json', 'w', encoding='utf-8') as handle:
    json.dump(out, handle, ensure_ascii=False, indent=2)
print('wrote', len(out), key)
