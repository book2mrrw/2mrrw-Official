#!/usr/bin/env python3
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "src/app/page.js"
lines = PATH.read_text().splitlines()

def find_all(substr):
    return [i for i, l in enumerate(lines) if substr in l]

# 1) Remove first broken SINGLE block (old modal + incomplete video) before AnimatePresence single
single_idxs = find_all("{/* ── SINGLE MODAL ── */}")
if len(single_idxs) >= 2:
    start = single_idxs[0]
    end = single_idxs[1]
    del lines[start:end]
    print(f"removed broken single fragment lines {start+1}-{end}")

# 2) Remove orphaned album modal tail (vinyl button without opening)
for i, l in enumerate(lines):
    if "selectedAlbum.title} – Vinyl" in l and i > 0 and "ALBUM MODAL" not in lines[i-5]:
        # orphan if not inside AnimatePresence album block
        if "AnimatePresence" not in "\n".join(lines[max(0,i-30):i]):
            # delete from this line through closing )}  of old album
            j = i
            while j < len(lines) and not (lines[j].strip() == ")}" and "selectedAlbum" not in lines[j]):
                j += 1
            if j < len(lines):
                del lines[i:j+1]
                print(f"removed orphan album tail at {i+1}")
            break

# 3) Fix exclusive modal: album modal was inserted inside it
album_start = None
exclusive_start = None
for i, l in enumerate(lines):
    if "{/* ── EXCLUSIVE / VAULT MODAL ── */}" in l:
        exclusive_start = i
    if album_start is None and exclusive_start is not None and "{/* ── ALBUM MODAL ── */}" in l:
        album_start = i

if exclusive_start is not None and album_start is not None:
  # Find album block end (AnimatePresence close after album)
    album_end = album_start
    depth = 0
    for j in range(album_start, len(lines)):
        if "<AnimatePresence>" in lines[j]:
            depth += 1
        if "</AnimatePresence>" in lines[j] and "album" in lines[album_start:album_start+5].__str__() or j > album_start + 10:
            if lines[j].strip() == "</AnimatePresence>":
                album_end = j + 1
                break
    # simpler: find </AnimatePresence> after album_start
    for j in range(album_start, min(album_start + 80, len(lines))):
        if lines[j].strip() == "</AnimatePresence>":
            album_end = j + 1
            break

    album_block = lines[album_start:album_end]
    del lines[album_start:album_end]

    # Find where to insert album: after single modal AnimatePresence
    single_end = None
    for i, l in enumerate(lines):
        if "{/* ── SINGLE MODAL ── */}" in l:
            for j in range(i, min(i + 120, len(lines))):
                if lines[j].strip() == "</AnimatePresence>":
                    single_end = j + 1
                    break
            break
    if single_end:
        for k, bl in enumerate(album_block):
            lines.insert(single_end + k, bl)
        print(f"moved album modal to after single ({single_end+1})")

    # Complete exclusive modal - find broken spot (features closed, then exclusive tail fragments)
    for i in range(exclusive_start, min(exclusive_start + 120, len(lines))):
        if "What's Included" in lines[i]:
            # find closing of features div
            for j in range(i, i + 15):
                if lines[j].strip() == "</div>" and j > i + 2:
                    # insert missing exclusive footer if next line is MAIN LAYOUT or exclusive tail fragment
                    next_content = lines[j+1] if j+1 < len(lines) else ""
                    if "MAIN LAYOUT" in next_content or "exclusiveModal.stock" in next_content:
                        footer = [
            '            <motion.div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:4}}>',
            '              <motion.div>',
            '                <motion.div style={{fontSize:26,fontWeight:900,color:exclusiveModal.badgeColor}}>${exclusiveModal.price.toFixed(2)}</motion.div>',
            '                {exclusiveModal.stock !== null && exclusiveModal.stock !== undefined && (',
            '                  <motion.div style={{fontSize:11,color:exclusiveModal.stock<=0?"#ff4d4d":"#555",marginTop:2}}>',
            '                    {exclusiveModal.stock<=0?"SOLD OUT":`${exclusiveModal.stock} remaining`}',
            '                  </motion.div>',
            '                )}',
            '              </motion.div>',
            '              <button',
            '                onClick={()=>{',
            '                  if (exclusiveModal.stock !== null && exclusiveModal.stock <= 0) return;',
            '                  addToCart({title:exclusiveModal.title,slug:exclusiveModal.slug,cover:exclusiveModal.cover,price:exclusiveModal.price});',
            '                  setExclusiveModal(null);',
            '                }}',
            '                disabled={exclusiveModal.stock !== null && exclusiveModal.stock <= 0}',
            '                style={{padding:"12px 20px",background:exclusiveModal.stock!==null&&exclusiveModal.stock<=0?"#333":exclusiveModal.badgeColor,color:exclusiveModal.stock!==null&&exclusiveModal.stock<=0?"#666":"#000",fontWeight:900,border:"none",borderRadius:10,cursor:exclusiveModal.stock!==null&&exclusiveModal.stock<=0?"not-allowed":"pointer",fontSize:13}}',
            '              >',
            '                {exclusiveModal.stock!==null&&exclusiveModal.stock<=0?"Sold Out":"Add to Cart"}',
            '              </button>',
            '            </motion.div>',
            '            <button onClick={()=>setExclusiveModal(null)} style={{background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:12,textAlign:"center",marginTop:8}}>Close</button>',
            '          </motion.div>',
            '        </motion.div>',
            '      )}',
            '',
                        ]
                        # Remove orphan tail lines if present
                        while j+1 < len(lines) and ("exclusiveModal.stock" in lines[j+1] or lines[j+1].strip() in ("</button>", "</div>", ")}") or "Close" in lines[j+1]):
                            if "MAIN LAYOUT" in lines[j+1]:
                                break
                            if "{/* ══" in lines[j+1]:
                                break
                            del lines[j+1]
                        for k, fl in enumerate(footer):
                            lines.insert(j + 1 + k, fl)
                        print("repaired exclusive modal footer")
                    break
            break

# 4) Remove duplicate MOBILE UI / NOW PLAYING / STRIPE sections
for label in ["{/* ── MOBILE UI ── */}", "{/* ── NOW PLAYING BAR ── */}", "{/* ── STRIPE MODAL ── */}"]:
    idxs = find_all(label)
    if len(idxs) > 1:
        # keep last occurrence for mobile/stripe if first is broken; for now keep first good
        # remove duplicates from end backwards
        for i in reversed(idxs[1:]):
            # find section end - next major comment at same indent
            end = i + 1
            while end < len(lines):
                s = lines[end].strip()
                if s.startswith("{/* ──") and end > i + 3:
                    break
                if s == "</>" and end > i + 10:
                    break
                if "{/* ══" in lines[end]:
                    break
                end += 1
            del lines[i:end]
            print(f"removed duplicate {label} at {i+1}")

PATH.write_text("\n".join(lines) + "\n")
print("done, lines:", len(lines))
