import sqlite3, json
path = r'C:\Users\KNNY\Desktop\Code\kiss-translator\mobile\scripts\RKStorage.db'
db = sqlite3.connect(path)
key = 'kissmobile:captions:v2:J3umnLuIhW8:en'
row = db.execute("select value from catalystLocalStorage where key=?", (key,)).fetchone()
data = json.loads(row[0])
for i, cue in enumerate(data['value']['cues'][:40]):
    print(i, cue['start'], cue['end'], round(cue['end']-cue['start'], 2), repr(cue['text']), '|', repr(cue.get('translation','')))
print('count', len(data['value']['cues']), 'trackKey', data['value'].get('trackKey'))
