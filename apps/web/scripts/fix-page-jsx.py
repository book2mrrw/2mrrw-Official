#!/usr/bin/env python3
PATH = "/Users/recharge/artist-platform/src/app/page.js"
D = "</" + "div" + ">"
M = "</" + "motion.div" + ">"

with open(PATH) as f:
    c = f.read()

needle = f"            {D}{{/* end tabKey */}}\n          {D}{{/* end scroll area */}}"
replacement = f"            {D}{{/* end tabKey */}}\n            {M}\n            {M}\n          {D}{{/* end scroll area */}}"

if needle in c:
    c = c.replace(needle, replacement, 1)
    print("added wrapper closes")
else:
    print("WARN: end pattern not found")

with open(PATH, "w") as f:
    f.write(c)
print("ok")
