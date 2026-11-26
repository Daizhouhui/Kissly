import sqlite3, json
db = sqlite3.connect(r'C:\Users\KNNY\Desktop\Code\kiss-translator\mobile\scripts\RKStorage.db')
key = 'kissmobile:captions:v2:qeiYrLOg5xk:en'
data = json.loads(db.execute('select value from catalystLocalStorage where key=?', (key,)).fetchone()[0])
cues = data['value']['cues']
for index, cue in enumerate(cues[:60]):
    print(index, round(cue['start'], 2), round(cue['end'], 2), round(cue['end'] - cue['start'], 2), repr(cue['text']))
