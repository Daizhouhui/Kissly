import sqlite3, json, sys
path = r'C:\Users\KNNY\Desktop\Code\kiss-translator\mobile\scripts\RKStorage.db'
db = sqlite3.connect(path)
rows = db.execute("select key,value from catalystLocalStorage where key like '%captions:v2%' order by rowid desc limit 12").fetchall()
for k, v in rows:
    print(k, len(v))
    print(v[:200])
print('count', len(rows))
