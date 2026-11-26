import sqlite3, json
path = r'C:\Users\KNNY\Desktop\Code\kiss-translator\mobile\scripts\RKStorage.db'
db = sqlite3.connect(path)
for key in ['kissmobile:captions:v2:qeiYrLOg5xk:en', 'kissmobile:captions:v2:SK0WUaM0WvY:en', 'kissmobile:captions:v2:H6zceS7-XjE:en']:
    row = db.execute("select value from catalystLocalStorage where key=?", (key,)).fetchone()
    if not row:
        continue
    data = json.loads(row[0])['value']
    print('\nKEY', key, 'count', len(data['cues']), 'track', data.get('trackKey'))
    for i, cue in enumerate(data['cues'][:12]):
        print(i, cue['start'], cue['end'], round(cue['end']-cue['start'],2), repr(cue['text']))
