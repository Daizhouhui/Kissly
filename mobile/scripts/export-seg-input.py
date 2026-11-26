import sqlite3, json
path = r'C:\Users\KNNY\Desktop\Code\kiss-translator\mobile\scripts\RKStorage.db'
db = sqlite3.connect(path)
cap_key = 'kissmobile:captions:v2:J3umnLuIhW8:en'
tr_key = 'kissmobile:cues:v4:J3umnLuIhW8:en-US:manual:en-US:zh-CN:deepseek:deepseek-flash'
cap = json.loads(db.execute('select value from catalystLocalStorage where key=?', (cap_key,)).fetchone()[0])
tr = json.loads(db.execute('select value from catalystLocalStorage where key=?', (tr_key,)).fetchone()[0])
cues = cap['value']['cues']
translated = tr['value']['cues']
out = []
for index, cue in enumerate(cues):
    out.append({
        'start': cue['start'],
        'end': cue['end'],
        'text': cue['text'],
        'translation': translated[index].get('translation', '') if index < len(translated) else '',
    })
with open(r'C:\Users\KNNY\Desktop\Code\kiss-translator\mobile\scripts\seg-input.json', 'w', encoding='utf-8') as handle:
    json.dump(out, handle, ensure_ascii=False, indent=2)
print('wrote', len(out))
