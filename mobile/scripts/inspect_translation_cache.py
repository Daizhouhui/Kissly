import sqlite3, json
path = r'C:\Users\KNNY\Desktop\Code\kiss-translator\mobile\scripts\RKStorage.db'
db = sqlite3.connect(path)
rows = db.execute("select key,value from catalystLocalStorage where key like '%cues:v4:J3umnLuIhW8%'").fetchall()
print('rows', len(rows))
for key, value in rows:
    print('\nKEY', key)
    data = json.loads(value)
    cues = data['value']['cues'] if 'value' in data and 'cues' in data['value'] else data.get('cues', [])
    print('count', len(cues))
    for i, cue in enumerate(cues[:15]):
        print(i, cue.get('start'), cue.get('end'), repr(cue.get('text')), '|', repr(cue.get('translation')))
