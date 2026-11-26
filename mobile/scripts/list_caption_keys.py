import sqlite3, json
db = sqlite3.connect(r'C:\Users\KNNY\Desktop\Code\kiss-translator\mobile\scripts\RKStorage.db')
rows = db.execute("select key, value from catalystLocalStorage where key like 'kissmobile:captions:v2:%'").fetchall()
for key, value in rows:
    data = json.loads(value)
    cues = data.get('value', {}).get('cues', [])
    print(key, len(cues), data.get('value', {}).get('trackKey'))
