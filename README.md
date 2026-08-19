# Kagaz Studio

Screenshot, document photo, ya PDF ko **editable Microsoft Word** (`.docx`) mein badlein — layout ke saath. Pages ko **PNG image** mein bhi nikaal sakte ho.

## Kya milta hai

- Photo / screenshot → editable Word
- PDF → editable Word (digital text keep hota hai; scanned pages par OCR)
- Visual Word copy — page bilkul original jaisi dikhti hai
- Har page PNG + ZIP download
- Hindi + English UI

## Chalane ka tarika

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Browser mein `http://localhost:5000` kholo. File drop karo, Word / images download karo.

## Limits

- Max file size: 28 MB
- Max 40 pages
- Digital PDF ka text (Hindi/English/tables) sabse clean rehta hai
- Photo OCR Latin script par strong hai; Devanagari scans ke liye visual Word + PNG better option hai
